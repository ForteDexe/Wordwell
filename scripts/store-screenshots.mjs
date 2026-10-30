import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';

// Capture actual Wordwell UI with real model output on a first-party demo.
export async function captureStoreScreenshots({ context, page, site, fixtureOrigin, report }) {
  await mkdir('artifacts/store', { recursive: true });
  const previous = await page.evaluate(() => chrome.storage.local.get(['autoCheck', 'targetLanguage', 'customPrompt', 'translationEnabled', 'translationLanguage', 'instantTranslation', 'pageTranslationEnabled', 'pageTranslationLanguage']));
  const viewport = site.viewportSize();
  const host = site.locator('local-english-selection');
  async function card() {
    await site.waitForFunction(() => ['result', 'error'].includes(document.querySelector('local-english-selection')?.dataset.state), undefined, { timeout: 120000 });
    assert.equal(await host.getAttribute('data-state'), 'result', await host.locator('.body').innerText());
  }
  try {
    await page.evaluate(() => chrome.storage.local.set({ autoCheck: true, targetLanguage: 'en', customPrompt: '', translationEnabled: true, translationLanguage: 'vi', instantTranslation: false, pageTranslationEnabled: true, pageTranslationLanguage: 'vi' }));
    await page.waitForFunction(() => window.localEnglish.model.targetLanguage === 'en' && window.localEnglish.model.customPrompt === '');
    await site.setViewportSize({ width: 1280, height: 800 });
    await site.goto(`${fixtureOrigin}/store-demo.html`); await site.bringToFront();
    const editor = site.locator('#store-editor');
    await editor.fill('I look forward to hear from you.');
    await host.locator('.auto-underline').first().waitFor({ state: 'visible', timeout: 120000 });
    await host.locator('.auto-underline').first().click(); await card();
    await site.screenshot({ path: 'artifacts/store/01-grammar.png' });
    await host.getByRole('button', { name: 'Close suggestion', exact: true }).click();
    await page.evaluate(() => chrome.storage.local.set({ autoCheck: false }));
    await editor.fill('Thank you for your help.');
    await editor.evaluate(node => { node.focus(); node.select(); node.dispatchEvent(new Event('select', { bubbles: true })); });
    const translate = site.getByRole('button', { name: 'Translate selected text', exact: true });
    await translate.waitFor({ state: 'visible' }); await translate.click(); await card();
    assert.match(await host.locator('.heading').innerText(), /Vietnamese/);
    await site.screenshot({ path: 'artifacts/store/02-translation.png' });
    await host.getByRole('button', { name: 'Close suggestion', exact: true }).click();
    const article = site.locator('#store-article'); await article.click();
    await article.evaluate(node => {
      const range = document.createRange(); range.selectNodeContents(node);
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await translate.waitFor({ state: 'visible' }); await translate.click(); await card();
    assert.equal(await host.getByRole('button', { name: 'Copy translation', exact: true }).count(), 1);
    await site.screenshot({ path: 'artifacts/store/03-page-translation.png' });

    const promo = await context.newPage();
    try {
      await promo.setViewportSize({ width: 440, height: 280 });
      const icon = await readFile('extension/icons/wordwell.svg', 'utf8');
      await promo.setContent(`<!doctype html><style>body{margin:0;background:#eaf4ef;color:#18594e;font-family:system-ui,sans-serif;height:280px;display:flex;align-items:center;justify-content:center;text-align:center}svg{width:80px;height:80px}h1{font-size:38px;letter-spacing:-1.5px;margin:8px 0 4px}p{font-size:15px;margin:0;color:#416058}</style><main>${icon}<h1>Wordwell</h1><p>Write clearly. Translate locally.</p></main>`);
      await promo.screenshot({ path: 'artifacts/store/promo-440x280.png' });
    } finally { await promo.close(); }
    report.checks.push('Three 1280x800 store screenshots show actual local-model grammar and translation UI; a 440x280 branding tile is included');
    report.storeScreenshots = ['01-grammar.png', '02-translation.png', '03-page-translation.png', 'promo-440x280.png'];
  } finally {
    await page.evaluate(values => chrome.storage.local.set(values), previous);
    await site.setViewportSize(viewport);
  }
}
