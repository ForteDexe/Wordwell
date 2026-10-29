import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { startServer } from './serve.mjs';

await mkdir('artifacts', { recursive: true });
const { server, url } = await startServer({ port: 0 });
const backend = process.env.BACKEND || 'auto';
const model = process.env.MODEL_FILE;
const suffix = process.env.REPORT_NAME || backend;
if (!/^[\w-]+$/.test(suffix)) throw new Error('Invalid report name');
let browser;
const errors = [];
const requests = [];
let page;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  // Fail closed on external HTTP requests: inference assets and model bytes must stay local.
  await context.route('**/*', route => {
    const requestURL = new URL(route.request().url());
    if (['http:', 'https:'].includes(requestURL.protocol)) {
      requests.push(requestURL.href);
      if (requestURL.origin !== url) { errors.push(`External request: ${requestURL.href}`); return route.abort(); }
    }
    return route.continue();
  });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('crash', () => errors.push('Browser page crashed'));
  page.on('console', message => {
    const text = message.text();
    if (text.startsWith('[engine-test]') || message.type() === 'error') console.log(text.slice(0, 1800));
  });
  const target = new URL(url);
  target.searchParams.set('backend', backend);
  if (model) target.searchParams.set('model', model);
  await page.goto(target.href);
  await page.waitForFunction(() => window.engineTest, undefined, { timeout: 30000 });
  const result = await Promise.race([
    page.evaluate(async () => { await window.engineTest.load(); return await window.engineTest.runSuite(); }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Engine test exceeded 10 minutes')), 600000); timer.unref(); }),
  ]);
  result.errors = errors;
  result.requests = requests;
  await writeFile(`artifacts/engine-${suffix}.json`, JSON.stringify(result, null, 2));
  await page.screenshot({ path: `artifacts/engine-${suffix}.png`, fullPage: true });
  if (result.contextLoaded !== 1024 || !result.suiteCompleted || errors.length) throw new Error('Engine verification failed; inspect report');
  console.log(`PASS: ${result.results.length} sentences, context ${result.contextLoaded}, ${result.backendSelected}, load ${(result.loadMs / 1000).toFixed(2)}s`);
} catch (error) {
  let partial = {};
  try { partial = await Promise.race([page?.evaluate(() => window.engineTest?.snapshot()), new Promise(resolve => setTimeout(() => resolve({ snapshotUnavailable: true }), 2000))]); } catch {}
  await writeFile(`artifacts/engine-${suffix}.json`, JSON.stringify({ ...partial, testError: error.message, errors, requests }, null, 2));
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
