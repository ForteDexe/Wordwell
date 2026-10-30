import { Wllama } from './vendor/index.js';
import { CONTEXT_SIZE, normalizeContextSize, CONTEXT_MARGIN, MAX_TEXT_LENGTH, planCorrection } from './token-budget.js';

export { CONTEXT_SIZE };
export const INSTRUCTION = 'Correct the English grammar, spelling, and sentence structure with minimal edits. Preserve the original meaning. If the text is already correct, return it unchanged. Return only the corrected text, without explanations or quotation marks.';

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
    this.tokenCountTask = Promise.resolve();
  }

  log(level, ...values) {
    const message = values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ');
    this.logs.push({ level, message });
    if (this.logs.length > 250) this.logs.shift();
    if (level === 'error') console.error(message);
  }

  async load(file, { contextSize = CONTEXT_SIZE } = {}) {
    if (this.busy || this.runtime) throw new Error('Unload the current model before loading another.');
    contextSize = normalizeContextSize(contextSize);
    if (contextSize === null) throw new Error('Enter a whole-number context size from 512 to 8,192 tokens in Settings.');
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
        n_ctx: contextSize, n_parallel: 1, n_batch: 128, n_ubatch: 128, n_threads: threads,
        n_gpu_layers: adapter ? 99999 : 0, cache_type_k: 'f16', cache_type_v: 'f16',
        jinja: true, reasoning: false, default_template_kwargs: { enable_thinking: false }, seed: 42, ctx_shift: false,
      });
      const context = this.runtime.getLoadedContextInfo();
      if (context.n_ctx !== contextSize) throw new Error(`The engine loaded ${context.n_ctx} context tokens instead of ${contextSize}.`);
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

  chatRequest(text) {
    return { messages: [{ role: 'system', content: INSTRUCTION }, { role: 'user', content: text }],
      chat_template_kwargs: { enable_thinking: false } };
  }

  async countTokens(text) {
    if (!this.ready || this.busy) return null;
    const runtime = this.runtime;
    // Serialize previews with each other. Inference and unload wait for the
    // current preview; queued previews yield when either operation starts.
    const task = this.tokenCountTask.catch(() => {}).then(() => {
      if (!this.ready || this.busy || this.runtime !== runtime) return null;
      return runtime.countChatTokens(this.chatRequest(text.trim()));
    });
    this.tokenCountTask = task;
    return task;
  }

  async correct(text) {
    if (!this.ready) throw new Error('Choose and load a model first.');
    if (this.busy) throw new Error('A check is already running.');
    if (!text.trim()) throw new Error('Enter a sentence or a short paragraph.');
    if (text.length > MAX_TEXT_LENGTH) throw new Error('Please check a shorter section (up to 50,000 characters).');
    this.busy = true;
    const started = performance.now();
    try {
      await this.tokenCountTask.catch(() => {});
      this.checkCount += 1;
      const contextSize = this.info.context;
      const plan = await planCorrection(text, value => this.runtime.countChatTokens(this.chatRequest(value)), contextSize);
      const chunks = plan.filter(part => part.text !== undefined);
      const output = [], budget = [], usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      for (const part of plan) {
        if (part.literal !== undefined) { output.push(part.literal); continue; }
        if (chunks.length > 1) this.onStatus(`Checking section ${budget.length + 1} of ${chunks.length}…`);
        const response = await this.runtime.createChatCompletion({
          ...this.chatRequest(part.text), temperature: 0, seed: 42, max_tokens: part.maxTokens, top_p: 1, top_k: 1,
          repeat_penalty: 1, presence_penalty: 0, cache_prompt: false,
        });
        if (response.usage?.prompt_tokens !== part.promptTokens) throw new Error('The prompt token count changed. No correction was applied. Please try again.');
        const corrected = response.choices[0].message.content?.trim();
        if (response.choices[0].finish_reason !== 'stop') throw new Error('The correction reached its output limit. Try a shorter passage.');
        if (!corrected) throw new Error('The model returned no correction. Try again with a shorter passage.');
        output.push(part.prefix, corrected, part.suffix);
        budget.push({ promptTokens: part.promptTokens, textTokens: part.textTokens, maxOutputTokens: part.maxTokens, completionTokens: response.usage.completion_tokens, splitLevel: part.level });
        for (const key of Object.keys(usage)) usage[key] += response.usage[key] || 0;
      }
      return { original: text, corrected: output.join(''), seconds: (performance.now() - started) / 1000, usage,
        budget: { context: contextSize, safetyMargin: CONTEXT_MARGIN, chunks: budget } };
    } finally { this.busy = false; }
  }

  async unload() {
    if (this.busy) throw new Error('Wait for the current operation to finish.');
    this.busy = true;
    try {
      await this.tokenCountTask.catch(() => {});
      await this.runtime?.exit();
      this.runtime = null;
      this.ready = false;
      this.info = null;
      this.onStatus('Model unloaded.');
    } finally { this.busy = false; }
  }
}
