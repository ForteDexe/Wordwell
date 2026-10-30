import assert from 'node:assert/strict';
import { testSelectionDragging } from './test-selection-drag.mjs';

export async function testPageTranslation({ page, site, context, report }) {
  const surface = site || page;
  await page.bringToFront();
  await page.locator('#auto-check').uncheck();
  await page.locator('#translation-enabled').uncheck();
  await page.evaluate(() => chrome.storage.local.set({ instantTranslation: true }));
  assert.equal(await page.locator('#page-translation-enabled').isChecked(), false);
  assert.equal(await page.locator('#page-translation-language').isDisabled(), true);
  const initial = await page.evaluate(() => window.localEnglish.snapshot());
  await surface.evaluate(() => {
    const fixture = document.createElement('article'); fixture.id = 'page-translation-fixture'; fixture.style.margin = '40px';
    const before = document.createElement('p'); before.textContent = 'Unselected text above.';
    const paragraph = document.createElement('p'); paragraph.id = 'page-translation-text';
    const text = document.createElement('strong'); text.textContent = 'Hello.';
    const hidden = document.createElement('span'); hidden.textContent = ' Hidden helper text must not be translated.'; hidden.style.display = 'none';
    paragraph.append(text, hidden);
    const after = document.createElement('p'); after.textContent = 'Unselected text below.';
    const readonly = document.createElement('textarea'); readonly.id = 'page-translation-readonly'; readonly.readOnly = true; readonly.value = 'Hello.';
    const password = document.createElement('input'); password.id = 'page-translation-password'; password.type = 'password'; password.value = 'private fixture';
    fixture.append(before, paragraph, after, readonly, password); document.body.prepend(fixture);
  });
  const paragraph = surface.locator('#page-translation-text');
  const icon = surface.getByRole('button', { name: 'Translate selected text', exact: true });
  const bulb = surface.getByRole('button', { name: 'Refine selected text', exact: true });
  const host = surface.locator('local-english-selection');
  async function select() {
    await surface.bringToFront(); await paragraph.click();
    return paragraph.evaluate(node => {
      const range = document.createRange(); range.selectNodeContents(node);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      const rect = range.getClientRects()[0]; return { left: rect.left, top: rect.top, bottom: rect.bottom };
    });
  }
  async function result() {
    await surface.waitForFunction(() => ['result', 'error'].includes(document.querySelector('local-english-selection')?.dataset.state), undefined, { timeout: 120000 });
    assert.equal(await host.getAttribute('data-state'), 'result', await host.locator('.body').innerText());
    return host.locator('.correction').innerText();
  }
  try {
    await select();
    assert.equal(await icon.isVisible(), false);
    const disabled = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'inline-translate', text: 'Hello.', language: 'vi', pageSelection: true }));
    assert.equal(disabled.code, 'translation-disabled');
    await page.locator('#page-translation-enabled').check();
    await page.waitForFunction(() => !document.getElementById('page-translation-language').disabled);
    await page.locator('#page-translation-language').selectOption('vi');
    await page.waitForFunction(async () => (await chrome.storage.local.get('pageTranslationLanguage')).pageTranslationLanguage === 'vi');
    await testSelectionDragging({ surface, report });
    const rect = await select(); await icon.waitFor({ state: 'visible' });
    assert.equal(await bulb.isVisible(), false);
    const box = await icon.boundingBox();
    assert.ok(Math.abs(box.x + box.width + 6 - rect.left) < 2 || Math.abs(box.y + box.height + 6 - rect.top) < 2);
    assert.match(await icon.getAttribute('title'), /page text.*Vietnamese/);
    assert.equal(await page.evaluate(() => window.localEnglish.model.checkCount), initial.checkCount);
    await surface.screenshot({ path: 'artifacts/page-translation-icon.png', fullPage: true });
    await icon.focus(); await icon.press('Enter');
    const translated = await result();
    assert.match(translated, /^(?:xin )?chào(?: bạn)?[.!]?$/i);
    assert.equal(await host.locator('.page-original').innerText(), 'Hello.');
    assert.equal(await host.getByRole('button', { name: 'Replace', exact: true }).count(), 0);
    assert.equal(await paragraph.locator('strong').innerText(), 'Hello.');
    assert.equal(await page.evaluate(() => window.localEnglish.model.info.instanceId), initial.info.instanceId);
    await surface.screenshot({ path: 'artifacts/page-translation-card.png', fullPage: true });
    await host.locator('.correction').evaluate(node => {
      const selection = node.getRootNode().getSelection?.() || window.getSelection();
      const range = document.createRange(); range.selectNodeContents(node);
      selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await surface.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await host.locator('.panel').isVisible(), true, 'Selecting the translated text must leave its card open');
    report.checks.push('Page translation has independent opt-in and target language, with its icon anchored beside ordinary selected text');
    report.checks.push('Page selections keep their preview and Copy with text-box instant mode enabled, without changing the page');

    if (site) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(site.url()).origin });
    const copy = host.getByRole('button', { name: 'Copy translation', exact: true });
    await copy.click();
    await surface.waitForFunction(() => document.querySelector('local-english-selection')?.shadowRoot.querySelector('.actions button')?.textContent === 'Copied');
    if (site) assert.equal(await surface.evaluate(async expected => await navigator.clipboard.readText() === expected, translated), true, 'Clipboard must contain the translation');
    await paragraph.locator('strong').evaluate(node => { node.textContent = 'Updated source text.'; });
    await host.locator('.panel').waitFor({ state: 'hidden' });
    report.checks.push('Copy writes the translated text, and changing the selected source invalidates its review card');

    const readonly = surface.locator('#page-translation-readonly');
    await readonly.evaluate(node => { node.focus(); node.select(); node.dispatchEvent(new Event('select', { bubbles: true })); });
    await icon.waitFor({ state: 'visible' }); await icon.click();
    assert.match(await result(), /^(?:xin )?chào(?: bạn)?[.!]?$/i);
    assert.equal(await readonly.inputValue(), 'Hello.');
    await host.getByRole('button', { name: 'Close suggestion', exact: true }).click();
    await surface.locator('#page-translation-password').evaluate(node => { node.focus(); node.select(); node.dispatchEvent(new Event('select', { bubbles: true })); });
    await icon.waitFor({ state: 'hidden' });
    report.checks.push('Page translation supports read-only text controls while password fields remain excluded');

    await paragraph.evaluate(node => { node.textContent = 'Hello.'; });
    await page.evaluate(() => {
      const runtime = window.localEnglish.model.runtime, generate = runtime.createChatCompletion;
      let release; const gate = new Promise(resolve => { release = resolve; });
      runtime.createChatCompletion = async function(options) { await gate; return generate.call(this, options); };
      window.pageTranslationGate = { release, restore: () => { runtime.createChatCompletion = generate; } };
    });
    try {
      await select(); await icon.waitFor({ state: 'visible' }); await icon.click();
      await page.waitForFunction(() => window.localEnglish.model.busy);
      await paragraph.evaluate(node => { node.textContent = 'Changed while translating.'; });
      await host.locator('.panel').waitFor({ state: 'hidden' });
      await page.evaluate(() => window.pageTranslationGate.release());
      await page.waitForFunction(() => !window.localEnglish.model.busy, undefined, { timeout: 120000 });
      assert.equal(await paragraph.innerText(), 'Changed while translating.');
      assert.equal(await host.locator('.panel').isVisible(), false);
    } finally { await page.evaluate(() => { window.pageTranslationGate.release(); window.pageTranslationGate.restore(); delete window.pageTranslationGate; }); }
    report.checks.push('An in-flight page translation cannot display a stale result after the selected text changes');

    await page.bringToFront(); await page.reload();
    await page.waitForFunction(() => window.localEnglish?.initialized && window.localEnglish.model.ready, undefined, { timeout: 180000 });
    assert.equal(await page.locator('#page-translation-enabled').isChecked(), true);
    assert.equal(await page.locator('#page-translation-language').inputValue(), 'vi');
    assert.equal(await page.locator('#translation-enabled').isChecked(), false);
    await page.locator('#page-translation-enabled').uncheck();
    await page.waitForFunction(async () => (await chrome.storage.local.get('pageTranslationEnabled')).pageTranslationEnabled === false);
    report.checks.push('Page translation preferences survive autoload separately from text-box translation preferences');
  } finally {
    await page.evaluate(() => chrome.storage.local.set({ instantTranslation: false }));
    await surface.evaluate(() => { document.getElementById('page-translation-fixture')?.remove(); window.getSelection()?.removeAllRanges(); });
  }
}
