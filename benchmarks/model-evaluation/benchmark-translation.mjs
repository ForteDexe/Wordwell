import { chromium } from 'playwright';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { removeTestProfile, waitForWorkspace } from '../../scripts/browser-profile.mjs';

const modelPath = process.env.MODEL_FILE_PATH;
assert(modelPath, 'MODEL_FILE_PATH is required');
const suffix = process.env.REPORT_NAME;
assert(/^[\w-]+$/.test(suffix || ''), 'Valid REPORT_NAME is required');
const cases = JSON.parse(await readFile(new URL('./translation-cases.json', import.meta.url), 'utf8'));
const gpuFlags = process.env.PERF_GPU_PREFERENCE === 'high'
  ? ['--force-high-performance-gpu', '--use-webgpu-power-preference=force-high-performance'] : [];
const reportPath = path.resolve(`benchmarks/model-evaluation/reports/translation/translation-${suffix}.json`);
const report = { date: new Date().toISOString(), modelPath, context: 1024, gpuFlags, cases: [], errors: [], externalRequests: [] };
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
};
const save = () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
await mkdir(path.dirname(reportPath), { recursive: true });
await mkdir('.browser-check', { recursive: true });
const profile = await mkdtemp(path.resolve('.browser-check/editor-checks-'));
let context;
try {
  const extensionPath = path.resolve('dist/extension');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, ...gpuFlags],
  });
  await context.route('**/*', route => {
    if (/^https?:/.test(route.request().url())) {
      report.externalRequests.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await waitForWorkspace(context, new URL(worker.url()).host);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.waitForFunction(() => window.localEnglish?.initialized);
  await page.setInputFiles('#model-file', modelPath);
  report.browser = context.browser()?.version();
  report.environment = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    window.translationBenchmarkGPU = !!adapter;
    window.translationBenchmarkFile = document.querySelector('#model-file').files[0];
    return { hardwareConcurrency: navigator.hardwareConcurrency, adapter: adapter?.info || null };
  });
  const result = await page.evaluate(async cases => {
    const { Wllama } = await import('./vendor/index.js');
    const { languageTools } = await import('./languages.js');
    const runtime = new Wllama({ default: chrome.runtime.getURL('vendor/wasm/wllama.wasm') }, {
      logger: { debug() {}, log() {}, warn() {}, error() {} },
    });
    const options = {
      n_ctx: 1024, n_parallel: 1, n_batch: 128, n_ubatch: 128,
      n_threads: Math.max(1, Math.min(8, Math.floor(navigator.hardwareConcurrency / 2))),
      n_gpu_layers: window.translationBenchmarkGPU ? 99999 : 0,
      cache_type_k: 'f16', cache_type_v: 'f16', jinja: true, reasoning: false,
      default_template_kwargs: { enable_thinking: false }, seed: 42,
    };
    const started = performance.now();
    try {
      await runtime.loadModel([window.translationBenchmarkFile], options);
      const loadSeconds = (performance.now() - started) / 1000;
      async function translate(item) {
        const messages = [
          { role: 'system', content: languageTools.translationInstruction(item.language) },
          { role: 'user', content: item.input },
        ];
        const start = performance.now();
        const response = await runtime.createChatCompletion({
          messages, chat_template_kwargs: { enable_thinking: false },
          temperature: 0, seed: 42, max_tokens: 256, top_p: 1, top_k: 1,
          repeat_penalty: 1, presence_penalty: 0, cache_prompt: false,
          abortSignal: AbortSignal.timeout(60000),
        });
        return { ...item, output: response.choices[0].message.content?.trim(),
          finishReason: response.choices[0].finish_reason,
          seconds: (performance.now() - start) / 1000, usage: response.usage, timings: response.timings };
      }
      await translate({ language: 'vi', input: 'Warmup.', id: 'warmup', category: 'warmup' });
      const samples = [];
      for (const item of cases) samples.push(await translate(item));
      return { options, loadSeconds, samples };
    } finally {
      await runtime.exit();
    }
  }, cases);
  const times = result.samples.map(sample => sample.seconds);
  result.summary = {
    medianSeconds: median(times),
    p90Seconds: [...times].sort((a, b) => a - b)[Math.ceil(times.length * 0.9) - 1],
    exactReferences: result.samples.filter(sample => sample.output === sample.reference).length,
    controlsUnchanged: result.samples.filter(sample => sample.category === 'target-language control' && sample.output === sample.input).length,
    incomplete: result.samples.filter(sample => sample.finishReason !== 'stop').length,
    total: result.samples.length,
  };
  report.cases = result.samples;
  report.loadSeconds = result.loadSeconds;
  report.summary = result.summary;
  assert.equal(report.externalRequests.length, 0, 'Unexpected network request');
  assert.equal(report.errors.length, 0, report.errors.join('\n'));
  assert.equal(result.summary.incomplete, 0, 'Incomplete translation');
  report.passed = true;
  console.log(JSON.stringify(result.summary));
  console.log(`Saved ${reportPath}`);
} catch (error) {
  report.errors.push(error.stack || String(error));
  throw error;
} finally {
  await context?.close();
  await save();
  await removeTestProfile(profile);
}
