import assert from 'node:assert/strict';

export async function testEditorDiagnostics({ context, page, site, worker, report }) {
  await page.locator('#auto-check').check();
  await page.waitForFunction(async () => (await chrome.storage.local.get('autoCheck')).autoCheck === true);
  await site.bringToFront();
  await site.evaluate(() => {
    const container = document.createElement('section'); container.id = 'diagnostic-fixture'; document.body.append(container);
    const editor = document.createElement('div'); editor.id = 'normalized-comment'; editor.contentEditable = 'true'; editor.tabIndex = 0;
    editor.addEventListener('input', () => { editor.append(document.createTextNode('\u00a0')); });
    const silent = document.createElement('textarea'); silent.id = 'silent-comment'; silent.rows = 3; silent.cols = 70;
    const privateField = document.createElement('input'); privateField.type = 'password'; privateField.value = 'PRIVATE-PASSWORD-NEVER-COPY';
    container.append(editor, silent, privateField); editor.scrollIntoView({ block: 'center' }); editor.focus();
  });
  const state = expected => site.waitForFunction(expected => document.querySelector('local-english-selection')?.shadowRoot.querySelector('.auto-status')?.dataset.state === expected, expected, { timeout: 120000 });
  const baseline = await page.evaluate(() => window.localEnglish.model.checkCount);
  await site.keyboard.insertText('Yesterday I go to the shop and buy some milk.');
  await state('suggestions');
  assert.equal(await page.evaluate(() => window.localEnglish.model.checkCount), baseline + 1);
  assert.ok(await site.locator('local-english-selection .auto-underline').count() >= 2);
  report.checks.push('A site normalizing text after input does not cancel the automatic check');

  await site.locator('#silent-comment').focus();
  await site.locator('#silent-comment').evaluate(field => { field.value = 'He go to work every day.'; });
  await state('waiting'); await state('suggestions');
  assert.equal(await page.evaluate(() => window.localEnglish.model.checkCount), baseline + 2);
  report.checks.push('Focused textarea changes without an input event are detected and checked automatically');

  async function capture() {
    return worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return globalThis.localEnglishDiagnostics.captureEditorDiagnostics(tab.id);
    });
  }
  const reports = await capture();
  const captured = reports.at(-1), serialized = JSON.stringify(reports);
  assert.equal(captured.extensionVersion, '0.5.6');
  assert.equal(captured.focused.id, 'silent-comment');
  assert.equal(captured.commentTextIncluded, false);
  assert.ok(captured.automatic.mutationsDetected > 0);
  assert.ok(captured.automatic.renderedUnderlines > 0);
  assert.equal(serialized.includes('He go to work every day.'), false);
  assert.equal(serialized.includes('Yesterday I go to the shop and buy some milk.'), false);
  assert.equal(serialized.includes('PRIVATE-PASSWORD-NEVER-COPY'), false);
  await page.waitForFunction(() => !document.getElementById('copy-editor-diagnostics').disabled);
  await page.click('#copy-editor-diagnostics');
  await page.waitForFunction(() => document.getElementById('editor-diagnostic-status').textContent.includes('copied') || !document.getElementById('error').hidden);
  assert.equal(await page.locator('#error').isVisible(), false);
  assert.match(await page.locator('#editor-diagnostic-status').innerText(), /copied/i);
  report.checks.push('Editor diagnostics reach the workspace and can be copied without comment or password text');

  const blank = await context.newPage(); await blank.goto('about:blank'); await blank.bringToFront();
  const disconnected = (await capture()).at(-1);
  assert.equal(disconnected.contentScriptConnected, false);
  report.checks.push('Diagnostics explain when the content script is missing instead of reporting an editor fix');
  await blank.close();

  const peer = await context.newPage();
  await peer.addInitScript(() => {
    window.addEventListener('focusin', event => event.stopImmediatePropagation(), { capture: true });
    document.addEventListener('input', event => event.stopImmediatePropagation(), { capture: true });
  });
  await peer.goto(site.url()); await peer.bringToFront();
  await peer.waitForSelector('local-english-selection', { state: 'attached' });
  await peer.locator('#paragraph').fill('I look forward to hear from you.\u00a0');
  await peer.waitForFunction(() => document.querySelector('local-english-selection')?.shadowRoot.querySelector('.auto-status')?.dataset.state === 'suggestions', undefined, { timeout: 120000 });
  assert.ok(await peer.locator('local-english-selection .auto-underline').count() > 0);
  report.checks.push('Automatic checking still sees input when a site stops document-level propagation');
  await peer.close();
  await page.bringToFront(); await page.locator('#auto-check').uncheck();
  await page.waitForFunction(async () => (await chrome.storage.local.get('autoCheck')).autoCheck === false);
  await page.click('#clear-editor-diagnostics');
  await page.waitForFunction(() => document.getElementById('copy-editor-diagnostics').disabled);
  await site.evaluate(() => document.getElementById('diagnostic-fixture').remove());
}
