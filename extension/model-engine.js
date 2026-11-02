import { Wllama } from './vendor/index.js';
import { CONTEXT_SIZE, normalizeContextSize, CONTEXT_MARGIN, MAX_TEXT_LENGTH, planCorrection } from './token-budget.js';
import { languageTools } from './languages.js';
import { ENGINE_DEFAULTS, SPELLING_DEFAULTS, normalizeEngineMode, normalizeServerUrl } from './settings.js';
import { SpellingService } from './spelling.js';

export { CONTEXT_SIZE };
export const INSTRUCTION = languageTools.instruction(languageTools.defaultLanguage);

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
    this.targetLanguage = languageTools.defaultLanguage;
    this.customPrompt = '';
    this.engineMode = ENGINE_DEFAULTS.engineMode;
    this.serverUrl = ENGINE_DEFAULTS.serverUrl;
    this.serverModel = null;
    this.spellingEnabled = SPELLING_DEFAULTS.spellingEnabled;
    this.speller = new SpellingService();
  }

  setSpellingEnabled(value) {
    this.spellingEnabled = value === true;
    if (!this.spellingEnabled && !this.busy) this.speller.reset();
  }

  async spellingSource(text, language, enabled) {
    return enabled && language === 'en' ? (await this.speller.correct(text)).corrected : text;
  }

  setMode(value) {
    if (this.ready || this.busy) throw new Error('Disconnect the current engine before changing modes.');
    this.engineMode = normalizeEngineMode(value);
  }

  async serverFetch(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout ?? 10000);
    const { timeout: _timeout, ...fetchOptions } = options;
    try {
      const response = await fetch(new URL(path.replace(/^\//, ''), `${this.serverUrl}/`), {
        ...fetchOptions,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message || data?.message || `${response.status} ${response.statusText}`);
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(`The llama.cpp server at ${this.serverUrl} did not respond in time.`);
      if (error instanceof TypeError) throw new Error(`Could not reach the llama.cpp server at ${this.serverUrl}. Check that it is running and allows Chrome extension connections.`);
      throw error;
    } finally { clearTimeout(timeout); }
  }

  async connectServer(value) {
    if (this.busy || this.ready || this.runtime) throw new Error('Disconnect the current engine before connecting another.');
    this.engineMode = 'server';
    this.serverUrl = normalizeServerUrl(value);
    this.busy = true;
    const started = performance.now();
    try {
      this.onStatus('Connecting to your llama.cpp server…');
      const [health, props] = await Promise.all([this.serverFetch('/health'), this.serverFetch('/props')]);
      if (health?.status !== 'ok') throw new Error('The llama.cpp server is not ready.');
      const context = Number(props?.default_generation_settings?.n_ctx);
      if (!Number.isInteger(context) || context < 1) throw new Error('The server did not report a valid context size.');
      this.serverModel = props.model_alias || props.model_path || 'llama.cpp model';
      this.loadCount += 1;
      this.info = {
        engine: 'llama.cpp server', file: this.serverModel, model: this.serverModel,
        context, backend: 'Dedicated llama.cpp server', endpoint: this.serverUrl,
        serverBuild: props.build_info || null, slots: props.total_slots || null,
        loadSeconds: (performance.now() - started) / 1000, instanceId: crypto.randomUUID(), loadCount: this.loadCount,
      };
      this.ready = true;
      this.onStatus('Server connected. You can check your text.');
      return this.info;
    } catch (error) {
      this.ready = false; this.info = null; this.serverModel = null;
      throw error;
    } finally { this.busy = false; }
  }

  log(level, ...values) {
    const message = values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ');
    this.logs.push({ level, message });
    if (this.logs.length > 250) this.logs.shift();
    if (level === 'error') console.error(message);
  }

  async loadEdit(file) {
    if (this.engineMode !== 'edit') throw new Error('Select Grammar edit model before loading this bundle.');
    if (this.busy || this.runtime || this.ready) throw new Error('Unload the active model first.');
    if (!file?.name?.toLowerCase().endsWith('.wwedit')) throw new Error('Choose a Wordwell edit-model bundle (.wwedit).');
    this.busy = true;
    const started = performance.now();
    try {
      this.onStatus('Loading the edit model…');
      const { EditModel } = await import('./edit-model.js');
      this.runtime = new EditModel();
      const details = await this.runtime.load(file);
      this.loadCount++;
      this.info = { engine: 'GECToR / ONNX Runtime', model: details.name, architecture: details.architecture,
        file: file.name, bytes: file.size, context: details.context, inputLimit: details.inputLimit, safetyMargin: details.safetyMargin,
        backend: details.backend, license: details.license,
        loadSeconds: (performance.now() - started) / 1000, instanceId: crypto.randomUUID(), loadCount: this.loadCount,
        capabilities: { correctionLanguages: ['en'], translation: false, customPrompt: false } };
      this.ready = true;
      this.onStatus('English correction is ready.');
      return this.info;
    } catch (error) {
      await this.runtime?.exit().catch(() => {});
      this.runtime = null; this.ready = false; this.info = null;
      throw error;
    } finally { this.busy = false; }
  }

  async load(file, { contextSize = CONTEXT_SIZE } = {}) {
    if (this.engineMode !== 'browser') throw new Error('Switch to Browser model before loading a GGUF file.');
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

  chatRequest(text, language = this.targetLanguage, customPrompt = this.customPrompt) {
    return { messages: [{ role: 'system', content: languageTools.normalizePrompt(customPrompt) || languageTools.instruction(language) }, { role: 'user', content: text }],
      chat_template_kwargs: { enable_thinking: false } };
  }

  translationRequest(text, language) {
    return { messages: [{ role: 'system', content: languageTools.translationInstruction(language) }, { role: 'user', content: text }],
      chat_template_kwargs: { enable_thinking: false } };
  }

  async countTokens(text) {
    if (!this.ready || this.busy) return null;
    const runtime = this.runtime;
    const instanceId = this.info?.instanceId;
    const language = this.targetLanguage;
    const customPrompt = this.customPrompt;
    const spellingEnabled = this.spellingEnabled;
    // Serialize previews with each other. Inference and unload wait for the
    // current preview; queued previews yield when either operation starts.
    const task = this.tokenCountTask.catch(() => {}).then(async () => {
      const current = () => this.ready && !this.busy && this.info?.instanceId === instanceId && this.runtime === runtime && this.targetLanguage === language && this.customPrompt === customPrompt && this.spellingEnabled === spellingEnabled;
      if (!current()) return null;
      const source = await this.spellingSource(text.trim(), language, spellingEnabled);
      if (!current()) return null;
      return this.countRequestTokens(this.chatRequest(source, language, customPrompt), source);
    }).finally(() => {
      if (!this.spellingEnabled && !this.busy) this.speller.reset();
    });
    this.tokenCountTask = task;
    return task;
  }

  async tokenizeServer(content) {
    const response = await this.serverFetch('/tokenize', { method: 'POST', body: JSON.stringify({ content, add_special: false, with_pieces: false }) });
    if (!Array.isArray(response?.tokens)) throw new Error('The llama.cpp server returned an invalid token count.');
    return response.tokens.length;
  }

  async countRequestTokens(request, text) {
    if (this.engineMode === 'edit') return this.runtime.count(text);
    if (this.engineMode === 'browser') return this.runtime.countChatTokens(request);
    const applied = await this.serverFetch('/apply-template', { method: 'POST', body: JSON.stringify({ ...request, add_generation_prompt: true }) });
    if (typeof applied?.prompt !== 'string') throw new Error('The llama.cpp server could not apply its chat template.');
    const [prompt_tokens, text_tokens] = await Promise.all([this.tokenizeServer(applied.prompt), this.tokenizeServer(text)]);
    return { prompt_tokens, text_tokens };
  }

  async createCompletion(request, maxTokens) {
    const options = {
      ...request, temperature: 0, seed: 42, max_tokens: maxTokens, top_p: 1, top_k: 1,
      repeat_penalty: 1, presence_penalty: 0, stream: false,
    };
    if (this.engineMode === 'browser') return this.runtime.createChatCompletion({ ...options, cache_prompt: false });
    return this.serverFetch('/v1/chat/completions', { method: 'POST', body: JSON.stringify({ ...options, model: this.serverModel }), timeout: 120000 });
  }

  correct(text) {
    return this.process(text, { operation: 'correct', language: this.targetLanguage, customPrompt: this.customPrompt });
  }

  translate(text, language) {
    return this.process(text, { operation: 'translate', language: languageTools.normalize(language), customPrompt: '' });
  }

  async process(text, { operation, language, customPrompt }) {
    if (!this.ready) throw new Error('Choose and load a model first.');
    if (this.busy) throw new Error('A check is already running.');
    if (!text.trim()) throw new Error('Enter a sentence or a short paragraph.');
    if (text.length > MAX_TEXT_LENGTH) throw new Error('Please check a shorter section (up to 50,000 characters).');
    if (this.engineMode === 'edit') {
      if (operation !== 'correct') throw new Error('Translation is unavailable with the edit model. Switch to your browser model or server.');
      if (language !== 'en') throw new Error('The edit model supports English correction only.');
      return this.processEdits(text, customPrompt);
    }
    this.busy = true;
    const spellingEnabled = this.spellingEnabled;
    const translating = operation === 'translate';
    const request = value => translating ? this.translationRequest(value, language) : this.chatRequest(value, language, customPrompt);
    const started = performance.now();
    try {
      await this.tokenCountTask.catch(() => {});
      const source = translating ? text : await this.spellingSource(text, language, spellingEnabled);
      this.checkCount += 1;
      const contextSize = this.info.context;
      if (customPrompt) {
        const base = await this.countRequestTokens(request(''), '');
        if (base.prompt_tokens + 128 + CONTEXT_MARGIN >= contextSize) throw new Error('The correction prompt leaves too little context. Shorten it or increase the context size.');
      }
      // Translation can expand substantially, especially between scripts.
      const allowance = translating ? tokens => Math.max(256, tokens * 3 + 32) : undefined;
      const plan = await planCorrection(source, value => this.countRequestTokens(request(value), value), contextSize, allowance);
      const chunks = plan.filter(part => part.text !== undefined);
      const output = [], budget = [], usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      for (const part of plan) {
        if (part.literal !== undefined) { output.push(part.literal); continue; }
        if (chunks.length > 1) this.onStatus(`${translating ? 'Translating' : 'Checking'} section ${budget.length + 1} of ${chunks.length}…`);
        const maxTokens = translating ? contextSize - part.promptTokens - CONTEXT_MARGIN : part.maxTokens;
        const response = await this.createCompletion(request(part.text), maxTokens);
        if (response.usage?.prompt_tokens !== part.promptTokens) throw new Error('The prompt token count changed. No correction was applied. Please try again.');
        const corrected = response.choices[0].message.content?.trim();
        if (response.choices[0].finish_reason !== 'stop') throw new Error(`The ${translating ? 'translation' : 'correction'} reached its output limit. Try a shorter passage.`);
        if (!corrected) throw new Error(`The model returned no ${translating ? 'translation' : 'correction'}. Try again with a shorter passage.`);
        output.push(part.prefix, corrected, part.suffix);
        budget.push({ promptTokens: part.promptTokens, textTokens: part.textTokens, maxOutputTokens: maxTokens, completionTokens: response.usage.completion_tokens, splitLevel: part.level });
        for (const key of Object.keys(usage)) usage[key] += response.usage[key] || 0;
      }
      return { original: text, corrected: output.join(''), operation, language, promptOverride: customPrompt, spellingEnabled, seconds: (performance.now() - started) / 1000, usage,
        budget: { context: contextSize, safetyMargin: CONTEXT_MARGIN, chunks: budget } };
    } finally { this.busy = false; if (!this.spellingEnabled) this.speller.reset(); }
  }

  async processEdits(text, customPrompt) {
    this.busy = true;
    const spellingEnabled = this.spellingEnabled;
    const started = performance.now();
    try {
      await this.tokenCountTask.catch(() => {});
      const source = await this.spellingSource(text, 'en', spellingEnabled);
      this.checkCount++;
      const output = [], chunks = [];
      // Line separators stay literal, including CRLF. Each line keeps its own layout outside edits.
      for (const line of source.split(/(\r\n|\r|\n)/)) {
        if (!line.trim()) { output.push(line); continue; }
        const plan = await planCorrection(line, value => this.runtime.count(value), this.info.inputLimit, () => 0, 0);
        for (const part of plan) {
          if (part.literal !== undefined) { output.push(part.literal); continue; }
          if (chunks.length >= 128) throw new Error('This passage needs too many checks. Select a shorter section.');
          const result = await this.runtime.correct(part.text);
          output.push(part.prefix, result.corrected, part.suffix);
          chunks.push({ promptTokens: part.promptTokens, textTokens: part.textTokens, maxOutputTokens: 0,
            completionTokens: 0, splitLevel: part.level, passes: result.passes });
        }
      }
      const tokens = chunks.reduce((sum, part) => sum + part.textTokens, 0);
      return { original: text, corrected: output.join(''), operation: 'correct', language: 'en', promptOverride: customPrompt, spellingEnabled,
        seconds: (performance.now() - started) / 1000, usage: { prompt_tokens: tokens, completion_tokens: 0, total_tokens: tokens },
        budget: { context: this.info.context, safetyMargin: this.info.safetyMargin, chunks } };
    } finally { this.busy = false; if (!this.spellingEnabled) this.speller.reset(); }
  }

  async unload() {
    if (this.busy) throw new Error('Wait for the current operation to finish.');
    this.busy = true;
    try {
      await this.tokenCountTask.catch(() => {});
      this.speller.reset();
      const runtime = this.runtime;
      this.runtime = null;
      this.serverModel = null;
      this.ready = false;
      this.info = null;
      await runtime?.exit();
      this.onStatus('Model unloaded.');
    } finally { this.busy = false; }
  }
}
