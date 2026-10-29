import { Wllama } from '/vendor/index.js';

const $ = id => document.getElementById(id);
const config = await fetch('/api/config').then(response => response.json());
const cases = await fetch('/cases.json').then(response => response.json());
const parameters = new URLSearchParams(location.search);
const logs = [];
let engine;
let busy = false;
let report = { engine: config.engine, contextRequested: config.context, results: [] };
const instruction = 'Correct the English grammar, spelling, and sentence structure with minimal edits. Preserve the original meaning. If the text is already correct, return it unchanged. Return only the corrected text, without explanations or quotation marks.';

function log(level, ...args) {
  const line = args.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ');
  logs.push({ level, message: line });
  if (logs.length > 600) logs.shift();
  $('log').textContent = logs.map(entry => `[${entry.level}] ${entry.message}`).join('\n');
  if (level === 'error' || level === 'warn') console[level](line);
}
function status(message) { $('status').textContent = message; console.info(`[engine-test] ${message}`); }
function controls() {
  $('load').disabled = busy || Boolean(engine);
  $('model').disabled = busy || Boolean(engine);
  $('backend').disabled = busy || Boolean(engine);
  $('unload').disabled = busy || !engine;
  $('correct').disabled = busy || !report.contextLoaded;
  $('suite').disabled = busy || !report.contextLoaded;
  $('export').disabled = !report.model;
}
function renderResults() {
  $('results').replaceChildren();
  for (const result of report.results) {
    const div = document.createElement('div');
    div.className = 'result';
    for (const [label, value] of [['Original', result.input], ['Model', result.output], ['Reference', result.reference]]) {
      const p = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = `${label}: `;
      p.append(strong, document.createTextNode(value));
      div.append(p);
    }
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = `${result.category} · ${result.elapsedMs.toFixed(0)} ms · ${result.usage?.completion_tokens ?? '?'} output tokens · stopped: ${result.finishReason}`;
    div.append(meta);
    $('results').append(div);
  }
}

async function load() {
  if (busy || engine) throw new Error('Engine is busy or already loaded');
  busy = true;
  controls();
  const model = $('model').value;
  const backend = $('backend').value;
  const start = performance.now();
  try {
    status(`Loading ${model}…`);
    const windows = navigator.userAgentData?.platform === 'Windows' || /^Win/.test(navigator.platform);
    const adapter = navigator.gpu ? await navigator.gpu.requestAdapter(windows ? {} : { powerPreference: 'high-performance' }) : null;
    if (backend === 'gpu' && !adapter) throw new Error('Chrome did not provide a WebGPU adapter');
    const useGPU = backend !== 'cpu' && Boolean(adapter);
    report = { engine: config.engine, model, modelBytes: config.models.find(entry => entry.name === model)?.bytes,
      contextRequested: config.context, backendRequested: backend, backendSelected: useGPU ? 'webgpu' : 'wasm-cpu',
      adapter: adapter?.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description } : null,
      browser: navigator.userAgent, crossOriginIsolated, threads: Math.max(1, Math.min(8, Math.floor(navigator.hardwareConcurrency / 2))),
      instruction, generation: { temperature: 0, seed: 42, max_tokens: 128, thinking: false }, results: [] };
    engine = new Wllama({ default: new URL('/vendor/wasm/wllama.wasm', location.href).href }, {
      logger: { debug: () => {}, log: (...args) => log('info', ...args), warn: (...args) => log('warn', ...args), error: (...args) => log('error', ...args) },
    });
    const response = await fetch(`/model?name=${encodeURIComponent(model)}`);
    if (!response.ok) throw new Error(`Model read failed (${response.status})`);
    const blob = await response.blob();
    status(`Initializing ${report.backendSelected} engine with a ${config.context}-token context…`);
    await engine.loadModel([new File([blob], model)], {
      n_ctx: config.context, n_parallel: 1, n_batch: 128, n_ubatch: 128,
      n_threads: report.threads, n_gpu_layers: useGPU ? 99999 : 0,
      cache_type_k: 'f16', cache_type_v: 'f16', jinja: true, reasoning: false,
      default_template_kwargs: { enable_thinking: false }, seed: 42,
    });
    const context = engine.getLoadedContextInfo();
    report.contextLoaded = context.n_ctx;
    report.architecture = context.metadata['general.architecture'];
    report.modelName = context.metadata['general.name'];
    report.loadMs = performance.now() - start;
    report.multithread = engine.isMultithread();
    if (report.contextLoaded !== config.context) throw new Error(`Loaded ${report.contextLoaded} context tokens; expected ${config.context}`);
    $('info').textContent = JSON.stringify(report, null, 2);
    status(`Loaded · ${report.contextLoaded} context tokens · ${report.backendSelected} · ${(report.loadMs / 1000).toFixed(1)} seconds`);
    return report;
  } catch (error) {
    report.error = error.message;
    status(`Load failed: ${error.message}`);
    throw error;
  } finally { busy = false; controls(); }
}

async function correct(text) {
  if (!engine || !report.contextLoaded) throw new Error('Load the model first');
  const start = performance.now();
  const response = await engine.createChatCompletion({
    messages: [{ role: 'system', content: instruction }, { role: 'user', content: text }],
    temperature: 0, seed: 42, max_tokens: 128, top_p: 1, top_k: 1,
    repeat_penalty: 1, presence_penalty: 0, cache_prompt: false,
    chat_template_kwargs: { enable_thinking: false },
  });
  return { input: text, output: response.choices[0].message.content?.trim() ?? '',
    elapsedMs: performance.now() - start, usage: response.usage, finishReason: response.choices[0].finish_reason };
}

async function runSuite() {
  if (busy) throw new Error('Engine is busy');
  busy = true; controls(); report.results = [];
  try {
    for (const [index, test] of cases.entries()) {
      status(`Grammar test ${index + 1}/${cases.length}: ${test.category}`);
      const result = await correct(test.input);
      report.results.push({ ...test, ...result });
      renderResults();
      console.info(`[engine-test] ${JSON.stringify(result)}`);
      if (!result.output || result.finishReason !== 'stop') throw new Error(`Incomplete generation on case ${index + 1}`);
    }
    report.suiteCompleted = true;
    status(`Finished ${cases.length} grammar cases. Review the corrections below.`);
    return snapshot();
  } catch (error) { report.error = error.message; status(`Test failed: ${error.message}`); throw error; }
  finally { busy = false; controls(); }
}

async function unload() {
  if (engine) await engine.exit();
  engine = undefined; report.contextLoaded = undefined;
  status('Model unloaded'); controls();
}
function snapshot() { return structuredClone({ ...report, logs }); }

for (const model of config.models) {
  const option = document.createElement('option'); option.value = model.name;
  option.textContent = `${model.name} (${(model.bytes / 1e6).toFixed(0)} MB)`;
  $('model').append(option);
}
$('model').value = parameters.get('model') || config.defaultModel;
$('backend').value = parameters.get('backend') || 'auto';
$('load').onclick = () => load().catch(error => log('error', error.message));
$('unload').onclick = () => unload().catch(error => log('error', error.message));
$('suite').onclick = () => runSuite().catch(error => log('error', error.message));
$('correct').onclick = async () => {
  if (busy) return;
  busy = true; controls(); status('Checking sentence…');
  try { const result = await correct($('text').value); $('output').textContent = result.output; status(`Corrected in ${(result.elapsedMs / 1000).toFixed(2)} seconds`); }
  catch (error) { status(`Correction failed: ${error.message}`); }
  finally { busy = false; controls(); }
};
$('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot(), null, 2)], {type:'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = 'engine-results.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.engineTest = { load, correct, runSuite, unload, snapshot };
status(`Ready · ${config.engine} · context ${config.context}`);
controls();
