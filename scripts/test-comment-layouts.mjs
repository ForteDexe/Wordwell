import assert from 'node:assert/strict';

export async function testCommentLayouts({ page, site, report, loaded }) {
  await site.bringToFront();
  await site.evaluate(() => {
    const container = document.createElement('section'); container.id = 'comment-layout-fixture'; document.body.append(container);
    const state = window.commentLayouts = { container, editors: {}, dialogs: {}, drafts: {}, ui: document.querySelector('local-english-selection') };
    // Host-page selectors must not affect the extension's measuring spans.
    const sheet = new CSSStyleSheet(); sheet.replaceSync('span { display:block !important; letter-spacing:18px !important; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; state.sheet = sheet;
    for (const mode of ['normal', 'modal', 'closed-modal']) {
      let parent = container;
      if (mode === 'closed-modal') {
        const wrapper = document.createElement('reddit-dialog-root'); container.append(wrapper); parent = wrapper.attachShadow({ mode: 'closed' });
      }
      if (mode !== 'normal') {
        const dialog = document.createElement('dialog'); parent.append(dialog); state.dialogs[mode] = dialog; parent = dialog;
      }
      const composer = document.createElement('shreddit-composer'); parent.append(composer);
      const outer = composer.attachShadow({ mode: 'open' });
      const markdown = document.createElement('shreddit-markdown-composer'); outer.append(markdown);
      const inner = markdown.attachShadow({ mode: 'closed' });
      const styles = new CSSStyleSheet(); styles.replaceSync(':host { display:block; margin:20px 0; } textarea { display:block; box-sizing:border-box; width:600px; max-width:75vw; height:120px; padding:12px; border:1px solid #87948e; font:13px/22px monospace; background:#101a1b; color:#e1e8e4; }'); inner.adoptedStyleSheets = [styles];
      const editor = document.createElement('textarea'); editor.spellcheck = false;
      editor.value = mode === 'normal' ? 'Keep. Yesterday I go to the shop and buy some milk. End.' : 'Yesterday I go to the shop and buy some milk.';
      inner.append(editor); state.editors[mode] = editor;
      editor.addEventListener('input', () => { state.drafts[mode] = editor.value; });
    }
  });
  const ui = selector => site.evaluateHandle(selector => window.commentLayouts.ui.shadowRoot.querySelector(selector), selector);
  async function click(selector) { const handle = await ui(selector); await handle.asElement().click(); await handle.dispose(); }
  const text = selector => site.evaluate(selector => window.commentLayouts.ui.shadowRoot.querySelector(selector).innerText, selector);
  const waitState = expected => site.waitForFunction(expected => window.commentLayouts.ui.dataset.state === expected, expected, { timeout: 120000 });
  const source = mode => site.evaluate(mode => window.commentLayouts.editors[mode].value, mode);
  for (const mode of ['normal', 'modal', 'closed-modal']) {
    await site.evaluate(mode => {
      const state = window.commentLayouts;
      state.dialogs[mode]?.showModal(); const editor = state.editors[mode]; editor.scrollIntoView({ block: 'center' }); editor.focus();
    }, mode);
    await site.keyboard.press('Control+a');
    if (mode === 'normal') {
      // A genuine partial textarea selection also checks the popup's mirror
      // placement under hostile host-page span rules.
      await site.keyboard.press('ArrowLeft');
      for (let i = 0; i < 6; i++) await site.keyboard.press('ArrowRight');
      await site.keyboard.down('Shift');
      for (let i = 0; i < 'Yesterday I go to the shop and buy some milk.'.length; i++) await site.keyboard.press('ArrowRight');
      await site.keyboard.up('Shift');
    }
    await waitState('trigger');
    await click('.trigger'); await waitState('result');
    if (mode === 'normal') {
      const anchored = await site.evaluate(() => {
        const editor = window.commentLayouts.editors.normal, rect = editor.getBoundingClientRect();
        const panel = window.commentLayouts.ui.shadowRoot.querySelector('.panel').getBoundingClientRect();
        const context = document.createElement('canvas').getContext('2d'); context.font = '13px monospace';
        const left = Math.min(Math.max(8, rect.left + 13 + context.measureText('Keep. ').width), innerWidth - panel.width - 8);
        return { error: Math.abs(panel.left - left) };
      });
      assert.ok(anchored.error < 3, 'Host-page span styles must not move the selection anchor');
    }
    const corrected = await text('.correction'); assert.match(corrected, /went/); assert.match(corrected, /bought/);
    if (mode === 'modal') await site.screenshot({ path: 'artifacts/reddit-style-markdown-modal.png', fullPage: true });
    await click('.actions .action');
    const expected = mode === 'normal' ? `Keep. ${corrected} End.` : corrected;
    assert.equal(await source(mode), expected);
    assert.equal(await site.evaluate(mode => window.commentLayouts.drafts[mode], mode), expected);
    await site.keyboard.press('Control+z');
    assert.equal(await source(mode), mode === 'normal' ? 'Keep. Yesterday I go to the shop and buy some milk. End.' : 'Yesterday I go to the shop and buy some milk.');
    await site.evaluate(mode => window.commentLayouts.dialogs[mode]?.close(), mode);
    report.checks.push(`Nested Markdown textarea selection, clickable icon, Replace, and Undo work in ${mode} comment layouts`);
  }
  await site.evaluate(() => {
    const state = window.commentLayouts; document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== state.sheet);
    const row = document.createElement('div'); row.id = 'youtube-style-row';
    Object.assign(row.style, { width: '700px', overflow: 'auto', whiteSpace: 'pre', borderBottom: '1px solid #aaa', marginTop: '20px' });
    const editor = document.createElement('yt-formatted-string'); editor.id = 'contenteditable-root'; editor.contentEditable = 'true'; editor.tabIndex = 0;
    Object.assign(editor.style, { display: 'inline', font: '14px/20px Arial' });
    row.append(editor); state.container.append(row); state.inline = editor; state.row = row;
    editor.addEventListener('input', () => { state.drafts.inline = editor.innerText; });
  });
  await page.locator('#auto-check').check();
  await page.waitForFunction(async () => (await chrome.storage.local.get('autoCheck')).autoCheck === true);
  await site.bringToFront();
  await site.evaluate(() => { window.commentLayouts.inline.scrollIntoView({ block: 'center' }); window.commentLayouts.inline.focus(); });
  await site.keyboard.insertText('Yesterday I go to the shop and buy some milk.');
  const status = expected => site.waitForFunction(expected => window.commentLayouts.ui.shadowRoot.querySelector('.auto-status').dataset.state === expected, expected, { timeout: 120000 });
  await status('suggestions');
  const metrics = await site.evaluate(() => ({ width: window.commentLayouts.inline.clientWidth, height: window.commentLayouts.inline.clientHeight, marks: window.commentLayouts.ui.shadowRoot.querySelectorAll('.auto-underline').length }));
  assert.equal(metrics.width, 0); assert.equal(metrics.height, 0); assert.ok(metrics.marks >= 2, 'Inline editor suggestions must produce actual visible underline elements');
  report.checks.push('Inline comment editors with zero client dimensions display their correction underlines');

  await site.evaluate(() => { window.commentLayouts.row.style.width = '180px'; window.commentLayouts.row.scrollLeft = 90; });
  await site.waitForTimeout(100);
  assert.equal(await site.evaluate(() => {
    const state = window.commentLayouts, box = state.row.getBoundingClientRect();
    const marks = [...state.ui.shadowRoot.querySelectorAll('.auto-underline')];
    return marks.length > 0 && marks.every(mark => { const rect = mark.getBoundingClientRect(); return rect.left >= box.left - 1 && rect.right <= box.right + 1; });
  }), true, 'Underlines must follow horizontal scrolling and stay within the actual clipping ancestor');
  await site.evaluate(() => { window.commentLayouts.row.style.width = '700px'; window.commentLayouts.row.scrollLeft = 0; });
  const checksBefore = await page.evaluate(() => window.localEnglish.model.checkCount);
  await site.evaluate(() => {
    const editor = window.commentLayouts.inline, value = editor.textContent;
    const replacement = document.createElement('span'); replacement.textContent = value; editor.replaceChildren(replacement);
  });
  await site.waitForFunction(() => window.commentLayouts.ui.shadowRoot.querySelectorAll('.auto-underline').length >= 2);
  assert.equal(await page.evaluate(() => window.localEnglish.model.checkCount), checksBefore);
  await site.screenshot({ path: 'artifacts/youtube-style-inline-underlines.png', fullPage: true });
  await site.getByRole('button', { name: 'Review correction: go → went', exact: true }).click();
  await click('.actions .action');
  assert.equal(await site.evaluate(() => window.commentLayouts.inline.innerText), 'Yesterday I went to the shop and buy some milk.');
  await status('suggestions');
  report.checks.push('Underlines follow scrolling and survive a controlled editor replacing unchanged text nodes');
  assert.equal(await page.evaluate(() => window.localEnglish.model.info.instanceId), loaded.info.instanceId);
  await page.locator('#auto-check').uncheck();
  await page.waitForFunction(async () => (await chrome.storage.local.get('autoCheck')).autoCheck === false);
  await site.evaluate(() => { window.commentLayouts.editors.normal.focus(); });
  await site.waitForFunction(() => window.commentLayouts.ui.parentNode === document.documentElement);
  await site.evaluate(() => { window.commentLayouts.container.remove(); delete window.commentLayouts; });
}
