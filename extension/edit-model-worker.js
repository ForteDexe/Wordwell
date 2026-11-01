import * as ort from './vendor/onnx/ort.webgpu.bundle.min.mjs';
import { Tokenizer } from './vendor/tokenizers/tokenizers.mjs';
import { openEditBundle, encodeEditWords, selectEditTags, applyEditTags, renderEditWords } from './edit-model-core.js';

let session, tokenizer, config, verbs;
ort.env.wasm.wasmPaths = new URL('./vendor/onnx/', import.meta.url).href;
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

async function load(file) {
  if (session) throw new Error('Unload the active edit model first.');
  const bundle = await openEditBundle(file);
  config = bundle.config;
  tokenizer = new Tokenizer(await bundle.json('tokenizer.json'), await bundle.json('tokenizer_config.json'));
  verbs = await bundle.json('verbs.json');
  const bytes = await bundle.bytes('model.onnx');
  let backend = 'WebGPU';
  try { session = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'] }); }
  catch (gpuError) {
    backend = 'CPU / WebAssembly';
    try { session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }); }
    catch (error) { throw new Error(`Could not load the edit model. ${error.message} (WebGPU: ${gpuError.message})`); }
  }
  return { name: config.name, ...bundle.budget, backend, architecture: config.architecture, license: config.license };
}

function encode(text) {
  if (!session) throw new Error('Load an edit model first.');
  return encodeEditWords(text.match(/\S+/gu) || [], tokenizer, config);
}

async function correct(text) {
  const original = text.match(/\S+/gu) || [];
  let words = ['$START', ...original], passes = 0, tokenCount = 0;
  for (; passes < 5; passes++) {
    const { ids, positions } = encodeEditWords(words.slice(1), tokenizer, config);
    tokenCount = Math.max(tokenCount, ids.length);
    if (ids.length > config.context) throw new Error(`This section exceeds the edit model’s ${config.context.toLocaleString()}-token limit. Select a shorter section.`);
    const input = new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]);
    const mask = new ort.Tensor('int64', BigInt64Array.from(ids, () => 1n), [1, ids.length]);
    let outputs;
    try { outputs = await session.run({ input_ids: input, attention_mask: mask }); }
    finally { input.dispose(); mask.dispose(); }
    let tags;
    try {
      const labels = await outputs.labels.getData(), confidence = await outputs.confidence.getData(), error = await outputs.error.getData();
      tags = selectEditTags(positions, labels, confidence, error, config);
    } finally { for (const tensor of Object.values(outputs)) tensor.dispose(); }
    if (tags.every(tag => ['$KEEP', '<OOV>', '<PAD>'].includes(tag))) { passes++; break; }
    const changed = applyEditTags(words, tags, verbs);
    if (changed.length === words.length && changed.every((v, i) => v === words[i])) { passes++; break; }
    words = changed;
  }
  const corrected = renderEditWords(text, original, words[0] === '$START' ? words.slice(1) : words);
  if (!corrected.trim()) throw new Error('The edit model returned an empty correction.');
  return { corrected, passes, tokens: tokenCount };
}

self.onmessage = async ({ data: { id, type, value } }) => {
  try {
    let result;
    if (type === 'load') result = await load(value);
    else if (type === 'count') { const n = encode(value).ids.length; result = { prompt_tokens: n, text_tokens: n }; }
    else if (type === 'correct') result = await correct(value);
    else if (type === 'dispose') { await session?.release(); session = tokenizer = config = verbs = null; result = true; }
    else throw new Error('Unknown edit-model operation.');
    self.postMessage({ id, result });
  } catch (error) { self.postMessage({ id, error: error.message || String(error) }); }
};
