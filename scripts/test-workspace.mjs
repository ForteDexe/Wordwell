import { chromium } from 'playwright';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { removeTestProfile } from './browser-profile.mjs';
import { testWorkspaceSettings } from './test-workspace-settings.mjs';
import { testCorrectionLanguages } from './test-languages.mjs';
import { testPromptSettings } from './test-prompts.mjs';
import { testTranslation } from './test-translation.mjs';
import { testPageTranslation } from './test-page-translation.mjs';

await mkdir('artifacts', { recursive: true });
await mkdir('.browser-check', { recursive: true });
const profile = await mkdtemp(path.resolve('.browser-check/extension-'));
const extension = path.resolve('dist/extension');
const report = { checks: [], pageErrors: [], externalRequests: [] };
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--force-high-performance-gpu', '--use-webgpu-power-preference=force-high-performance'],
  });
  context.on('page', page => page.on('pageerror', error => report.pageErrors.push(error.message)));
  await context.route('**/*', route => {
    if (/^https?:/.test(route.request().url())) { report.externalRequests.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/workspace.html`);
  await page.waitForFunction(() => window.localEnglish?.initialized);
  await page.locator('#auto-check').uncheck();
  await page.setInputFiles('#model-file', process.env.MODEL_FILE_PATH || path.resolve('models/Qwen3.5-0.8B-UD-Q6_K_XL.gguf'));
  await page.click('#load');
  await page.waitForFunction(() => window.localEnglish.model.ready || !document.getElementById('error').hidden, undefined, { timeout: 180000 });
  assert.equal(await page.evaluate(() => window.localEnglish.model.ready), true);
  await testWorkspaceSettings({ page, report });
  await testCorrectionLanguages({ page, report });
  await testPromptSettings({ page, report });
  await testTranslation({ page, report });
  await testPageTranslation({ page, context, report });
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.externalRequests, []);
  report.passed = true;
  console.log(`PASS: ${report.checks.length} workspace checks; no external requests`);
} catch (error) { report.error = error.stack; console.error(error); process.exitCode = 1; }
finally {
  await writeFile('artifacts/workspace-test.json', JSON.stringify(report, null, 2));
  await context?.close();
  await removeTestProfile(profile);
}
