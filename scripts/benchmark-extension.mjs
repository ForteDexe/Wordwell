import { chromium } from 'playwright';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { removeTestProfile, waitForWorkspace } from './browser-profile.mjs';

// Run serially in a disposable extension profile: no server or model download.
// Compare different inputs, not just the unrealistically fast identical prompt.
const modelPath = process.env.MODEL_FILE_PATH || path.resolve('models/Qwen3.5-0.8B-UD-Q6_K_XL.gguf');
const rounds = Number(process.env.PERF_ROUNDS || 1);
assert(Number.isInteger(rounds) && rounds >= 1 && rounds <= 10, 'PERF_ROUNDS must be 1–10');
const variants = {
  baseline: {}, cache: { cache: true }, batch256: { batch: 256 },
  threads4: { threads: 4 }, threads1: { threads: 1 }, cpu: { gpu: false },
  'baseline-repeat': {}, 'cache-repeat': { cache: true },
  'short-prompt': { instruction: 'Fix English spelling, grammar, and sentence structure with minimal edits. Preserve meaning. Return only the corrected text; leave correct text unchanged.' },
  'short-cache': { cache: true, instruction: 'Fix English spelling, grammar, and sentence structure with minimal edits. Preserve meaning. Return only the corrected text; leave correct text unchanged.' },
};
const names = (process.env.PERF_CONFIGS || 'baseline,cache,batch256,threads4,threads1,baseline-repeat').split(',');
assert(names.every(name => Object.hasOwn(variants, name)), 'Unknown PERF_CONFIGS variant');
const suffix = process.env.REPORT_NAME || 'sweep';
assert(/^[\w-]+$/.test(suffix), 'Invalid REPORT_NAME');
// These switches apply only to this disposable test browser, never the user's.
const gpuFlags = process.env.PERF_GPU_PREFERENCE === 'high'
  ? ['--force-high-performance-gpu', '--use-webgpu-power-preference=force-high-performance'] : [];
const cases = JSON.parse(await readFile('engine-test/cases.json', 'utf8'));
await mkdir('artifacts', { recursive: true });
await mkdir('.browser-check', { recursive: true });
const profile = await mkdtemp(path.resolve('.browser-check/editor-checks-'));
const reportPath = `artifacts/performance-${suffix}.json`;
const report = { date: new Date().toISOString(), modelPath, rounds, context: 1024, gpuFlags, probeOnly: !!process.env.PERF_PROBE, results: [], errors: [], externalRequests: [] };
let context;
const median = values => { const sorted = [...values].sort((a, b) => a - b); return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2; };
const save = () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
try {
  const extensionPath = path.resolve('dist/extension');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: !process.env.HEADED,
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
  page.on('crash', () => report.errors.push('Browser page crashed'));
  await page.waitForFunction(() => window.localEnglish?.initialized);
  await page.locator('#auto-check').uncheck();
  await page.setInputFiles('#model-file', modelPath);
  report.browser = context.browser()?.version();
  report.environment = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    window.perfHasGPU = !!adapter;
    window.perfFile = document.querySelector('#model-file').files[0];
    return { hardwareConcurrency: navigator.hardwareConcurrency, userAgent: navigator.userAgent,
      adapter: adapter?.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description } : null };
  });
  console.log(`Environment: ${JSON.stringify(report.environment)}`);
  if (process.env.PERF_PROBE) names.length = 0;
  for (const name of names) {
    console.log(`Benchmarking ${name}…`);
    const result = await page.evaluate(async ({ name, variant, cases, rounds }) => {
      const { Wllama } = await import('./vendor/index.js');
      const { INSTRUCTION } = await import('./model-engine.js');
      const logs = [];
      const runtime = new Wllama({ default: chrome.runtime.getURL('vendor/wasm/wllama.wasm') }, {
        logger: { debug() {}, log: (...args) => logs.push(args.join(' ')), warn: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push(args.join(' ')) },
      });
      const options = {
        n_ctx: 1024, n_parallel: 1, n_batch: variant.batch || 128, n_ubatch: variant.batch || 128,
        n_threads: variant.threads || Math.max(1, Math.min(8, Math.floor(navigator.hardwareConcurrency / 2))),
        n_gpu_layers: variant.gpu === false || !window.perfHasGPU ? 0 : 99999, cache_type_k: 'f16', cache_type_v: 'f16',
        jinja: true, reasoning: false, default_template_kwargs: { enable_thinking: false }, seed: 42,
      };
      const started = performance.now();
      const samples = [];
      try {
        await runtime.loadModel([window.perfFile], options);
        const loadSeconds = (performance.now() - started) / 1000;
        const context = runtime.getLoadedContextInfo();
        if (context.n_ctx !== 1024) throw new Error('Wrong context size');
        async function check(input) {
          const start = performance.now();
          const response = await runtime.createChatCompletion({
            messages: [{ role: 'system', content: variant.instruction || INSTRUCTION }, { role: 'user', content: input }],
            temperature: 0, seed: 42, max_tokens: 128, top_p: 1, top_k: 1,
            repeat_penalty: 1, presence_penalty: 0, cache_prompt: !!variant.cache,
            chat_template_kwargs: { enable_thinking: false },
            abortSignal: AbortSignal.timeout(60000),
          });
          return { input, output: response.choices[0].message.content?.trim(), seconds: (performance.now() - start) / 1000,
            finishReason: response.choices[0].finish_reason, usage: response.usage, timings: response.timings };
        }
        // Exclude first-generation shader/runtime warmup from steady-state times.
        const warmup = await check('This is a warmup sentence.');
        for (let round = 0; round < rounds; round++) {
          // Reverse every other round to catch dependence on previous sentences.
          const ordered = round % 2 ? [...cases].reverse() : cases;
          for (const item of ordered) samples.push({ ...await check(item.input), round, category: item.category, reference: item.reference });
        }
        return { name, options, instruction: variant.instruction || INSTRUCTION, cache: !!variant.cache, context: context.n_ctx, threads: runtime.getNumThreads(),
          loadSeconds, warmup, samples, logs: logs.filter(line => /adapter|device|GPU|error|cache|offload/i.test(line)).slice(-45) };
      } finally { await runtime.exit(); }
    }, { name, variant: variants[name], cases, rounds });
    const times = result.samples.map(sample => sample.seconds);
    result.summary = { medianSeconds: median(times), p90Seconds: [...times].sort((a, b) => a - b)[Math.ceil(times.length * 0.9) - 1],
      medianPromptMs: median(result.samples.map(sample => sample.timings?.prompt_ms ?? NaN)),
      medianGenerationMs: median(result.samples.map(sample => sample.timings?.predicted_ms ?? NaN)),
      medianCachedTokens: median(result.samples.map(sample => sample.usage?.prompt_tokens_details?.cached_tokens ?? 0)),
      referenceMatches: result.samples.filter(sample => sample.output === sample.reference).length,
      controlsUnchanged: result.samples.filter(sample => sample.category === 'correct control' && sample.output === sample.input).length,
      total: times.length, incomplete: result.samples.filter(sample => sample.finishReason !== 'stop').length };
    const baseline = report.results.find(item => item.name === 'baseline');
    if (baseline) {
      result.differences = result.samples.flatMap(sample => {
        const previous = baseline.samples.find(other => other.input === sample.input && other.round === sample.round);
        return previous?.output === sample.output ? [] : [{ input: sample.input, round: sample.round, baseline: previous?.output, output: sample.output }];
      });
      result.summary.differentFromBaseline = result.differences.length;
    }
    report.results.push(result);
    await save();
    console.log(`${name}: ${JSON.stringify(result.summary)}`);
  }
  assert.equal(report.externalRequests.length, 0, 'Unexpected network request');
  assert.equal(report.errors.length, 0, report.errors.join('\n'));
  assert(report.results.every(result => result.summary.incomplete === 0), 'Incomplete generation');
  report.passed = true;
  console.log(`Saved ${reportPath}`);
} catch (error) {
  report.errors.push(error.stack || String(error));
  throw error;
} finally {
  await context?.close();
  await save();
  await removeTestProfile(profile);
}
