import { checkWorkspace } from './workspace-check.mjs';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { removeTestProfile, waitForWorkspace } from './browser-profile.mjs';

// Echo grammar server isolates spelling changes from model quality.
const count = value => Math.ceil(value.length / 4);
const prompt = body => body.messages.map(m => `${m.role}: ${m.content}`).join('\n') + '\nassistant:';
const inputs = [], external = [], errors = [];
let release, held;
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  let raw = ''; for await (const part of req) raw += part;
  const body = raw ? JSON.parse(raw) : {};
  const send = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  if (req.url === '/health') return send({ status: 'ok' });
  if (req.url === '/props') return send({ model_alias: 'spelling-fixture', default_generation_settings: { n_ctx: 1024 } });
  if (req.url === '/apply-template') return send({ prompt: prompt(body) });
  if (req.url === '/tokenize') return send({ tokens: Array(count(body.content)).fill(1) });
  if (req.url === '/v1/chat/completions') {
    const text = body.messages.at(-1).content; inputs.push(text);
    if (held) { const gate = held; held = null; await gate; }
    const prompt_tokens = count(prompt(body)), completion_tokens = count(text);
    return send({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens } });
  }
  res.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}`;
await mkdir('.browser-check', { recursive: true }); await mkdir('artifacts', { recursive: true });
const profile = await mkdtemp(path.resolve('.browser-check/extension-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${path.resolve('dist/extension')}`, `--load-extension=${path.resolve('dist/extension')}`] });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (/^https?:/.test(url) && !url.startsWith(endpoint + '/')) { external.push(url); return route.abort(); }
    return route.continue();
  });
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await waitForWorkspace(context, new URL(sw.url()).host);
  page.on('pageerror', e => errors.push(e.message));
  await page.waitForFunction(() => window.localEnglish?.initialized);
  await page.locator('#auto-check').uncheck();
  assert.equal(await page.locator('#spelling-enabled').isChecked(), false);
  assert.equal(await page.evaluate(() => window.localEnglish.model.speller.worker === null), true);
  await page.evaluate(endpoint => chrome.storage.local.set({ serverUrl: endpoint }), endpoint);
  await page.reload(); await page.waitForFunction(() => window.localEnglish?.initialized);
  await page.locator('#engine-mode').selectOption('server');
  await page.waitForFunction(() => window.localEnglish.model.ready);

  const original = 'theriotically it is dead';
  const before = await page.evaluate(text => window.localEnglish.model.correct(text), original);
  assert.equal(before.corrected, original);
  assert.equal(await page.evaluate(() => window.localEnglish.model.speller.worker === null), true);
  await page.locator('#spelling-enabled').check();
  const timing = await page.evaluate(async text => {
    const model = window.localEnglish.model, started = performance.now();
    const cold = await model.speller.correct(text), coldMs = performance.now() - started;
    const times = [];
    for (let i = 0; i < 20; i++) { const t = performance.now(); await model.speller.correct(text); times.push(performance.now() - t); }
    return { cold, coldMs, warmMedianMs: times.sort((a, b) => a - b)[Math.floor(times.length / 2)] };
  }, original);
  assert.equal(timing.cold.corrected, 'theoretically it is dead');
  await page.locator('#original').fill(original);
  await checkWorkspace(page);
  await page.waitForFunction(() => !window.localEnglish.model.busy);
  assert.equal(await page.evaluate(() => window.workspaceCheck?.result?.corrected || ''), 'theoretically it is dead');
  assert.equal(await page.evaluate(() => window.workspaceCheck?.result.original), original);
  assert.equal(inputs.at(-1), 'theoretically it is dead');
  const preview = await page.evaluate(text => window.localEnglish.model.countTokens(text), original);
  const result = await page.evaluate(() => window.workspaceCheck?.result);
  assert.equal(preview.prompt_tokens, result.budget.chunks[0].promptTokens);
  assert.equal(result.spellingEnabled, true);

  // The same shared pipeline is used by browser GGUF and edit engines.
  const modes = await page.evaluate(async text => {
    const { LocalModel } = await import('./model-engine.js');
    const results = [];
    for (const mode of ['browser', 'edit']) {
      const m = new LocalModel(() => {}); m.setMode(mode); m.ready = true;
      m.info = { instanceId: mode, context: 512, inputLimit: 480, safetyMargin: 32 };
      const inputs = [];
      m.runtime = { count: async value => ({ prompt_tokens: value.length, text_tokens: value.length }),
        correct: async value => { inputs.push(value); return { corrected: value, passes: 1 }; },
        countChatTokens: async request => ({ prompt_tokens: request.messages.at(-1).content.length, text_tokens: request.messages.at(-1).content.length }),
        createChatCompletion: async request => { const value = request.messages.at(-1).content; inputs.push(value);
          return { choices: [{ message: { content: value }, finish_reason: 'stop' }], usage: { prompt_tokens: value.length, completion_tokens: 1, total_tokens: value.length + 1 } }; }, exit: async () => {} };
      m.setSpellingEnabled(true);
      const count = await m.countTokens(text), result = await m.correct(text);
      results.push({ mode, count, result, inputs }); await m.unload();
    }
    return results;
  }, original);
  for (const mode of modes) {
    assert.equal(mode.result.original, original); assert.equal(mode.result.corrected, 'theoretically it is dead');
    assert.equal(mode.inputs[0], 'theoretically it is dead');
    assert.equal(mode.count.prompt_tokens, mode.result.budget.chunks[0].promptTokens);
  }
  const translation = await page.evaluate(text => window.localEnglish.model.translate(text, 'vi'), original);
  assert.equal(translation.corrected, original); assert.equal(inputs.at(-1), original);
  await page.locator('#target-language').selectOption('vi');
  assert.equal(await page.locator('#spelling-enabled').isDisabled(), true);
  assert.equal(await page.locator('#spelling-enabled').isChecked(), true);
  const foreign = await page.evaluate(text => window.localEnglish.model.correct(text), original);
  assert.equal(foreign.corrected, original); assert.equal(inputs.at(-1), original);
  await page.locator('#target-language').selectOption('en');
  assert.equal(await page.locator('#spelling-enabled').isDisabled(), false);

  await page.reload();
  await page.waitForFunction(() => window.localEnglish?.initialized && window.localEnglish.model.ready);
  assert.equal(await page.locator('#spelling-enabled').isChecked(), true);
  assert.equal(await page.evaluate(() => window.localEnglish.model.speller.worker === null), true, 'Do not parse the dictionary just for restoring Settings');

  await page.locator('#auto-check').check();
  await page.locator('#original').fill(original);
  const underline = page.locator('local-english-selection .auto-underline');
  await underline.first().waitFor({ state: 'visible' });
  await underline.first().click();
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  assert.equal(await page.locator('#original').inputValue(), 'theoretically it is dead');
  await page.locator('#original').press('Control+z');
  assert.equal(await page.locator('#original').inputValue(), original);
  await underline.first().waitFor({ state: 'visible' });
  const beforeDisable = inputs.length;
  const checksBeforeDisable = await page.evaluate(() => window.localEnglish.model.checkCount);
  await page.evaluate(() => chrome.storage.local.set({ spellingEnabled: false }));
  await page.waitForFunction(() => document.querySelector('local-english-selection').shadowRoot.querySelectorAll('.auto-underline').length === 0 && window.localEnglish.model.speller.worker === null);
  await page.waitForFunction(before => window.localEnglish.model.checkCount > before && !window.localEnglish.model.busy, checksBeforeDisable);
  // Keep the same focused text: enabling must invalidate the cached no-change result.
  await page.evaluate(() => chrome.storage.local.set({ spellingEnabled: true }));
  await underline.first().waitFor({ state: 'visible' });
  assert.ok(inputs.length > beforeDisable);
  await page.screenshot({ path: 'artifacts/spelling-settings.png', fullPage: true });
  await page.locator('#auto-check').uncheck();
  await page.waitForFunction(() => !window.localEnglish.model.busy);
  // A setting change while an inference request is outstanding discards its result.
  held = new Promise(resolve => { release = resolve; });
  await page.evaluate(text => { window.pendingSpelling = chrome.runtime.sendMessage({ type: 'inline-correct', text }); }, original);
  await page.waitForFunction(() => window.localEnglish.model.busy);
  await page.evaluate(() => chrome.storage.local.set({ spellingEnabled: false }));
  await page.waitForFunction(() => !window.localEnglish.model.spellingEnabled);
  release();
  const stale = await page.evaluate(() => window.pendingSpelling);
  assert.equal(stale.code, 'superseded');
  assert.equal(await page.evaluate(() => window.localEnglish.model.speller.worker === null), true);
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  await writeFile('artifacts/spelling-browser.json', JSON.stringify({ timing, checks: ['off by default', 'all engines', 'raw original retained', 'exact token budgeting', 'translation bypass', 'English only', 'persistence', 'lazy worker', 'automatic underlines', 'Replace and Undo', 'cache invalidation', 'stale result discarded', 'worker released', 'no external requests'], errors, external }, null, 2));
  console.log(`PASS: spelling settings and correction pipeline; cold ${timing.coldMs.toFixed(1)} ms, warm median ${timing.warmMedianMs.toFixed(1)} ms.`);
} finally {
  release?.(); await context?.close(); await removeTestProfile(profile); await new Promise(resolve => server.close(resolve));
}
