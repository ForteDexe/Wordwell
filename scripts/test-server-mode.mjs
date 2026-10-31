import { createServer } from 'node:http';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { removeTestProfile, waitForWorkspace } from './browser-profile.mjs';

const tokenCount = text => text ? Math.ceil(text.length / 4) : 0;
const promptFor = body => `${body.messages.map(message => `${message.role.toUpperCase()}: ${message.content}`).join('\n')}\nASSISTANT:`;
const requests = { health: 0, props: 0, template: 0, tokenize: 0, chat: 0 };
const server = createServer(async (request, response) => {
  const origin = request.headers.origin || '*';
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Headers', 'content-type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const send = value => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
  if (request.url === '/health') { requests.health += 1; send({ status: 'ok' }); return; }
  if (request.url === '/props') {
    requests.props += 1;
    send({ model_alias: 'wordwell-test.gguf', build_info: 'test-build', total_slots: 1, default_generation_settings: { n_ctx: 1024 } }); return;
  }
  if (request.url === '/apply-template') { requests.template += 1; send({ prompt: promptFor(body) }); return; }
  if (request.url === '/tokenize') { requests.tokenize += 1; send({ tokens: Array.from({ length: tokenCount(body.content) }, (_, index) => index) }); return; }
  if (request.url === '/v1/chat/completions') {
    requests.chat += 1;
    const corrected = body.messages.at(-1).content === 'Yesterday I go to the shop.' ? 'Yesterday I went to the shop.' : body.messages.at(-1).content;
    const prompt_tokens = tokenCount(promptFor(body)), completion_tokens = tokenCount(corrected);
    send({ choices: [{ message: { role: 'assistant', content: corrected }, finish_reason: 'stop' }], usage: { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens } }); return;
  }
  response.statusCode = 404; send({ error: { message: 'Not found' } });
});

await mkdir('artifacts', { recursive: true });
await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
const endpoint = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.resolve('.browser-check/extension-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${path.resolve('dist/extension')}`, `--load-extension=${path.resolve('dist/extension')}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await waitForWorkspace(context, new URL(worker.url()).host);
  await page.waitForFunction(() => window.localEnglish?.initialized);
  await page.evaluate(endpoint => chrome.storage.local.set({ serverUrl: endpoint }), endpoint);
  await page.reload();
  await page.waitForFunction(() => window.localEnglish?.initialized);
  await page.locator('#engine-mode').selectOption('server');
  await page.waitForFunction(() => window.localEnglish?.initialized && (window.localEnglish.model.ready || !document.getElementById('error').hidden));
  assert.equal(await page.evaluate(() => window.localEnglish.model.ready), true, await page.locator('#error').textContent());
  assert.equal(await page.locator('#engine-mode').inputValue(), 'server');
  assert.equal(await page.locator('#browser-engine').isHidden(), true);
  assert.equal(await page.locator('#server-engine').isVisible(), true);
  assert.deepEqual(await page.evaluate(() => ({ model: window.localEnglish.model.info.model, context: window.localEnglish.model.info.context, endpoint: window.localEnglish.model.info.endpoint })),
    { model: 'wordwell-test.gguf', context: 1024, endpoint });
  await page.screenshot({ path: 'artifacts/server-mode.png', fullPage: true });

  await page.locator('#original').fill('Yesterday I go to the shop.');
  await page.waitForFunction(() => /^\d[\d,]* \/ 1,024 prompt tokens$/.test(document.getElementById('token-count').textContent));
  await page.locator('#correct').click();
  await page.waitForFunction(() => !window.localEnglish.model.busy);
  assert.equal(await page.locator('#corrected').inputValue(), 'Yesterday I went to the shop.');
  assert.equal(await page.locator('#error').isHidden(), true);

  const inline = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'inline-correct', text: 'Yesterday I go to the shop.' }));
  assert.equal(inline.result.corrected, 'Yesterday I went to the shop.');

  const instance = await page.evaluate(() => window.localEnglish.model.info.instanceId);
  await page.reload();
  await page.waitForFunction(() => window.localEnglish?.initialized && window.localEnglish.model.ready);
  assert.notEqual(await page.evaluate(() => window.localEnglish.model.info.instanceId), instance);
  assert.ok(requests.health >= 2, 'Saved server mode should reconnect after a workspace reload');

  await page.locator('#disconnect-server').click();
  await page.locator('#server-url').fill('http://127.0.0.1:1');
  await page.locator('#connect-server').click();
  await page.waitForFunction(() => !document.getElementById('error').hidden && !window.localEnglish.model.busy);
  assert.match(await page.locator('#error').innerText(), /127\.0\.0\.1:1/);
  assert.equal(await page.evaluate(() => window.localEnglish.model.ready), false);
  await page.locator('#server-url').fill('https://example.com:443');
  await page.locator('#connect-server').click();
  await page.waitForFunction(() => document.getElementById('error').textContent.includes('local HTTP address'));
  assert.equal(await page.evaluate(() => window.localEnglish.model.ready), false);

  await page.locator('#engine-mode').selectOption('browser');
  await page.waitForFunction(() => window.localEnglish.model.engineMode === 'browser' && !window.localEnglish.model.ready && !document.getElementById('browser-engine').hidden);
  assert.equal((await page.evaluate(() => chrome.storage.local.get('engineMode'))).engineMode, 'browser');
  assert.ok(requests.template >= 3 && requests.tokenize >= 6 && requests.chat === 2);
  console.log(`PASS: llama.cpp server mode connected, counted tokens, corrected workspace and inline text, reconnected, and switched back (${endpoint})`);
} finally {
  await context?.close();
  await removeTestProfile(profile);
  await new Promise(resolve => server.close(resolve));
}
