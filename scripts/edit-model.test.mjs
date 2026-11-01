import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openEditBundle, applyEditTags, renderEditWords, encodeEditWords, selectEditTags, editTokenBudget } from '../extension/edit-model-core.js';
import { planCorrection } from '../extension/token-budget.js';
import { normalizeEngineMode, ENGINE_DEFAULTS } from '../extension/settings.js';

const config = { architecture: 'roberta', language: 'en', context: 512, labels: ['$KEEP', '$DELETE'], keepId: 0, threshold: .6, bos: 0, eos: 2 };
const data = { 'config.json': JSON.stringify(config), 'tokenizer.json': '{}', 'tokenizer_config.json': '{}', 'verbs.json': '{}', 'model.onnx': 'test model bytes' };
function bundle({ transformHeader = () => {}, corrupt = false, cfg = config } = {}) {
  const entries = {}, payloads = []; let offset = 0;
  for (const [name, str] of Object.entries({ ...data, 'config.json': JSON.stringify(cfg) })) {
    const bytes = Buffer.from(str); entries[name] = { offset, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    offset += bytes.length; payloads.push(bytes);
  }
  const header = { format: 'wordwell-edit', version: 1, entries }; transformHeader(header);
  const json = Buffer.from(JSON.stringify(header)), prefix = Buffer.alloc(12); prefix.write('WWEDIT01'); prefix.writeUInt32LE(json.length, 8);
  const value = Buffer.concat([prefix, json, ...payloads]); if (corrupt) value[value.length - 1] ^= 1;
  return new Blob([value]);
}
test('edit mode is explicit and does not change the default engine', () => {
  assert.equal(ENGINE_DEFAULTS.engineMode, 'browser');
  assert.equal(normalizeEngineMode('edit'), 'edit'); assert.equal(normalizeEngineMode('unknown'), 'browser');
});
test('data bundle checks configuration, entry bounds, overlap, and content hashes', async () => {
  const b = await openEditBundle(bundle()); assert.deepEqual(b.config, config);
  assert.equal(new TextDecoder().decode(await b.bytes('model.onnx')), data['model.onnx']);
  await assert.rejects(openEditBundle(new Blob(['not an edit bundle'])), /not a Wordwell/);
  await assert.rejects(openEditBundle(bundle({ cfg: { ...config, context: '512' } })), /Invalid edit-model context/);
  await assert.rejects(openEditBundle(bundle({ transformHeader(h) { h.entries['model.onnx'].offset = 2 ** 30; } })), /Invalid bundle entry/);
  await assert.rejects(openEditBundle(bundle({ transformHeader(h) { h.entries['verbs.json'].offset = 0; } })), /Overlapping/);
  const damaged = await openEditBundle(bundle({ corrupt: true })); await assert.rejects(damaged.bytes('model.onnx'), /damaged/);
});
test('bundle contexts drive the budget, with bounds and room for iterative edits', async () => {
  assert.deepEqual(editTokenBudget(512), { context: 512, inputLimit: 480, safetyMargin: 32 });
  assert.deepEqual(editTokenBudget(128), { context: 128, inputLimit: 96, safetyMargin: 32 });
  assert.deepEqual(editTokenBudget(1024), { context: 1024, inputLimit: 992, safetyMargin: 32 });
  for (const context of [64, 128, 256, 1024, 4096, 8192]) {
    const loaded = await openEditBundle(bundle({ cfg: { ...config, context } }));
    assert.equal(loaded.config.context, context);
    assert.equal(loaded.budget.inputLimit + loaded.budget.safetyMargin, context);
  }
  for (const context of [undefined, null, '512', 0, -512, 32, 63, 512.5, 8193, Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(openEditBundle(bundle({ cfg: { ...config, context } })), /Invalid edit-model context/);
  }
});
test('word encoding includes START and records the first subword for edit alignment', () => {
  const ids = { '$START': [99], Dogs: [4, 5], run: [6] };
  const tokenizer = { encode(word, options) { assert.equal(options.add_special_tokens, false); return { ids: ids[word] }; } };
  assert.deepEqual(encodeEditWords(['Dogs', 'run'], tokenizer, config), { ids: [0, 99, 4, 5, 6, 2], positions: [1, 2, 4] });
});

test('sentence-start insertion confidence enables edits without using BOS or subword scores', () => {
  const cfg = { labels: ['$KEEP', '$APPEND_The', '$TRANSFORM_CASE_LOWER'], threshold: .6 };
  const labels = BigInt64Array.from([0n, 1n, 2n, 0n, 0n]);
  const confidence = [.99, .9, .8, .95, .95];
  assert.deepEqual(selectEditTags([1, 2, 4], labels, confidence, [.99, .94, .41, .99, .1], cfg), ['$APPEND_The', '$TRANSFORM_CASE_LOWER', '$KEEP']);
  assert.deepEqual(selectEditTags([1, 2, 4], labels, confidence, [.99, .1, .41, .99, .1], cfg), ['$KEEP', '$KEEP', '$KEEP']);
  assert.deepEqual(selectEditTags([1, 2, 4], labels, [.99, .5, .8, .95, .95], [.99, .94, .41, .99, .1], cfg), ['$KEEP', '$TRANSFORM_CASE_LOWER', '$KEEP']);
  assert.throws(() => selectEditTags([1], labels, confidence, [0, NaN], cfg), /invalid predictions/);
  assert.throws(() => selectEditTags([1], [0, 9999], confidence, [0, .9], cfg), /invalid predictions/);
});
test('edit labels cover insert/delete/replace, casing, verb forms, split and merge', () => {
  assert.deepEqual(applyEditTags(['$START', 'he', 'go', 'a', 'home'], ['$APPEND_Yesterday', '$TRANSFORM_CASE_CAPITAL', '$TRANSFORM_VERB_VB_VBD', '$DELETE', '$REPLACE_school'], { go_VB_VBD: 'went' }), ['$START', 'Yesterday', 'He', 'went', 'school']);
  assert.deepEqual(applyEditTags(['$START', 'cat', 'dogs', 'well-known', 'some', 'thing'], ['$KEEP', '$TRANSFORM_AGREEMENT_PLURAL', '$TRANSFORM_AGREEMENT_SINGULAR', '$TRANSFORM_SPLIT_HYPHEN', '$MERGE_SPACE', '$KEEP'], {}), ['$START', 'cats', 'dog', 'well', 'known', 'something']);
  assert.deepEqual(applyEditTags(['$START', 'New', 'yORK'], ['$DELETE', '$MERGE_HYPHEN', '$TRANSFORM_CASE_CAPITAL'], {}), ['$START', 'New-York']);
});
test('rendering preserves unchanged bytes and layout outside corrections', () => {
  const render = (input, output) => renderEditWords(input, input.match(/\S+/g), output.split(' '));
  assert.equal(render('  She\tgo  home. ', 'She goes home.'), '  She\tgoes  home. ');
  assert.equal(render('I go home.', 'I will go home.'), 'I will go home.');
  assert.equal(render('I go.', 'Yesterday I go.'), 'Yesterday I go.');
  assert.equal(render('Really I go.', 'I go.'), 'I go.');
  assert.equal(render('I really go.', 'I go.'), 'I go.');
  assert.equal(render('I go really', 'I go'), 'I go');
  assert.equal(render('  Already\tcorrect.\n', 'Already correct.'), '  Already\tcorrect.\n');
  assert.equal(render('It is fine', "It 's fine"), "It's fine");
});

test('literal edit markers survive unrelated corrections and trailing merges do not leak tags', () => {
  const words = ['$START', 'Keep', '$MERGE_SPACE', '$MERGE_HYPHEN', '$DELETE', 'as', 'text.'];
  assert.deepEqual(applyEditTags(words, ['$KEEP', '$KEEP', '$KEEP', '$KEEP', '$KEEP', '$KEEP', '$REPLACE_text!'], {}),
    ['$START', 'Keep', '$MERGE_SPACE', '$MERGE_HYPHEN', '$DELETE', 'as', 'text!']);
  assert.deepEqual(applyEditTags(['$START', 'word'], ['$KEEP', '$MERGE_SPACE'], {}), ['$START', 'word']);
  assert.deepEqual(applyEditTags(['$START', 'word', 'remove'], ['$KEEP', '$MERGE_HYPHEN', '$DELETE'], {}), ['$START', 'word']);
  assert.deepEqual(applyEditTags(['$START', 'some', 'extra', 'thing'], ['$KEEP', '$MERGE_SPACE', '$DELETE', '$KEEP'], {}), ['$START', 'something']);
  assert.deepEqual(applyEditTags(['$START', 'a', 'b', 'c'], ['$KEEP', '$MERGE_SPACE', '$MERGE_HYPHEN', '$KEEP'], {}), ['$START', 'ab-c']);
});

test('inserted contractions attach to the preceding word', () => {
  assert.equal(renderEditWords('I do know.', ['I', 'do', 'know.'], ['I', 'do', "n't", 'know.']), "I don't know.");
  assert.equal(renderEditWords('He', ['He'], ['He', "'s"]), "He's");
});
test('encoder-only splitting counts input with no generative output allowance', async () => {
  const count = async text => ({ prompt_tokens: text.length + 3, text_tokens: text.length + 3 });
  const plan = await planCorrection('  First line.\r\nSecond, longer line. ', count, 20, () => 0, 0);
  assert.equal(plan.map(p => p.literal ?? p.prefix + p.text + p.suffix).join(''), '  First line.\r\nSecond, longer line. ');
  assert.ok(plan.filter(p => p.text).every(p => p.promptTokens <= 20 && p.maxTokens === 0));
  await assert.rejects(planCorrection('x'.repeat(30), count, 20, () => 0, 0), /even after splitting/);
});
