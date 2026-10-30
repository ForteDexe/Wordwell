import { chromium } from 'playwright';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { removeTestProfile, waitForWorkspace } from './browser-profile.mjs';

await mkdir('.browser-check', { recursive: true });
const profile = await mkdtemp(path.resolve('.browser-check/extension-'));
const extension = path.resolve('dist/extension');
let context;
const launch = () => chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
try {
  context = await launch();
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const page = await waitForWorkspace(context, extensionId);
  await page.waitForFunction(() => window.localEnglish?.initialized);
  await page.waitForFunction(async () => (await chrome.storage.local.get('setupOpened')).setupOpened === true);
  assert.equal(await page.evaluate(() => window.localEnglish.model.ready), false);
  assert.equal(await page.locator('#setup-privacy').isVisible(), true);
  const first = await page.evaluate(async () => {
    const tabs = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [chrome.runtime.getURL('workspace.html')] });
    return { count: tabs.length, active: (await chrome.tabs.get(tabs[0].tabId)).active };
  });
  assert.deepEqual(first, { count: 1, active: true });
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'open-workspace' }));
  assert.equal(await page.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [chrome.runtime.getURL('workspace.html')] })).length), 1);

  const blank = await context.newPage(); await blank.goto('about:blank'); await blank.bringToFront();
  await page.close();
  await context.close();
  context = await launch();
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await new Promise(resolve => setTimeout(resolve, 1000));
  const after = await worker.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [chrome.runtime.getURL('workspace.html')] })).length);
  assert.equal(after, 0, 'A later browser start without a saved model must not reopen the setup tab');
  console.log('PASS: first install opens one active setup tab; toolbar routing reuses it; a later browser start without a saved model stays quiet.');
} finally { await context?.close(); await removeTestProfile(profile); }
