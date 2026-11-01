import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import nspell from 'nspell';
import { createSpellingChecker } from '../extension/spelling-core.js';
import { SPELLING_DEFAULTS } from '../extension/settings.js';

// Test the shipped merged dictionary, including the multi-dictionary regression.
const [aff, dic] = await Promise.all(['en.aff', 'en.dic'].map(name => readFile(new URL(`../dist/extension/vendor/spelling/${name}`, import.meta.url), 'utf8')));
const dictionary = nspell(aff, dic);
const checker = createSpellingChecker(dictionary);

test('spelling is opt-in and the merged US/UK dictionary rejects actual typos', () => {
  assert.equal(SPELLING_DEFAULTS.spellingEnabled, false);
  for (const word of ['theriotically', 'recieved', 'definately']) assert.equal(dictionary.correct(word), false);
  for (const word of ['color', 'colour', 'organize', 'organise']) assert.equal(dictionary.correct(word), true);
});
test('bounded fallback finds theoretically without a hardcoded typo list', () => {
  assert.deepEqual(checker.correct('theriotically it is dead'), { corrected: 'theoretically it is dead',
    edits: [{ start: 0, end: 13, original: 'theriotically', replacement: 'theoretically' }] });
  assert.equal(checker.correct('Theriotically it is dead.').corrected, 'Theoretically it is dead.');
});
test('ranks transpositions and preserves original whitespace and edit offsets', () => {
  const source = 'I recieved teh letter.\r\n\t  I definately beleive it.';
  const result = checker.correct(source);
  assert.equal(result.corrected, 'I received the letter.\r\n\t  I definitely believe it.');
  for (const edit of result.edits) assert.equal(source.slice(edit.start, edit.end), edit.original);
});
test('valid dialect forms, real-word errors, names, Unicode, and identifiers remain unchanged', () => {
  for (const source of ['The colour and color are fine. I organise and organize files.',
    'She go to school. We cant do this.', 'Qwen and Wordwell use WebGPU.',
    'François uses theriotically_value and foo-theriotically.', '你好 theriotically123 café']) {
    assert.equal(checker.correct(source).corrected, source);
  }
});
test('protects URLs, mail addresses, code, and Windows paths', () => {
  const source = 'Visit https://theriotically.test and www.recieved.com. Email theriotically@example.com. `definately` C:\\theriotically\\definately';
  assert.equal(checker.correct(source).corrected, source);
});
test('ambiguous candidates stay unchanged', () => {
  // Both valid candidates have identical rank; selection must abstain.
  const ambiguous = createSpellingChecker({ correct: value => ['cat', 'hat'].includes(value), suggest: () => ['cat', 'hat'] });
  assert.equal(ambiguous.correct('bat').corrected, 'bat');
});
test('unknown-word searches are capped per pass and repeated lookups are cached', () => {
  let calls = 0;
  const bounded = createSpellingChecker({ correct: () => false, suggest: () => { calls++; return []; } });
  const words = Array.from({ length: 30 }, (_, i) => 'zz' + String.fromCharCode(97 + Math.floor(i / 26), 97 + i % 26));
  bounded.correct(words.join(' ')); assert.equal(calls, 24);
  bounded.correct(words.join(' ')); assert.equal(calls, 24, 'Warm caches must not shift the per-pass search budget');
});
