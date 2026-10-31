import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { testEditorDiagnostics } from './test-editor-diagnostics.mjs';
import { testOverlayVisibility } from './test-overlay-visibility.mjs';
import { testYouTubeGeometry } from './test-youtube-geometry.mjs';
import { removeTestProfile, waitForWorkspace } from './browser-profile.mjs';

await mkdir('artifacts', { recursive: true }); await mkdir('.browser-check', { recursive: true });
const profile = await mkdtemp(path.resolve('.browser-check/editor-checks-'));
const fixture = await readFile('test-fixtures/inline.html');
const server = createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204).end(); return; }
  response.setHeader('Content-Type', 'text/html');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; style-src 'none'; img-src 'none'");
  response.end(fixture);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, extension = path.resolve('dist/extension');
const report = { checks: [], pageErrors: [], externalRequests: [] };
let context;
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 1280, height: 1000 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) { report.externalRequests.push(url.href); return route.abort(); }
    return route.continue();
  });
  context.on('page', page => page.on('pageerror', error => report.pageErrors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const page = await waitForWorkspace(context, extensionId);
  await page.waitForFunction(() => window.localEnglish?.initialized);
  await page.locator('#auto-check').uncheck();
  await page.setInputFiles('#model-file', process.env.MODEL_FILE_PATH || path.resolve('models/Qwen3.5-0.8B-UD-Q4_K_XL.gguf'));
  await page.click('#load');
  await page.waitForFunction(() => window.localEnglish.model.ready || !document.getElementById('error').hidden, undefined, { timeout: 180000 });
  assert.equal(await page.evaluate(() => window.localEnglish.model.ready), true);
  assert.equal(await page.evaluate(() => window.localEnglish.model.info.context), 1024);
  const site = await context.newPage(); await site.goto(origin);
  await testEditorDiagnostics({ context, page, site, worker, report });
  await testOverlayVisibility({ page, site, worker, report });
  await testYouTubeGeometry({ page, site, worker, report });
  assert.equal(await page.evaluate(() => window.localEnglish.model.loadCount), 1);
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
  report.passed = true;
  console.log(`PASS: ${report.checks.length} editor checks; real model reused; no external requests`);
} catch (error) { report.error = error.stack; process.exitCode = 1; console.error(error); }
finally {
  await writeFile('artifacts/editor-diagnostics-test.json', JSON.stringify(report, null, 2));
  await context?.close(); await new Promise(resolve => server.close(resolve));
  await removeTestProfile(profile);
}
