import assert from 'node:assert/strict';

export async function testSelectionDragging({ surface, report }) {
  await surface.bringToFront();
  await surface.evaluate(() => {
    const fixture = document.createElement('article'); fixture.id = 'selection-drag-fixture';
    fixture.style.margin = '40px';
    window.selectionDragTargets = [];
    for (const mode of ['document', 'open', 'closed']) {
      const container = document.createElement('div'); fixture.append(container);
      const scope = mode === 'document' ? container : container.attachShadow({ mode });
      const paragraph = document.createElement('p'); paragraph.textContent = 'Only this sentence should be selected.';
      scope.append(paragraph); window.selectionDragTargets.push(paragraph);
    }
    document.body.prepend(fixture);
  });
  const settle = () => surface.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  try {
    for (let index = 0; index < 3; index++) {
      const bounds = await surface.evaluate(index => {
        const target = window.selectionDragTargets[index]; target.scrollIntoView({ block: 'center' });
        const range = document.createRange(); range.selectNodeContents(target);
        const rect = range.getBoundingClientRect();
        return { left: rect.left, right: rect.right, y: (rect.top + rect.bottom) / 2 };
      }, index);
      for (const reverse of [false, true]) {
        // Start a new selection rather than Chrome's drag-and-drop gesture
        // for text that was already selected by the previous direction.
        await surface.evaluate(() => window.getSelection()?.removeAllRanges()); await settle();
        const start = reverse ? bounds.right + 1 : bounds.left + .1, end = reverse ? bounds.left + .1 : bounds.right + 1;
        await surface.mouse.move(start, bounds.y); await surface.mouse.down();
        try {
          for (const fraction of [.3, .65, 1]) {
            await surface.mouse.move(start + (end - start) * fraction, bounds.y, { steps: 3 });
            await settle();
            const state = await surface.evaluate(index => {
              const target = window.selectionDragTargets[index], selection = window.getSelection();
              const tree = target.getRootNode();
              const range = selection.getComposedRanges({ shadowRoots: tree instanceof ShadowRoot ? [tree] : [] })[0];
              const root = document.querySelector('local-english-selection')?.shadowRoot;
              return { selected: selection.toString(), contained: !!range && target.contains(range.startContainer) && target.contains(range.endContainer),
                visible: [...(root?.querySelectorAll('.trigger:not([hidden]), .panel:not([hidden])') || [])].map(node => node.className), state: root?.host.dataset.state };
            }, index);
            assert.ok(state.selected.length > 0, 'Native selection should grow during dragging');
            assert.equal(state.contained, true, 'Dragging must not expand selection to the rest of the page');
            assert.deepEqual(state.visible, [], `Selection UI must stay hidden until release: ${JSON.stringify({ index, reverse, fraction, ...state })}`);
          }
        } finally { await surface.mouse.up(); }
        await surface.getByRole('button', { name: 'Translate selected text', exact: true }).waitFor({ state: 'visible' });
        assert.equal(await surface.evaluate(() => window.getSelection().toString()), 'Only this sentence should be selected.');
      }
    }
    report.checks.push('Native forward and backward drags stay within the selected text, with UI shown only after release in document, open, and closed shadow roots');
  } finally {
    await surface.evaluate(() => {
      document.getElementById('selection-drag-fixture')?.remove();
      delete window.selectionDragTargets; window.getSelection()?.removeAllRanges();
    });
  }
}

if (process.argv.includes('--standalone')) {
  const { chromium } = await import('playwright');
  const { mkdir, mkdtemp } = await import('node:fs/promises');
  const { createServer } = await import('node:http');
  const { default: path } = await import('node:path');
  const { removeTestProfile } = await import('./browser-profile.mjs');
  await mkdir('.browser-check', { recursive: true });
  const profile = await mkdtemp(path.resolve('.browser-check/extension-'));
  const extension = path.resolve('dist/extension');
  const fixture = createServer((request, response) => response.end('<!doctype html><title>Page selection drag</title><p>Unselected page content.</p>'));
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/workspace.html`);
    await page.waitForFunction(() => window.localEnglish?.initialized);
    await page.evaluate(() => chrome.storage.local.set({ autoCheck: false, pageTranslationEnabled: true }));
    await page.waitForFunction(() => document.getElementById('page-translation-enabled').checked);
    const report = { checks: [] };
    await testSelectionDragging({ surface: page, report });
    const site = await context.newPage(); await site.goto(`http://127.0.0.1:${fixture.address().port}`);
    await testSelectionDragging({ surface: site, report });
    console.log(`PASS: ${report.checks.length} selection-drag checks across workspace and website; no model needed`);
  } finally {
    await context?.close(); await new Promise(resolve => fixture.close(resolve)); await removeTestProfile(profile);
  }
}
