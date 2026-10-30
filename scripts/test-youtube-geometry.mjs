import assert from 'node:assert/strict';

export async function testYouTubeGeometry({ page, site, worker, report }) {
  const viewport = site.viewportSize();
  await site.setViewportSize({ width: 1920, height: 945 });
  await site.bringToFront();
  await site.evaluate(() => {
    const state = window.youtubeGeometry = { bodyStyle: document.body.getAttribute('style'), inputs: 0 };
    document.body.style.position = 'relative'; document.body.style.margin = '0';
    const wrapper = document.createElement('section'); wrapper.id = 'youtube-geometry-fixture';
    // This wrapper does NOT clip the absolute descendant, whose containing
    // block is the body. The old ancestor walk incorrectly erased all spans.
    Object.assign(wrapper.style, { overflow: 'hidden', width: '0', height: '0' });
    const anchor = document.createElement('div');
    Object.assign(anchor.style, { position: 'absolute', left: '72px', top: '503.203125px', width: '1265.25px', background: '#111', color: '#fff' });
    wrapper.append(anchor); document.body.append(wrapper);
    let parent = anchor;
    for (const tag of ['tp-yt-paper-input-container', 'div', 'div', 'div', 'ytd-emoji-input', 'yt-user-mention-autosuggest-input', 'yt-formatted-string']) {
      const node = document.createElement(tag); node.className = 'style-scope ytd-commentbox'; node.style.display = 'block'; parent.append(node); parent = node;
    }
    const editor = document.createElement('div'); editor.id = 'contenteditable-root'; editor.contentEditable = 'true'; editor.tabIndex = 0;
    editor.className = 'style-scope yt-formatted-string';
    Object.assign(editor.style, { display: 'block', minHeight: '20px', outline: 'none', whiteSpace: 'pre-wrap', font: '14px/20px Arial' });
    parent.append(editor);
    editor.addEventListener('input', () => { state.inputs++; });
    Object.assign(state, { wrapper, anchor, editor });
  });
  await page.locator('#auto-check').check();
  await page.waitForFunction(async () => (await chrome.storage.local.get('autoCheck')).autoCheck === true);
  await site.bringToFront();
  const before = await page.evaluate(() => window.localEnglish.model.checkCount);
  await site.evaluate(() => {
    const editor = window.youtubeGeometry.editor; editor.focus();
    // The supplied YouTube report recorded zero native input events. Exercise
    // the same mutation fallback, without clicking the extension status icon.
    editor.textContent = 'yesteday I go to the shop and buy some milk.';
  });
  await site.waitForFunction(() => document.querySelector('local-english-selection')?.shadowRoot.querySelector('.auto-status')?.dataset.state === 'suggestions', undefined, { timeout: 120000 });
  assert.equal(await page.evaluate(() => window.localEnglish.model.checkCount), before + 1);
  assert.equal(await site.evaluate(() => window.youtubeGeometry.inputs), 0);
  const host = site.locator('local-english-selection');
  assert.ok(await host.locator('.auto-underline').count() >= 2);
  assert.equal(await host.evaluate(host => [...host.shadowRoot.querySelectorAll('.auto-underline')].every(mark => {
    const rect = mark.getBoundingClientRect(); return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === host;
  })), true);
  report.checks.push('A YouTube-shaped block editor escaping an overflow wrapper checks automatically and paints clickable underlines');
  await site.screenshot({ path: 'artifacts/youtube-block-editor-geometry.png', fullPage: true });
  const reports = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return globalThis.localEnglishDiagnostics.captureEditorDiagnostics(tab.id);
  });
  const captured = reports.at(-1);
  assert.ok(captured.automatic.spans.every(span => span.geometry.raw.length > 0 && span.geometry.clipped.length > 0 && span.geometry.native.intersecting));
  assert.equal(JSON.stringify(captured).includes('yesteday I go to the shop and buy some milk.'), false);
  report.checks.push('Geometry diagnostics distinguish raw text rectangles from the native visible area and clipped boxes');

  await site.bringToFront();
  await site.evaluate(() => {
    const state = window.youtubeGeometry, scroller = document.createElement('div');
    Object.assign(scroller.style, { position: 'relative', width: '180px', height: '32px', overflow: 'auto', marginLeft: '72px' });
    document.body.append(scroller);
    if (scroller.moveBefore) scroller.moveBefore(state.anchor, null); else scroller.append(state.anchor);
    Object.assign(state.anchor.style, { position: 'relative', left: '0', top: '0' });
    scroller.scrollIntoView({ block: 'center' }); state.editor.focus({ preventScroll: true }); scroller.scrollLeft = 100;
    state.scroller = scroller;
  });
  await site.waitForFunction(() => {
    const state = window.youtubeGeometry, clip = state.scroller.getBoundingClientRect();
    const marks = [...document.querySelector('local-english-selection').shadowRoot.querySelectorAll('.auto-underline')];
    return marks.length > 0 && marks.every(mark => { const rect = mark.getBoundingClientRect(); return rect.left >= clip.left - 1 && rect.right <= clip.right + 1; });
  });
  const first = host.locator('.auto-underline').first();
  await first.click();
  const original = await host.locator('.original').textContent(), corrected = await host.locator('.correction').innerText();
  const source = await site.evaluate(() => window.youtubeGeometry.editor.innerText);
  await host.getByRole('button', { name: 'Replace', exact: true }).click();
  assert.equal(await site.evaluate(() => window.youtubeGeometry.editor.innerText), source.replace(original, corrected));
  assert.equal(await site.evaluate(() => window.youtubeGeometry.inputs), 1);
  report.checks.push('Native clipping still respects real scroll containers and underlines support Replace after scrolling');
  await page.locator('#auto-check').uncheck();
  await page.waitForFunction(async () => (await chrome.storage.local.get('autoCheck')).autoCheck === false);
  await page.click('#clear-editor-diagnostics');
  await page.waitForFunction(() => document.getElementById('copy-editor-diagnostics').disabled);
  await site.evaluate(() => {
    const state = window.youtubeGeometry; state.scroller.remove(); state.wrapper.remove();
    if (state.bodyStyle === null) document.body.removeAttribute('style'); else document.body.setAttribute('style', state.bodyStyle);
    delete window.youtubeGeometry;
  });
  await site.setViewportSize(viewport);
}
