import { chromium } from 'playwright';
import { openAsBlob } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { removeTestProfile, waitForWorkspace } from './browser-profile.mjs';
import { openEditBundle } from '../extension/edit-model-core.js';

// Requires a locally exported research bundle. No model downloads or user-profile changes.
const modelPath = process.env.EDIT_MODEL_PATH;
assert(modelPath, 'Set EDIT_MODEL_PATH to your local .wwedit bundle.');
const expectedBundle = await openEditBundle(await openAsBlob(modelPath));
const reportName = process.env.EDIT_REPORT_NAME || 'edit-model-browser';
assert(/^[\w-]+$/.test(reportName), 'EDIT_REPORT_NAME must be a filename without a path.');
const gpuFlags = process.env.PERF_GPU_PREFERENCE === 'high'
  ? ['--force-high-performance-gpu', '--use-webgpu-power-preference=force-high-performance'] : [];
if (process.env.EDIT_CPU === '1') gpuFlags.push('--disable-gpu', '--disable-software-rasterizer');
await mkdir('artifacts', { recursive: true });
await mkdir('.browser-check', { recursive: true });
const profile = await mkdtemp(path.resolve('.browser-check/extension-'));
const report = { date: new Date().toISOString(), gpuFlags, results: [], errors: [], externalRequests: [], console: [] };
let context;
async function launch() {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${path.resolve('dist/extension')}`, `--load-extension=${path.resolve('dist/extension')}`, ...gpuFlags] });
  await context.route('**/*', route => {
    if (/^https?:/.test(route.request().url())) { report.externalRequests.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  return { id: new URL(sw.url()).host, page: await waitForWorkspace(context, new URL(sw.url()).host, { timeout: 20000 }) };
}
async function ready(page) {
  await page.waitForFunction(() => window.localEnglish?.initialized && !window.localEnglish.snapshot().busy, null, { timeout: 120000 });
  assert.equal(await page.evaluate(() => window.localEnglish.model.ready), true, await page.locator('#error').textContent());
}
try {
  let { page, id } = await launch();
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warning') report.console.push(msg.text()); });
  await page.waitForFunction(() => window.localEnglish?.initialized);
  assert.equal(await page.locator('#engine-mode').inputValue(), 'browser', 'Existing default stays browser');
  await page.evaluate(() => chrome.storage.local.set({ targetLanguage: 'vi', customPrompt: 'Preserve meaning.', translationEnabled: true, pageTranslationEnabled: true }));
  await page.reload();
  await page.waitForFunction(() => window.localEnglish?.initialized);
  await page.locator('#auto-check').uncheck();
  if (process.env.MODEL_FILE_PATH) {
    await page.setInputFiles('#model-file', process.env.MODEL_FILE_PATH);
    await page.locator('#load').click(); await ready(page);
    await page.evaluate(() => { window.oldBrowserRuntime = window.localEnglish.model.runtime; });
  }
  await page.locator('#engine-mode').selectOption('edit');
  await page.waitForFunction(() => !window.localEnglish.snapshot().busy);
  assert.equal(await page.locator('#engine-mode option:checked').innerText(), 'Edit model');
  assert.equal(await page.evaluate(() => window.localEnglish.model.ready), false);
  if (process.env.MODEL_FILE_PATH) assert.equal(await page.evaluate(() => window.oldBrowserRuntime.isModelLoaded()), false);
  assert.equal(await page.locator('#target-language').inputValue(), 'en');
  for (const name of ['target-language', 'translation-enabled', 'page-translation-enabled']) assert.equal(await page.locator(`#${name}`).isDisabled(), true);
  await page.setInputFiles('#edit-file', modelPath);
  console.log('Loading edit bundle in Chrome…');
  await page.locator('#load-edit').click();
  await ready(page);
  report.info = await page.evaluate(() => window.localEnglish.model.info);
  assert.equal(report.info.engine, 'GECToR / ONNX Runtime');
  assert.equal(report.info.context, expectedBundle.config.context);
  assert.equal(report.info.inputLimit, expectedBundle.budget.inputLimit);
  assert.equal(report.info.safetyMargin, expectedBundle.budget.safetyMargin);
  assert.match(await page.locator('#context-badge').innerText(), new RegExp(`${report.info.context.toLocaleString()} input tokens`));
  if (process.env.EDIT_CPU === '1') assert.equal(report.info.backend, 'CPU / WebAssembly');
  console.log(JSON.stringify(report.info));
  report.environment = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    return { userAgent: navigator.userAgent, adapter: adapter?.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description } : null };
  });
  await page.locator('#original').fill('She go to school every day.');
  await page.waitForFunction(context => document.getElementById('token-count').textContent.endsWith(`/ ${context.toLocaleString()} input tokens`) && !document.getElementById('token-count').textContent.startsWith('…'), report.info.context);
  assert.ok((await page.locator('#token-count').getAttribute('title')).includes(report.info.inputLimit.toLocaleString()));
  await page.locator('#correct').click();
  await page.waitForFunction(() => !window.localEnglish.model.busy);
  assert.equal(await page.locator('#corrected').inputValue(), 'She goes to school every day.');
  assert.equal(await page.locator('#error').isHidden(), true);
  const response = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'inline-correct', text: 'She go to school every day.' }));
  assert.equal(response.result.corrected, 'She goes to school every day.');
  assert.equal(response.result.language, 'en');
  assert.equal(response.result.promptOverride, 'Preserve meaning.');
  const startEdit = await page.evaluate(() => window.localEnglish.model.correct('Most important thing is honesty.'));
  assert.equal(startEdit.corrected, 'The most important thing is honesty.', 'A high-confidence edit at the virtual sentence start must enable the correction');
  const startInline = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'inline-correct', text: 'Most important thing is honesty.' }));
  assert.equal(startInline.result.corrected, 'The most important thing is honesty.');
  await page.locator('#spelling-enabled').check();
  const spelling = await page.evaluate(() => window.localEnglish.model.correct('theriotically it is dead'));
  assert.equal(spelling.original, 'theriotically it is dead');
  assert.equal(spelling.corrected, 'Theoretically, it is dead.');
  assert.equal(spelling.spellingEnabled, true);
  await page.locator('#spelling-enabled').uncheck();
  assert.equal(await page.evaluate(() => window.localEnglish.model.speller.worker === null), true);
  await page.locator('#auto-check').check();
  await page.locator('#original').fill('She go to school every day.');
  await page.locator('local-english-selection .auto-underline').first().waitFor({ state: 'visible' });
  assert.equal(await page.locator('local-english-selection .auto-status').innerText(), '1');
  await page.locator('#original').evaluate(node => { node.focus(); node.select(); node.dispatchEvent(new Event('select', { bubbles: true })); });
  await page.getByRole('button', { name: 'Refine selected text', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('button', { name: 'Translate selected text', exact: true }).isVisible(), false);
  await page.locator('#original').fill('Most important thing is honesty.');
  await page.waitForFunction(() => [...document.querySelector('local-english-selection').shadowRoot.querySelectorAll('.auto-underline')]
    .some(mark => mark.getAttribute('aria-label').includes('Most')));
  await page.locator('local-english-selection .auto-underline').first().click();
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  assert.equal(await page.locator('#original').inputValue(), 'The most important thing is honesty.');
  await page.locator('#auto-check').uncheck();
  const unsupported = await page.evaluate(async () => {
    try { await window.localEnglish.model.translate('Hello', 'vi'); return null; } catch (e) { return e.message; }
  });
  assert.match(unsupported, /Translation is unavailable/);
  const multiline = await page.evaluate(() => window.localEnglish.model.correct('She go to school every day.\r\n\r\n  The books is on the table.  '));
  assert.equal(multiline.corrected, 'She goes to school every day.\r\n\r\n  The books are on the table.  ');
  const long = await page.evaluate(() => window.localEnglish.model.correct('This sentence is correct. '.repeat(100)));
  assert.ok(long.budget.chunks.length > 1);
  assert.equal(long.corrected, 'This sentence is correct. '.repeat(100));
  report.longTextChunks = long.budget.chunks.length;
  const boundary = await page.evaluate(async () => {
    const text = 'This sentence is correct. '.repeat(20);
    const count = await window.localEnglish.model.countTokens(text);
    return { text, count, result: await window.localEnglish.model.correct(text) };
  });
  assert.equal(boundary.result.corrected, boundary.text);
  assert.equal(boundary.result.budget.context, report.info.context);
  assert.equal(boundary.result.budget.safetyMargin, report.info.safetyMargin);
  assert.ok(boundary.result.budget.chunks.every(part => part.promptTokens <= report.info.inputLimit));
  if (boundary.count.prompt_tokens > report.info.inputLimit) assert.ok(boundary.result.budget.chunks.length > 1);
  await page.locator('#benchmark-panel').evaluate(node => { node.open = true; });
  await page.locator('#benchmark-run').click();
  await page.waitForFunction(() => window.localEnglish.benchmark.report?.completed && !window.localEnglish.benchmark.running);
  const benchmark = await page.evaluate(() => window.localEnglish.benchmark.report);
  assert.equal(benchmark.results.length, 16);
  assert.equal(benchmark.summary.errors, 0);
  assert.equal(benchmark.prompt, null);
  assert.deepEqual(benchmark.sampling, { maxIterations: 5 });
  await page.locator('#benchmark-panel').evaluate(node => { node.open = false; });
  if (process.env.EDIT_CASES_FILE) {
    const cases = JSON.parse(await readFile(process.env.EDIT_CASES_FILE, 'utf8'));
    console.log(`Checking ${cases.length} cases…`);
    for (const [index, row] of cases.entries()) {
      const result = await page.evaluate(text => window.localEnglish.model.correct(text), row.input ?? row.text);
      report.results.push({ id: row.id, input: row.input ?? row.text, output: result.corrected, seconds: result.seconds, budget: result.budget });
      if ((index + 1) % 32 === 0) console.log(`${index + 1}/${cases.length}`);
    }
    const times = report.results.map(r => r.seconds * 1000).sort((a, b) => a - b);
    report.medianMs = (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2;
    console.log(`Median ${report.medianMs.toFixed(1)} ms`);
  }
  await page.screenshot({ path: 'artifacts/edit-model-mode.png', fullPage: true });
  const oldInstance = report.info.instanceId;
  await context.close();
  // Same disposable profile, genuine browser restart; service worker opens saved engine automatically.
  ({ page, id } = await launch());
  await ready(page);
  assert.equal(await page.locator('#engine-mode').inputValue(), 'edit');
  assert.notEqual(await page.evaluate(() => window.localEnglish.model.info.instanceId), oldInstance);
  await page.evaluate(() => { window.oldEditRuntime = window.localEnglish.model.runtime; });
  await page.locator('#engine-mode').selectOption('browser');
  await page.waitForFunction(() => !window.localEnglish.snapshot().busy);
  assert.equal(await page.evaluate(() => window.oldEditRuntime.worker), null, 'Previous worker is terminated');
  if (process.env.MODEL_FILE_PATH) {
    await ready(page);
    assert.equal(await page.evaluate(() => window.localEnglish.model.info.file), path.basename(process.env.MODEL_FILE_PATH));
    report.browserModelRestored = true;
  } else assert.equal(await page.evaluate(() => window.localEnglish.model.runtime), null);
  assert.equal(await page.locator('#target-language').inputValue(), 'vi');
  assert.equal(await page.locator('#translation-enabled').isChecked(), true);
  assert.equal(await page.locator('#translation-enabled').isEnabled(), true);
  assert.equal(await page.locator('#page-translation-enabled').isChecked(), true);
  assert.equal(await page.locator('#custom-prompt').inputValue(), 'Preserve meaning.');
  await page.locator('#engine-mode').selectOption('edit');
  await ready(page);
  await page.locator('#unload-edit').click();
  await page.waitForFunction(() => !window.localEnglish.snapshot().busy);
  await page.setInputFiles('#edit-file', { name: 'broken.wwedit', mimeType: 'application/octet-stream', buffer: Buffer.from('not a valid bundle') });
  await page.locator('#load-edit').click();
  await page.waitForFunction(() => !window.localEnglish.snapshot().busy);
  assert.equal(await page.locator('#error').isVisible(), true);
  assert.equal(await page.evaluate(() => window.localEnglish.model.ready), false);
  await page.locator('#engine-mode').selectOption('browser');
  await page.waitForFunction(() => !window.localEnglish.snapshot().busy);
  assert.equal(await page.locator('#error').isHidden(), true);
  const cacheChecks = await page.evaluate(async () => {
    const gguf = await import('./model-cache.js'), edit = await import('./edit-model-cache.js');
    const before = { gguf: await gguf.savedModelInfo(), edit: await edit.savedEditInfo() };
    await edit.forgetEditModel();
    const afterEdit = { gguf: await gguf.savedModelInfo(), edit: await edit.savedEditInfo() };
    await edit.rememberEditModel(new File(['test bundle'], 'cache-isolation.wwedit'));
    await gguf.forgetModel();
    return { before, afterEdit, afterGGUF: await edit.savedEditInfo() };
  });
  assert.ok(cacheChecks.before.edit);
  assert.equal(cacheChecks.afterEdit.edit, undefined);
  assert.deepEqual(cacheChecks.afterEdit.gguf, cacheChecks.before.gguf);
  assert.equal(cacheChecks.afterGGUF.name, 'cache-isolation.wwedit');
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('wordwell-edit-models'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('model', 'readwrite'); tx.objectStore('model').delete('file'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close(); await chrome.storage.local.set({ engineMode: 'edit' });
  });
  await page.reload();
  await page.waitForFunction(() => window.localEnglish?.initialized);
  assert.match(await page.locator('#error').innerText(), /saved edit bundle is missing/);
  assert.equal(await page.evaluate(() => chrome.action.getBadgeText({})), '!');
  await page.locator('#forget-edit').click();
  await page.waitForFunction(async () => await chrome.action.getBadgeText({}) === '');
  report.passed = true;
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.externalRequests, []);
  console.log('PASS: edit mode, English correction, inline requests, line/chunk handling, autoload, switching engines, saved preferences, worker cleanup, and load-error recovery');
} finally {
  await writeFile(`artifacts/${reportName}${process.env.EDIT_CPU === '1' ? '-cpu' : ''}.json`, JSON.stringify(report, null, 2) + '\n');
  await context?.close();
  await removeTestProfile(profile);
}
