import assert from 'node:assert/strict';

export async function testOverlayVisibility({ page, site, worker, report }) {
  await site.bringToFront();
  await site.evaluate(() => {
    for (const tag of ['comment-composer-host', 'faceplate-form', 'shreddit-composer', 'shreddit-markdown-composer']) {
      if (!customElements.get(tag)) customElements.define(tag, class extends HTMLElement {});
    }
    const outer = document.createElement('comment-composer-host'); outer.id = 'visibility-fixture';
    const outerRoot = outer.attachShadow({ mode: 'open' }); outerRoot.append(document.createElement('slot'));
    const form = document.createElement('faceplate-form'); outer.append(form);
    const formRoot = form.attachShadow({ mode: 'open' }); formRoot.append(document.createElement('slot'));
    const composer = document.createElement('shreddit-composer'); form.append(composer);
    const composerRoot = composer.attachShadow({ mode: 'open' });
    const markdown = document.createElement('shreddit-markdown-composer'); composerRoot.append(markdown);
    const markdownRoot = markdown.attachShadow({ mode: 'open' });
    const box = document.createElement('div'); box.className = 'textarea-container';
    const editor = document.createElement('textarea'); editor.spellcheck = false; box.append(editor); markdownRoot.append(box);
    const styles = new CSSStyleSheet();
    styles.replaceSync(':host { display:block; margin-top:30px; } .textarea-container { display:grid; overflow:hidden; width:730px; max-width:90vw; background:#101a1b; padding:16px; border-radius:12px; } textarea { display:block; width:100%; height:64px; box-sizing:border-box; border:0; padding:0; resize:none; overflow:hidden; background:transparent; color:white; font:14px/22px monospace; }');
    markdownRoot.adoptedStyleSheets = [styles];
    document.body.append(outer);
    const pageRules = new CSSStyleSheet();
    pageRules.replaceSync(':not(:defined) { visibility:hidden !important; } [popover] { opacity:0 !important; max-width:1px !important; max-height:1px !important; overflow:hidden !important; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageRules];
    window.visibilityFixture = { outer, editor, pageRules };
  });
  await page.locator('#auto-check').check();
  await page.waitForFunction(async () => (await chrome.storage.local.get('autoCheck')).autoCheck === true);
  await site.bringToFront();
  await site.evaluate(() => { const { editor } = window.visibilityFixture; editor.scrollIntoView({ block: 'center' }); editor.focus(); });
  await site.keyboard.insertText('Yesterday I go to the shop and buy some milk.');
  await site.waitForFunction(() => document.querySelector('local-english-selection')?.shadowRoot.querySelector('.auto-status')?.dataset.state === 'suggestions', undefined, { timeout: 120000 });
  await site.keyboard.press('Control+a');
  const host = site.locator('local-english-selection');
  const trigger = host.getByRole('button', { name: 'Check selected text with Local English', exact: true });
  await trigger.waitFor({ state: 'visible' });
  const visibility = await host.evaluate(host => {
    const style = getComputedStyle(host), rect = host.getBoundingClientRect();
    const controls = [...host.shadowRoot.querySelectorAll('.auto-underline'), host.shadowRoot.querySelector('.trigger'), host.shadowRoot.querySelector('.auto-status')];
    return { visibility: style.visibility, opacity: style.opacity, width: rect.width, height: rect.height,
      hits: controls.map(node => { const rect = node.getBoundingClientRect(); return !node.hidden && rect.width > 0 && rect.height > 0 && document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === host; }) };
  });
  assert.equal(visibility.visibility, 'visible'); assert.equal(visibility.opacity, '1');
  assert.ok(visibility.width > 700 && visibility.height > 500);
  assert.ok(visibility.hits.length >= 4 && visibility.hits.every(Boolean), 'Underlines, selection icon, and status must be painted and hit-testable, not merely present in the DOM');
  report.checks.push('Overlay controls remain visible and clickable under page CSS hiding undefined elements and resetting popovers');
  await site.screenshot({ path: 'artifacts/overlay-css-isolation.png', fullPage: true });

  const reports = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return globalThis.localEnglishDiagnostics.captureEditorDiagnostics(tab.id);
  });
  const captured = reports.at(-1);
  assert.equal(captured.ui.hostStyle.visibility, 'visible'); assert.equal(captured.ui.hostStyle.opacity, '1');
  assert.equal(captured.ui.trigger.hitBelongsToUI, true);
  assert.ok(captured.ui.underlineSamples.length > 0 && captured.ui.underlineSamples.every(mark => mark.hitBelongsToUI));
  assert.equal(JSON.stringify(captured).includes('Yesterday I go to the shop and buy some milk.'), false);
  report.checks.push('Diagnostics include actual overlay styles, geometry, and hit testing without comment text');

  await site.bringToFront(); await trigger.click();
  await site.waitForFunction(() => document.querySelector('local-english-selection').dataset.state === 'result', undefined, { timeout: 120000 });
  const corrected = await host.locator('.correction').innerText();
  assert.equal(corrected, 'Yesterday I went to the shop and bought some milk.');
  await host.getByRole('button', { name: 'Replace', exact: true }).click();
  assert.equal(await site.evaluate(() => window.visibilityFixture.editor.value), corrected);
  report.checks.push('Selection checking and native Replace work through the protected overlay');
  await page.locator('#auto-check').uncheck();
  await page.waitForFunction(async () => (await chrome.storage.local.get('autoCheck')).autoCheck === false);
  await page.click('#clear-editor-diagnostics');
  await page.waitForFunction(() => document.getElementById('copy-editor-diagnostics').disabled);
  await site.evaluate(() => {
    const { outer, pageRules } = window.visibilityFixture;
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== pageRules);
    outer.remove(); delete window.visibilityFixture;
  });
}
