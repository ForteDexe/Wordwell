import assert from 'node:assert/strict';

export async function testTranslation({ page, site, report }) {
  const surface = site || page, selector = site ? '#paragraph' : '#original';
  const field = surface.locator(selector);
  const bulb = surface.getByRole('button', { name: 'Refine selected text', exact: true });
  const translate = surface.getByRole('button', { name: 'Translate selected text', exact: true });
  const host = surface.locator('local-english-selection');
  await page.bringToFront();
  await page.locator('#auto-check').uncheck();
  assert.equal(await page.locator('#translation-enabled').isChecked(), false);
  assert.equal(await page.locator('#translation-language').isDisabled(), true);
  const initial = await page.evaluate(() => window.localEnglish.snapshot());
  async function select(text = 'Hello.') {
    await surface.bringToFront(); await field.fill(text);
    await field.evaluate(node => { node.focus(); node.select(); node.dispatchEvent(new Event('select', { bubbles: true })); });
    await bulb.waitFor({ state: 'visible' });
  }
  async function result() {
    await surface.waitForFunction(() => ['result', 'error'].includes(document.querySelector('local-english-selection')?.dataset.state), undefined, { timeout: 120000 });
    assert.equal(await host.getAttribute('data-state'), 'result', await host.locator('.body').innerText());
    return host.locator('.correction').innerText();
  }
  await select();
  assert.equal(await translate.isVisible(), false);
  assert.equal(await page.evaluate(() => window.localEnglish.model.checkCount), initial.checkCount);
  const disabled = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'inline-translate', text: 'Hello.', language: 'es' }));
  assert.equal(disabled.code, 'translation-disabled');
  report.checks.push('Translation is off by default; selections do not start inference and disabled requests are rejected');

  await page.locator('#translation-enabled').check();
  await page.waitForFunction(() => !document.getElementById('translation-language').disabled);
  await page.locator('#translation-language').selectOption('es');
  await page.waitForFunction(async () => (await chrome.storage.local.get('translationLanguage')).translationLanguage === 'es');
  await select();
  await translate.waitFor({ state: 'visible' });
  const a = await bulb.boundingBox(), b = await translate.boundingBox();
  assert.ok(Math.abs(b.x - a.x - a.width - 6) < 1 && Math.abs(a.y - b.y) < 1);
  assert.equal(await translate.locator('svg').count(), 1);
  assert.match(await translate.getAttribute('title'), /Spanish/);
  assert.equal(await page.evaluate(() => window.localEnglish.model.checkCount), initial.checkCount);
  await surface.screenshot({ path: 'artifacts/translation-selection-icons.png', fullPage: true });
  await translate.focus(); await translate.press('Enter');
  const spanish = await result();
  assert.match(spanish, /^Hola[.!]?$/i);
  assert.match(await host.locator('.heading').innerText(), /Translation.*Spanish/);
  assert.equal(await field.inputValue(), 'Hello.');
  await surface.screenshot({ path: 'artifacts/selection-translation.png', fullPage: true });
  await host.getByRole('button', { name: 'Replace', exact: true }).click();
  assert.equal(await field.inputValue(), spanish);
  await field.press('Control+z');
  assert.equal(await field.inputValue(), 'Hello.');
  assert.equal(await page.evaluate(() => window.localEnglish.model.info.instanceId), initial.info.instanceId);
  report.checks.push('The translation icon appears beside the bulb; keyboard activation translates locally, preserves the draft, and supports Replace and Undo');

  // Correction custom prompts must never override a translation request.
  await page.evaluate(() => chrome.storage.local.set({ customPrompt: 'Reply with exactly these three words and no punctuation: CUSTOM PROMPT ACTIVE' }));
  await page.waitForFunction(() => window.localEnglish.model.customPrompt.includes('CUSTOM PROMPT ACTIVE'));
  await select(); await translate.click();
  assert.match(await result(), /^Hola[.!]?$/i);
  await host.getByRole('button', { name: 'Close suggestion', exact: true }).click();
  await select(); await bulb.click();
  assert.equal(await result(), 'CUSTOM PROMPT ACTIVE');
  assert.match(await host.locator('.heading').innerText(), /Improve clarity/);
  await host.getByRole('button', { name: 'Close suggestion', exact: true }).click();
  report.checks.push('Translation uses its own prompt while the bulb continues using the saved correction prompt');

  await page.locator('#translation-language').selectOption('vi');
  await page.waitForFunction(async () => (await chrome.storage.local.get('translationLanguage')).translationLanguage === 'vi');
  const vietnamese = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'inline-translate', text: 'Hello.', language: 'vi' }));
  assert.ok(vietnamese.result, JSON.stringify(vietnamese));
  assert.match(vietnamese.result.corrected, /^(?:xin )?chào(?: bạn)?[.!]?$/i);
  assert.equal(vietnamese.result.operation, 'translate');
  assert.equal(vietnamese.result.promptOverride, '');
  for (const chunk of vietnamese.result.budget.chunks) assert.ok(chunk.promptTokens + chunk.maxOutputTokens + vietnamese.result.budget.safetyMargin <= vietnamese.result.budget.context);
  const exact = await page.evaluate(() => window.localEnglish.model.runtime.countChatTokens(window.localEnglish.model.translationRequest('Hello.', 'vi')));
  assert.equal(exact.prompt_tokens, vietnamese.result.usage.prompt_tokens);
  report.checks.push('The target language reaches inference and translation uses exact token budgeting with output expansion space');

  // Rich editor replacement uses the same saved range as grammar correction.
  const richSelector = site ? '#rich' : '#translation-rich';
  if (!site) await page.evaluate(() => { const node = document.createElement('div'); node.id = 'translation-rich'; node.contentEditable = 'true'; document.body.append(node); });
  await surface.bringToFront();
  const rich = surface.locator(richSelector);
  await rich.evaluate(node => {
    node.textContent = 'Hello.'; node.focus();
    const range = document.createRange(); range.selectNodeContents(node);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await translate.waitFor({ state: 'visible' }); await translate.click();
  const richTranslation = await result();
  assert.match(richTranslation, /^(?:xin )?chào(?: bạn)?[.!]?$/i);
  await host.getByRole('button', { name: 'Replace', exact: true }).click();
  assert.equal(await rich.innerText(), richTranslation);
  if (!site) await rich.evaluate(node => node.remove());
  report.checks.push('Translation selection and Replace also work in a contenteditable editor');

  // Deterministically hold inference while changing translation preferences.
  await page.evaluate(() => {
    const runtime = window.localEnglish.model.runtime, generate = runtime.createChatCompletion;
    let release; const gate = new Promise(resolve => { release = resolve; });
    runtime.createChatCompletion = async function(options) { await gate; return generate.call(this, options); };
    window.translationGate = { release, restore: () => { runtime.createChatCompletion = generate; } };
  });
  try {
    await select(); await translate.click();
    await page.waitForFunction(() => window.localEnglish.model.busy);
    await page.evaluate(() => chrome.storage.local.set({ translationLanguage: 'es' }));
    await host.locator('.panel').waitFor({ state: 'hidden' });
    await page.evaluate(() => window.translationGate.release());
    await page.waitForFunction(() => !window.localEnglish.model.busy, undefined, { timeout: 120000 });
    assert.equal(await field.inputValue(), 'Hello.');
    assert.equal(await host.locator('.panel').isVisible(), false);
  } finally { await page.evaluate(() => { window.translationGate.release(); window.translationGate.restore(); delete window.translationGate; }); }
  report.checks.push('Changing the translation language during inference discards the stale result without editing the source');

  await page.bringToFront();
  await page.reload();
  await page.waitForFunction(() => window.localEnglish?.initialized && window.localEnglish.model.ready, undefined, { timeout: 180000 });
  assert.equal(await page.locator('#translation-enabled').isChecked(), true);
  assert.equal(await page.locator('#translation-language').inputValue(), 'es');
  await page.locator('#translation-enabled').uncheck();
  await page.waitForFunction(async () => (await chrome.storage.local.get('translationEnabled')).translationEnabled === false);
  await select(); await translate.waitFor({ state: 'hidden' });
  assert.equal(await bulb.isVisible(), true);
  await page.evaluate(() => chrome.storage.local.set({ customPrompt: '' }));
  await page.waitForFunction(() => window.localEnglish.model.customPrompt === '');
  report.checks.push('Translation preferences survive autoload; disabling the feature removes only the translation button');
}
