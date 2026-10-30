import { chromium } from 'playwright';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { testAutomaticChecking } from './test-auto-check.mjs';
import { testShadowEditors } from './test-shadow-editors.mjs';
import { testCommentLayouts } from './test-comment-layouts.mjs';
import { testEditorDiagnostics } from './test-editor-diagnostics.mjs';
import { testOverlayVisibility } from './test-overlay-visibility.mjs';
import { testYouTubeGeometry } from './test-youtube-geometry.mjs';
import { removeTestProfile } from './browser-profile.mjs';

const extensionPath = path.resolve('dist/extension');
const modelPath = process.env.MODEL_FILE_PATH || 'D:/LLM_Models/Qwen3.5-0.8B/Qwen3.5-0.8B-UD-Q6_K_XL.gguf';
await mkdir('artifacts', { recursive: true });
await mkdir('.browser-check', { recursive: true });
const profile = await mkdtemp(path.resolve('.browser-check/extension-'));
const report = { modelPath, checks: [], pageErrors: [], consoleErrors: [], chromeWarnings: [], externalRequests: [] };
const fixtureHTML = await readFile('test-fixtures/inline.html');
const fixture = createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204).end(); return; }
  response.setHeader('Content-Type', 'text/html');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; style-src 'none'; img-src 'none'");
  response.end(fixtureHTML);
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`;
let context, page;
async function launchProfile() {
  const browserContext = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: !process.env.HEADED,
    viewport: { width: 1280, height: 1000 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`,
      ...(process.env.PERF_GPU_PREFERENCE === 'high' ? ['--force-high-performance-gpu', '--use-webgpu-power-preference=force-high-performance'] : [])],
  });
  await browserContext.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== fixtureOrigin) {
      report.externalRequests.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  return browserContext;
}
try {
  context = await launchProfile();
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 30000 });
  const extensionId = new URL(worker.url()).host;
  report.extensionId = extensionId;
  page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') { report.consoleErrors.push(message.text().slice(0, 1500)); console.error(message.text().slice(0, 1500)); }
    if (message.type() === 'warning') report.chromeWarnings.push(message.text());
  });
  await page.goto(`chrome-extension://${extensionId}/workspace.html`);
  await page.waitForFunction(() => window.localEnglish?.initialized);
  await page.locator('#auto-check').uncheck();
  await page.waitForFunction(async () => (await chrome.storage.local.get('autoCheck')).autoCheck === false);
  assert.equal(await page.evaluate(() => crossOriginIsolated), true);
  report.checks.push('Extension page is cross-origin isolated');

  // Invalid input should be rejected without breaking the next model load.
  await page.setInputFiles('#model-file', { name: 'invalid.gguf', mimeType: 'application/octet-stream', buffer: Buffer.from('not a GGUF') });
  await page.click('#load');
  await page.waitForFunction(() => !document.getElementById('error').hidden);
  assert.match(await page.locator('#error').innerText(), /GGUF header/);
  await page.waitForFunction(async () => await chrome.action.getBadgeText({}) === '!');
  assert.match(await page.evaluate(() => chrome.action.getTitle({})), /GGUF header/);
  report.checks.push('Invalid GGUF rejected');
  report.checks.push('Load failure sets a red error badge and useful tooltip');

  const site = await context.newPage();
  site.on('pageerror', error => report.pageErrors.push(error.message));
  site.on('console', message => { if (message.type() === 'error') { report.consoleErrors.push(message.text()); console.error(message.text()); } });
  await site.goto(fixtureOrigin);
  const inlineHost = site.locator('local-english-selection');
  const inlineTrigger = site.getByRole('button', { name: 'Check selected text with Local English', exact: true });
  async function selectField(selector, text) {
    await site.bringToFront();
    if (text !== undefined) await site.locator(selector).fill(text);
    await site.locator(selector).evaluate(field => {
      field.focus(); field.setSelectionRange(0, field.value.length);
      field.dispatchEvent(new Event('select', { bubbles: true }));
    });
  }
  async function inlineState(state) {
    await site.waitForFunction(state => document.querySelector('local-english-selection')?.dataset.state === state, state, { timeout: 120000 });
  }
  await selectField('#paragraph');
  await inlineTrigger.waitFor({ state: 'visible' });
  await inlineTrigger.click();
  await inlineState('error');
  assert.match(await inlineHost.locator('.body .message').innerText(), /Load your model/);
  assert.equal(await page.evaluate(() => window.localEnglish.model.checkCount), 0);
  report.checks.push('Inline setup message appears when no model is loaded');
  await site.getByRole('button', { name: 'Close suggestion', exact: true }).click();

  console.log(`Loading model through extension file picker: ${modelPath}`);
  await page.bringToFront();
  await page.setInputFiles('#model-file', modelPath);
  await page.click('#load');
  await page.waitForFunction(() => window.localEnglish.model.ready || !document.getElementById('error').hidden || window.localEnglish.model.logs.some(entry => entry.level === 'error'), undefined, { timeout: 180000 });
  assert.equal(await page.evaluate(() => window.localEnglish.model.ready), true, `Extension model load failed: ${await page.locator('#error').textContent()}`);
  const loaded = await page.evaluate(() => window.localEnglish.snapshot());
  assert.equal(loaded.info.context, 1024);
  report.engine = loaded.info;
  report.checks.push('Model loaded from selected local File with 1024 context');
  console.log(JSON.stringify(loaded.info));

  async function correct(input) {
    await page.locator('#original').fill(input);
    await page.click('#correct');
    await page.waitForFunction(() => !window.localEnglish.model.busy, undefined, { timeout: 120000 });
    assert.equal(await page.locator('#error').isVisible(), false);
    const snapshot = await page.evaluate(() => window.localEnglish.snapshot());
    assert.ok(snapshot.result?.corrected);
    assert.equal(snapshot.info.instanceId, loaded.info.instanceId);
    assert.equal(snapshot.loadCount, 1);
    assert.equal(await page.locator('#original').inputValue(), input, 'Correction must leave the original intact');
    console.log(JSON.stringify(snapshot.result));
    return snapshot.result;
  }
  report.first = await correct('Yesterday I go to the shop and buy some milk.');
  assert.equal(report.first.corrected, 'Yesterday I went to the shop and bought some milk.');
  report.checks.push('Whole-sentence correction; original preserved');

  // The extension's own page must support the same inline flow as websites.
  await page.locator('#original').evaluate(field => {
    field.focus(); field.setSelectionRange(0, field.value.length);
    field.dispatchEvent(new Event('select', { bubbles: true }));
  });
  const workspaceTrigger = page.getByRole('button', { name: 'Check selected text with Local English', exact: true });
  await workspaceTrigger.waitFor({ state: 'visible' });
  await workspaceTrigger.click();
  await page.waitForFunction(() => document.querySelector('local-english-selection')?.dataset.state === 'result', undefined, { timeout: 120000 });
  assert.equal(await page.locator('local-english-selection .correction').innerText(), 'Yesterday I went to the shop and bought some milk.');
  assert.equal(await page.locator('#original').isEnabled(), true);
  assert.equal(await page.locator('#original').inputValue(), report.first.original);
  assert.equal(await page.evaluate(() => window.localEnglish.model.loadCount), 1);
  await page.screenshot({ path: 'artifacts/workspace-inline-suggestion.png', fullPage: true });
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  assert.equal(await page.locator('#original').inputValue(), report.first.corrected);
  assert.equal(await page.locator('#corrected').inputValue(), '', 'Replacing the original must invalidate the old workspace result');
  report.checks.push('Workspace inline Replace updates Original and triggers its input handler without reloading the model');

  // Exercise the shared handler registered for the selection context menu.
  // It must deliver text to the existing workspace, not create another model/tab.
  const queuedTabId = await page.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'selected-text', text: 'I look forward to hear from you.' });
    if (response.error) throw new Error(response.error);
    return response.tabId;
  });
  await page.waitForFunction(() => document.getElementById('original').value === 'I look forward to hear from you.');
  const tabIds = await worker.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [chrome.runtime.getURL('workspace.html')] })).map(item => item.tabId));
  assert.deepEqual(tabIds, [queuedTabId]);
  report.checks.push('Selection handler delivers text to one existing workspace');
  report.second = await correct('I look forward to hear from you.');
  assert.equal(report.second.corrected, 'I look forward to hearing from you.');
  report.checks.push('Second correction reuses the loaded engine');

  report.control = await correct('I received your message yesterday.');
  assert.equal(report.control.corrected, report.control.original);
  assert.match(await page.locator('#status').innerText(), /No changes suggested/);
  report.checks.push('Correct sentence unchanged; no claim of perfect grammar');
  await page.click('#copy');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('copied') || !document.getElementById('error').hidden);
  assert.match(await page.locator('#status').innerText(), /copied/);
  report.checks.push('Copy correction succeeds');

  // Too-long text is rejected before inference and does not expose stale output.
  await page.locator('#original').evaluate(element => { element.value = 'word '.repeat(400); element.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#correct');
  await page.waitForFunction(() => !document.getElementById('error').hidden);
  assert.match(await page.locator('#error').innerText(), /shorter/);
  assert.equal(await page.locator('#corrected').inputValue(), '');
  report.checks.push('Long passage rejected; stale suggestion cleared');

  await page.locator('#original').fill('Yesterday I go to the shop and buy some milk.');
  await page.click('#correct');
  await page.waitForFunction(() => !window.localEnglish.model.busy, undefined, { timeout: 120000 });
  await page.screenshot({ path: 'artifacts/extension-workspace.png', fullPage: true });
  report.beforeUnload = await page.evaluate(() => window.localEnglish.snapshot());

  const baselineChecks = report.beforeUnload.checkCount;
  const workspaceDraft = await page.locator('#original').inputValue();
  await selectField('#paragraph', 'Yesterday I go to the shop and buy some milk.');
  await inlineTrigger.waitFor({ state: 'visible' });
  await site.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.localEnglish.model.checkCount), baselineChecks);
  const box = await site.locator('#paragraph').boundingBox();
  const icon = await inlineTrigger.boundingBox();
  assert.ok(Math.abs(icon.x - box.x) < 70 && icon.y <= box.y + 30, 'Icon must anchor at the selection start');
  report.checks.push('Selecting text shows an anchored icon without inference');
  await inlineTrigger.click();
  await inlineState('result');
  report.inlineResult = await inlineHost.locator('.correction').innerText();
  assert.equal(report.inlineResult, 'Yesterday I went to the shop and bought some milk.');
  assert.equal(await site.locator('#paragraph').inputValue(), 'Yesterday I go to the shop and buy some milk.');
  assert.equal(await page.locator('#original').inputValue(), workspaceDraft);
  assert.equal(await page.evaluate(() => window.localEnglish.model.info.instanceId), loaded.info.instanceId);
  report.checks.push('Inline popup uses the existing model and preserves both drafts');
  assert.deepEqual(await inlineHost.locator('.diff-added').allTextContents(), ['went', 'bought']);
  assert.deepEqual(await inlineHost.locator('.removed del').allTextContents(), ['go', 'buy']);
  assert.equal(await inlineHost.locator('.original').isVisible(), false);
  assert.equal(await inlineHost.locator('.removed').isVisible(), false);
  await inlineHost.locator('summary').click();
  assert.equal(await inlineHost.locator('.original').isVisible(), true);
  assert.equal(await inlineHost.locator('.removed').isVisible(), true);
  await inlineHost.locator('summary').click();
  await inlineHost.locator('.original').waitFor({ state: 'hidden' });
  report.checks.push('The clean suggestion card highlights edits and reveals original/removed text through Show changes');
  await site.screenshot({ path: 'artifacts/inline-suggestion.png', fullPage: true });
  await inlineHost.locator('.panel').screenshot({ path: 'artifacts/selection-card.png' });
  await site.locator('#paragraph').evaluate(field => {
    window.replacementInputs = [];
    field.addEventListener('input', event => window.replacementInputs.push({ value: field.value, data: event.data, trusted: event.isTrusted }));
  });
  await site.getByRole('button', { name: 'Replace', exact: true }).click();
  assert.equal(await site.locator('#paragraph').inputValue(), report.inlineResult);
  const editEvents = await site.evaluate(() => window.replacementInputs);
  assert.equal(editEvents.length, 1);
  assert.equal(editEvents[0].value, report.inlineResult);
  assert.equal(editEvents[0].trusted, true, 'Replacement should be a native editor input');
  await inlineHost.locator('.panel').waitFor({ state: 'hidden' });
  await site.keyboard.press('Control+z');
  assert.equal(await site.locator('#paragraph').inputValue(), 'Yesterday I go to the shop and buy some milk.');
  report.checks.push('Inline Replace emits native input, dismisses the card, and supports Ctrl+Z');

  await selectField('#sentence');
  await inlineTrigger.waitFor({ state: 'visible' });
  await inlineTrigger.click(); await inlineState('result');
  assert.equal(await inlineHost.locator('.correction').innerText(), 'He goes to work every day.');
  await site.getByRole('button', { name: 'Replace', exact: true }).click();
  assert.equal(await site.locator('#sentence').inputValue(), 'He goes to work every day.');
  report.checks.push('Single-line text input selection and Replace work');

  await site.locator('#rich').evaluate(field => {
    field.focus(); const range = document.createRange(); range.selectNodeContents(field);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  await inlineTrigger.waitFor({ state: 'visible' });
  await inlineTrigger.click(); await inlineState('result');
  assert.equal(await inlineHost.locator('.correction').innerText(), 'I really like this extension.');
  await site.getByRole('button', { name: 'Replace', exact: true }).click();
  assert.equal(await site.locator('#rich').innerText(), 'I really like this extension.');
  await site.keyboard.press('Control+z');
  assert.equal(await site.locator('#rich').innerText(), 'I very like this extension.');
  report.checks.push('Basic contenteditable Replace and Ctrl+Z work');

  // Select only a middle sentence. Surrounding text and rich formatting must
  // survive; the model receives just the selected sentence.
  const selectedSentence = 'Yesterday I go to the shop and buy some milk.';
  const correctedSentence = 'Yesterday I went to the shop and bought some milk.';
  await selectField('#paragraph', `Keep before. ${selectedSentence} Keep after.`);
  await site.locator('#paragraph').evaluate((field, text) => {
    const start = field.value.indexOf(text);
    field.setSelectionRange(start, start + text.length);
    field.dispatchEvent(new Event('select', { bubbles: true }));
  }, selectedSentence);
  await inlineTrigger.waitFor({ state: 'visible' });
  await inlineTrigger.click(); await inlineState('result');
  await site.getByRole('button', { name: 'Replace', exact: true }).click();
  assert.equal(await site.locator('#paragraph').inputValue(), `Keep before. ${correctedSentence} Keep after.`);
  report.checks.push('Textarea Replace changes only the selected sentence');

  await site.locator('#rich').evaluate((field, text) => {
    const before = document.createElement('b'); before.textContent = 'Keep before.';
    const middle = document.createTextNode(` ${text} `);
    const after = document.createElement('i'); after.textContent = 'Keep after.';
    field.replaceChildren(before, middle, after); field.focus();
    const range = document.createRange(); range.setStart(middle, 1); range.setEnd(middle, 1 + text.length);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }, selectedSentence);
  await inlineTrigger.waitFor({ state: 'visible' });
  await inlineTrigger.click(); await inlineState('result');
  await site.getByRole('button', { name: 'Replace', exact: true }).click();
  // Chrome's native rich-text edit may turn boundary spaces into NBSPs to
  // preserve their appearance around the formatted sibling nodes.
  assert.equal((await site.locator('#rich').innerText()).replaceAll('\u00a0', ' '), `Keep before. ${correctedSentence} Keep after.`);
  assert.equal(await site.locator('#rich b').innerText(), 'Keep before.');
  assert.equal(await site.locator('#rich i').innerText(), 'Keep after.');
  report.checks.push('Rich-text Replace preserves surrounding words and formatting');

  await selectField('#paragraph', 'I received your message yesterday.');
  await inlineTrigger.waitFor({ state: 'visible' });
  await inlineTrigger.click(); await inlineState('result');
  assert.equal(await site.getByRole('button', { name: 'Replace', exact: true }).isDisabled(), true);
  assert.equal(await inlineHost.locator('.diff-added').count(), 0);
  assert.equal(await inlineHost.locator('.removed').count(), 0);
  report.checks.push('Unchanged suggestion has no highlights and disables Replace');

  await selectField('#paragraph', 'I like the the book.');
  await inlineTrigger.waitFor({ state: 'visible' });
  await inlineTrigger.click(); await inlineState('result');
  assert.equal(await inlineHost.locator('.correction').innerText(), 'I like the book.');
  await inlineHost.locator('summary').click();
  assert.match(await inlineHost.locator('.removed').innerText(), /the/);
  await inlineHost.locator('summary').click();
  await site.getByRole('button', { name: 'Replace', exact: true }).click();
  assert.equal(await site.locator('#paragraph').inputValue(), 'I like the book.');
  report.checks.push('Deletion-only correction shows removed text and replaces with the exact suggestion');

  // Programmatic edits need the same protection even if no input event fired.
  await selectField('#paragraph', selectedSentence);
  await inlineTrigger.waitFor({ state: 'visible' });
  await inlineTrigger.click(); await inlineState('result');
  await site.evaluate(() => {
    document.getElementById('paragraph').value = 'Newer text must survive.';
    document.querySelector('local-english-selection').shadowRoot.querySelector('.actions button').click();
  });
  assert.equal(await site.locator('#paragraph').inputValue(), 'Newer text must survive.');
  await inlineHost.locator('.panel').waitFor({ state: 'hidden' });
  report.checks.push('Replace refuses stale text even without an input event');

  await selectField('#paragraph', 'He go to work every day.');
  await inlineTrigger.waitFor({ state: 'visible' });
  await inlineTrigger.click(); await inlineState('result');
  await site.locator('#paragraph').evaluate(field => {
    field.addEventListener('beforeinput', event => event.preventDefault(), { once: true });
  });
  await site.getByRole('button', { name: 'Replace', exact: true }).click();
  assert.equal(await site.locator('#paragraph').inputValue(), 'He go to work every day.');
  assert.match(await inlineHost.getByRole('alert').innerText(), /blocked replacement/);
  report.checks.push('Replace respects an editor that cancels beforeinput');

  for (const selector of ['#private', '#readonly']) {
    await selectField(selector);
    await inlineTrigger.waitFor({ state: 'hidden' });
    await inlineHost.locator('.panel').waitFor({ state: 'hidden' });
  }
  report.checks.push('Password and read-only fields do not show the icon');

  // A changed source must invalidate an in-flight popup result.
  await selectField('#paragraph', 'I look forward to hear from you.');
  await inlineTrigger.waitFor({ state: 'visible' });
  await inlineTrigger.click();
  await page.waitForFunction(() => window.localEnglish.model.busy, undefined, { polling: 100 });
  await site.locator('#paragraph').fill('This sentence was edited while the model was checking.');
  await page.waitForFunction(() => !window.localEnglish.model.busy, undefined, { polling: 100, timeout: 120000 });
  await inlineHost.locator('.panel').waitFor({ state: 'hidden' });
  assert.equal(await site.locator('#paragraph').inputValue(), 'This sentence was edited while the model was checking.');
  report.checks.push('Source edits dismiss the popup and discard stale results');

  // Reuse the field at a narrow viewport to check popup clamping.
  await site.setViewportSize({ width: 390, height: 650 });
  await selectField('#paragraph', 'He go to work every day.');
  await inlineTrigger.waitFor({ state: 'visible' });
  await inlineTrigger.click(); await inlineState('result');
  const card = await inlineHost.locator('.panel').boundingBox();
  assert.ok(card.x >= 0 && card.y >= 0 && card.x + card.width <= 390 && card.y + card.height <= 650, 'Popup must fit within the viewport');
  report.checks.push('Popup stays inside a narrow viewport');

  // Use a real mouse selection on wrapped, scrolled text to verify the mirror
  // anchor agrees with the native text layout, rather than just its first line.
  await site.setViewportSize({ width: 1280, height: 1000 });
  await site.locator('#paragraph').fill('This is a test of wrapped text. '.repeat(40));
  await site.locator('#paragraph').evaluate(field => { field.setSelectionRange(0, 0); field.scrollTop = 45; });
  const scrolledBox = await site.locator('#paragraph').boundingBox();
  const startPoint = { x: scrolledBox.x + 42, y: scrolledBox.y + 55 };
  await site.mouse.move(startPoint.x, startPoint.y);
  await site.mouse.down();
  await site.mouse.move(startPoint.x + 130, startPoint.y, { steps: 5 });
  await site.mouse.up();
  await inlineTrigger.waitFor({ state: 'visible' });
  const scrolledIcon = await inlineTrigger.boundingBox();
  assert.ok(Math.abs(scrolledIcon.x - startPoint.x) < 20 && Math.abs(scrolledIcon.y + 31 - startPoint.y) < 25, 'Icon must follow the native start of a wrapped, scrolled selection');
  report.checks.push('Icon anchors to a real mouse selection in wrapped, scrolled text');
  await testCommentLayouts({ page, site, report, loaded });
  await testShadowEditors({ page, site, report, loaded });
  await testAutomaticChecking({ context, page, site, report, loaded });
  await testEditorDiagnostics({ context, page, site, worker, report });
  await testOverlayVisibility({ page, site, worker, report });
  await testYouTubeGeometry({ page, site, worker, report });
  report.afterInline = await page.evaluate(() => window.localEnglish.snapshot());
  assert.equal(report.afterInline.loadCount, 1);
  assert.equal(report.afterInline.info.instanceId, loaded.info.instanceId);
  await page.bringToFront();
  await page.click('#unload');
  await page.waitForFunction(() => !window.localEnglish.model.busy);
  assert.equal(await page.evaluate(() => window.localEnglish.model.ready), false);
  assert.equal(await page.locator('#correct').isEnabled(), false);
  report.checks.push('Unload releases model and disables correction');

  const remembered = await page.evaluate(async () => (await import('./model-cache.js')).savedModelInfo());
  assert.equal(remembered.name, path.basename(modelPath));
  assert.equal(remembered.bytes, loaded.info.bytes);
  await page.reload();
  await page.waitForFunction(() => window.localEnglish?.initialized, undefined, { timeout: 180000, polling: 100 });
  assert.equal(await page.evaluate(() => window.localEnglish.model.ready), true);
  assert.equal(await page.locator('#model-file').evaluate(input => input.files.length), 0);
  await page.waitForFunction(async () => await chrome.action.getBadgeText({}) === '');
  report.reloaded = await page.evaluate(() => window.localEnglish.snapshot());
  assert.equal(report.reloaded.info.context, 1024);
  report.checks.push('Cached model autoloads after workspace reload without a file picker');

  // Close the entire browser, then reopen the same profile. onStartup must
  // create a background workspace and restore the persisted model by itself.
  await context.close();
  context = await launchProfile();
  const startupDeadline = Date.now() + 20000;
  page = null;
  while (!page && Date.now() < startupDeadline) {
    page = context.pages().find(candidate => candidate.url().endsWith('/workspace.html'));
    if (!page) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(page, 'Chrome startup should open the remembered-model workspace automatically');
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.waitForFunction(() => window.localEnglish?.initialized, undefined, { timeout: 180000, polling: 100 });
  assert.equal(await page.evaluate(() => window.localEnglish.model.ready), true);
  report.restarted = await page.evaluate(() => window.localEnglish.snapshot());
  assert.equal(report.restarted.info.context, 1024);
  assert.equal(report.restarted.info.file, path.basename(modelPath));
  assert.equal(report.restarted.loadCount, 1);
  const startupContexts = await page.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [chrome.runtime.getURL('workspace.html')] }));
  assert.equal(startupContexts.length, 1, 'Autoload must not create duplicate workspaces');
  report.checks.push('Saved model autoloads in one workspace after a full browser restart');
  await page.bringToFront();
  await page.locator('#original').fill('He go to work every day.');
  await page.click('#correct');
  await page.waitForFunction(() => !window.localEnglish.model.busy);
  assert.equal(await page.locator('#corrected').inputValue(), 'He goes to work every day.');
  report.checks.push('Autoloaded model performs a real correction after restart');
  await page.screenshot({ path: 'artifacts/remembered-model.png', fullPage: true });

  // Simulate missing cache bytes while keeping the metadata: startup failure
  // must be visible on the icon, and Forget model must offer recovery.
  await page.evaluate(async () => {
    const { CACHE_DB_NAME, CACHE_STORE } = await import('./model-cache.js');
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(CACHE_DB_NAME, 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE, 'readwrite');
      transaction.objectStore(CACHE_STORE).delete('file');
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });
  await page.reload();
  await page.waitForFunction(() => window.localEnglish?.initialized);
  await page.waitForFunction(async () => await chrome.action.getBadgeText({}) === '!');
  assert.match(await page.locator('#error').innerText(), /saved model is missing/);
  assert.match(await page.evaluate(() => chrome.action.getTitle({})), /saved model is missing/);
  report.checks.push('Autoload failure shows an error badge and explains the missing cache');
  await page.click('#forget');
  await page.waitForFunction(async () => await chrome.action.getBadgeText({}) === '');
  assert.equal(await page.evaluate(async () => (await import('./model-cache.js')).savedModelInfo()), undefined);
  report.checks.push('Forget model removes the cache, disables autoload, and clears the error badge');
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  assert.equal(report.chromeWarnings.some(message => message.includes('powerPreference') && message.includes('ignored')), false);
  report.checks.push('No ignored Windows powerPreference warning');
  report.passed = true;
  console.log(`PASS: ${report.checks.length} extension checks; zero external HTTP requests`);
} catch (error) {
  report.error = error.stack;
  try { report.partial = await page?.evaluate(() => window.localEnglish?.snapshot()); } catch {}
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile('artifacts/extension-test.json', JSON.stringify(report, null, 2));
  await context?.close();
  await new Promise(resolve => fixture.close(resolve));
  await removeTestProfile(profile);
}
