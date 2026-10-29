import { Wllama } from './vendor/index.js';

export const CONTEXT_SIZE = 1024;
const INSTRUCTION = 'Correct the English grammar, spelling, and sentence structure with minimal edits. Preserve the original meaning. If the text is already correct, return it unchanged. Return only the corrected text, without explanations or quotation marks.';

export class LocalModel {
  constructor(onStatus) {
    this.onStatus = onStatus;
    this.runtime = null;
    this.busy = false;
    this.ready = false;
    this.info = null;
    this.loadCount = 0;
    this.checkCount = 0;
    this.logs = [];
  }

  log(level, ...values) {
    const message = values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ');
    this.logs.push({ level, message });
    if (this.logs.length > 250) this.logs.shift();
    if (level === 'error') console.error(message);
  }

  async load(file) {
    if (this.busy || this.runtime) throw new Error('Unload the current model before loading another.');
    if (!file || !file.name.toLowerCase().endsWith('.gguf')) throw new Error('Choose a GGUF model file.');
    if (file.size < 4) throw new Error('The model file is empty.');
    if (await file.slice(0, 4).text() !== 'GGUF') throw new Error('The selected file does not have a GGUF header.');
    // The runtime currently requires individual files under 2 GiB.
    if (file.size >= 2 ** 31) throw new Error('This first version supports a single GGUF file under 2 GB.');
    this.busy = true;
    const started = performance.now();
    try {
      this.onStatus('Loading your model…');
      // Chrome on Windows ignores powerPreference and records a warning for it.
      // Omit the hint there; this still requests a WebGPU adapter.
      const windows = navigator.userAgentData?.platform === 'Windows' || /^Win/.test(navigator.platform);
      const adapter = navigator.gpu ? await navigator.gpu.requestAdapter(windows ? {} : { powerPreference: 'high-performance' }) : null;
      const threads = Math.max(1, Math.min(8, Math.floor(navigator.hardwareConcurrency / 2)));
      this.runtime = new Wllama({ default: chrome.runtime.getURL('vendor/wasm/wllama.wasm') }, {
        logger: { debug: () => {}, log: (...args) => this.log('info', ...args), warn: (...args) => this.log('warn', ...args), error: (...args) => this.log('error', ...args) },
      });
      await this.runtime.loadModel([file], {
        n_ctx: CONTEXT_SIZE, n_parallel: 1, n_batch: 128, n_ubatch: 128, n_threads: threads,
        n_gpu_layers: adapter ? 99999 : 0, cache_type_k: 'f16', cache_type_v: 'f16',
        jinja: true, reasoning: false, default_template_kwargs: { enable_thinking: false }, seed: 42,
      });
      const context = this.runtime.getLoadedContextInfo();
      if (context.n_ctx !== CONTEXT_SIZE) throw new Error(`The engine loaded ${context.n_ctx} context tokens instead of ${CONTEXT_SIZE}.`);
      this.loadCount += 1;
      this.info = {
        engine: 'wllama 3.8.1', file: file.name, bytes: file.size,
        model: context.metadata['general.name'], architecture: context.metadata['general.architecture'],
        context: context.n_ctx, backend: adapter ? 'WebGPU' : 'CPU / WebAssembly',
        adapter: adapter?.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture } : null,
        multithread: this.runtime.isMultithread(), threads: this.runtime.getNumThreads(),
        loadSeconds: (performance.now() - started) / 1000, instanceId: crypto.randomUUID(), loadCount: this.loadCount,
      };
      this.ready = true;
      this.onStatus('Model ready. You can check your text.');
      return this.info;
    } catch (error) {
      await this.runtime?.exit().catch(() => {});
      this.runtime = null;
      this.ready = false;
      throw error;
    } finally { this.busy = false; }
  }

  async correct(text) {
    if (!this.ready) throw new Error('Choose and load a model first.');
    if (this.busy) throw new Error('A check is already running.');
    if (!text.trim()) throw new Error('Enter a sentence or a short paragraph.');
    if (text.length > 1600) throw new Error('Please check a shorter passage (up to 1,600 characters).');
    this.busy = true;
    const started = performance.now();
    try {
      this.checkCount += 1;
      const response = await this.runtime.createChatCompletion({
        messages: [{ role: 'system', content: INSTRUCTION }, { role: 'user', content: text }],
        temperature: 0, seed: 42, max_tokens: 128, top_p: 1, top_k: 1,
        repeat_penalty: 1, presence_penalty: 0, cache_prompt: false,
        chat_template_kwargs: { enable_thinking: false },
      });
      const output = response.choices[0].message.content?.trim();
      if (response.choices[0].finish_reason !== 'stop') throw new Error('The correction reached its output limit. Try a shorter passage.');
      if (!output) throw new Error('The model returned no correction. Try again with a shorter passage.');
      return { original: text, corrected: output, seconds: (performance.now() - started) / 1000, usage: response.usage };
    } finally { this.busy = false; }
  }

  async unload() {
    if (this.busy) throw new Error('Wait for the current operation to finish.');
    this.busy = true;
    try {
      await this.runtime?.exit();
      this.runtime = null;
      this.ready = false;
      this.info = null;
      this.onStatus('Model unloaded.');
    } finally { this.busy = false; }
  }
}
