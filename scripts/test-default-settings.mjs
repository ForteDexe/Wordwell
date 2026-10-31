import assert from 'node:assert/strict';

export async function testDefaultSettings({ page, report }) {
  const expected = { engineMode: 'browser', autoCheck: true, correctionLanguage: 'en', context: '1024', translationEnabled: false,
    translationLanguage: 'zh-CN', instantTranslation: true, pageEnabled: false, pageLanguage: 'vi' };
  const snapshot = () => page.evaluate(() => {
    const get = id => document.getElementById(id);
    return { engineMode: get('engine-mode').value, autoCheck: get('auto-check').checked, correctionLanguage: get('target-language').value, context: get('context-size').value,
      translationEnabled: get('translation-enabled').checked, translationLanguage: get('translation-language').value,
      instantTranslation: get('instant-translation').checked, pageEnabled: get('page-translation-enabled').checked,
      pageLanguage: get('page-translation-language').value };
  });
  const reload = async () => { await page.reload(); await page.waitForFunction(() => window.localEnglish?.initialized); };
  assert.deepEqual(await snapshot(), expected);
  assert.equal(await page.locator('#browser-engine').isVisible(), true);
  assert.equal(await page.locator('#server-engine').isHidden(), true);
  for (const id of ['translation-language', 'instant-translation', 'page-translation-language']) assert.equal(await page.locator(`#${id}`).isDisabled(), true);
  assert.match(await page.locator('#prompt-status').innerText(), /default prompt/i);
  const qwenTip = page.locator('#model-download'), gemmaTip = page.locator('#gemma-model-download');
  assert.match(await qwenTip.getAttribute('href'), /Qwen3\.5-0\.8B-UD-Q4_K_XL\.gguf$/);
  assert.match(await qwenTip.locator('xpath=..').innerText(), /recommended default.*Simplified Chinese/i);
  assert.match(await gemmaTip.getAttribute('href'), /gemma-3-1b-it-UD-Q3_K_XL\.gguf$/);
  assert.match(await gemmaTip.locator('xpath=..').innerText(), /Vietnamese.*rephrase already-correct text/i);
  report.checks.push('Fresh settings and model tips match the English defaults, disabled translation, 1024 context, and benchmarked Qwen/Gemma recommendations');

  const saved = { autoCheck: false, targetLanguage: 'fr', contextSize: 1536, translationEnabled: true,
    translationLanguage: 'es', instantTranslation: false, pageTranslationEnabled: true, pageTranslationLanguage: 'de' };
  await page.evaluate(values => chrome.storage.local.set(values), saved); await reload();
  assert.deepEqual(await snapshot(), { engineMode: 'browser', autoCheck: false, correctionLanguage: 'fr', context: '1536', translationEnabled: true,
    translationLanguage: 'es', instantTranslation: false, pageEnabled: true, pageLanguage: 'de' });
  report.checks.push('Saved preferences, including instant mode explicitly set to false, override all new defaults');
  await page.evaluate(keys => chrome.storage.local.remove(keys), Object.keys(saved)); await reload();
  assert.deepEqual(await snapshot(), expected);
  await page.locator('#translation-enabled').check();
  const editor = page.locator('#original'); await editor.fill('Hello.');
  await editor.evaluate(node => { node.focus(); node.select(); node.dispatchEvent(new Event('select', { bubbles: true })); });
  const icon = page.getByRole('button', { name: 'Translate selected text', exact: true });
  await icon.waitFor({ state: 'visible' });
  assert.match(await icon.getAttribute('title'), /Translate and replace.*Chinese \(Simplified\)/);
  await page.locator('#page-translation-enabled').check();
  const text = page.locator('.brand p'); await text.click();
  await text.evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await icon.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('local-english-selection')?.shadowRoot.querySelector('.translate-trigger')?.title.includes('page text'));
  assert.match(await icon.getAttribute('title'), /page text to Vietnamese/);
  report.checks.push('Website selection tools use the same defaults as the workspace, including after saved settings are removed');
  await page.evaluate(keys => chrome.storage.local.remove(keys), Object.keys(saved)); await reload();
  assert.deepEqual(await snapshot(), expected);
}
