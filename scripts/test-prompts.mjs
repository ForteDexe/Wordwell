import assert from 'node:assert/strict';

export async function testPromptSettings({ page, report }) {
  await page.bringToFront();
  await page.locator('#auto-check').uncheck();
  await page.locator('#target-language').selectOption('en');
  await page.waitForFunction(() => window.localEnglish.model.targetLanguage === 'en' && !document.getElementById('target-language').disabled);
  const english = await page.locator('#target-language option').allTextContents();
  assert.deepEqual(english.filter(label => label.startsWith('English')), ['English']);
  assert.equal(await page.locator('#prompt-settings').evaluate(node => node.open), false);
  await page.locator('#prompt-settings > summary').click();
  const defaultPrompt = await page.evaluate(async () => (await import('./languages.js')).languageTools.instruction('en'));
  assert.equal(await page.locator('#custom-prompt').inputValue(), defaultPrompt);
  report.checks.push('Only one English choice is shown; the collapsed prompt editor contains the editable default');

  const initial = await page.evaluate(() => window.localEnglish.snapshot());
  const custom = 'Reply with exactly these three words and no punctuation: CUSTOM PROMPT ACTIVE';
  async function save(value) {
    await page.locator('#custom-prompt').fill(value);
    await page.locator('#save-prompt').click();
    await page.waitForFunction(value => window.localEnglish.model.customPrompt === value.trim()
      && !document.getElementById('custom-prompt').disabled, value);
    assert.equal(await page.evaluate(async () => (await chrome.storage.local.get('customPrompt')).customPrompt), value.trim());
  }
  async function check(text) {
    await page.locator('#original').fill(text);
    await page.click('#correct');
    await page.waitForFunction(() => !window.localEnglish.model.busy);
    assert.equal(await page.locator('#error').isVisible(), false);
    return page.evaluate(() => window.localEnglish.snapshot().result);
  }
  // The settings prompt is deliberately excluded from grammar/selection UI.
  await page.locator('#auto-check').check();
  await page.locator('#custom-prompt').fill(custom);
  await page.locator('#custom-prompt').evaluate(field => { field.select(); field.dispatchEvent(new Event('select', { bubbles: true })); });
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => window.localEnglish.model.checkCount), initial.checkCount);
  assert.equal(await page.getByRole('button', { name: 'Refine selected text', exact: true }).isVisible(), false);
  await page.locator('#auto-check').uncheck();
  await save(custom);
  assert.equal(await page.evaluate(() => window.localEnglish.model.chatRequest('test').messages[0].content), custom);
  const result = await check('Yesterday I go to the shop and buy some milk.');
  assert.equal(result.corrected, 'CUSTOM PROMPT ACTIVE');
  assert.equal(result.promptOverride, custom);
  const native = await page.evaluate(text => window.localEnglish.model.countTokens(text), result.original);
  assert.equal(native.prompt_tokens, result.usage.prompt_tokens);
  assert.equal(await page.evaluate(() => window.localEnglish.model.info.instanceId), initial.info.instanceId);
  report.checks.push('Custom prompts replace the system instruction and affect exact token counts without reloading; the prompt editor is excluded from checks');

  await page.locator('#target-language').selectOption('fr');
  await page.waitForFunction(() => window.localEnglish.model.targetLanguage === 'fr' && !document.getElementById('target-language').disabled);
  assert.equal(await page.locator('#custom-prompt').inputValue(), custom);
  await save('');
  assert.equal(await page.locator('#custom-prompt').inputValue(), '');
  const french = await page.evaluate(async () => (await import('./languages.js')).languageTools.instruction('fr'));
  assert.equal(await page.locator('#custom-prompt').getAttribute('placeholder'), french);
  assert.equal(await page.evaluate(() => window.localEnglish.model.chatRequest('test').messages[0].content), french);
  assert.match(await page.locator('#prompt-status').innerText(), /default/);
  await page.locator('#default-prompt').click();
  assert.equal(await page.locator('#custom-prompt').inputValue(), french);
  report.checks.push('Blank prompts restore the selected language default; Load default supplies an editable starting point');

  await save(custom);
  await page.reload();
  await page.waitForFunction(() => window.localEnglish?.initialized && window.localEnglish.model.ready, undefined, { timeout: 180000 });
  assert.equal(await page.evaluate(() => window.localEnglish.model.customPrompt), custom);
  assert.equal(await page.locator('#custom-prompt').inputValue(), custom);
  assert.equal(await page.locator('#prompt-settings').evaluate(node => node.open), false);
  await page.locator('#prompt-settings > summary').click();
  await page.screenshot({ path: 'artifacts/custom-prompt-settings.png', fullPage: true });
  report.checks.push('Custom prompts survive workspace/model autoload and the editor starts collapsed');

  await page.locator('#target-language').selectOption('en');
  await page.waitForFunction(() => window.localEnglish.model.targetLanguage === 'en' && !document.getElementById('target-language').disabled);
  const beforeAuto = await page.evaluate(() => window.localEnglish.model.checkCount);
  await page.locator('#auto-check').check();
  await page.locator('#original').fill('I received your message yesterday.');
  await page.waitForFunction(before => window.localEnglish.model.checkCount > before && !window.localEnglish.model.busy, beforeAuto, { timeout: 120000 });
  const state = expected => page.waitForFunction(expected => document.querySelector('local-english-selection')?.shadowRoot.querySelector('.auto-status')?.dataset.state === expected, expected, { timeout: 120000 });
  await state('suggestions');
  const beforeDefault = await page.evaluate(() => window.localEnglish.model.checkCount);
  await save('');
  await page.locator('#original').focus();
  await page.waitForFunction(before => window.localEnglish.model.checkCount > before && !window.localEnglish.model.busy, beforeDefault, { timeout: 120000 });
  await state('checked');
  assert.equal(await page.locator('local-english-selection .auto-underline').count(), 0);
  await page.locator('#auto-check').uncheck();
  report.checks.push('Changing a saved prompt clears cached automatic suggestions and rescans unchanged text with the new instruction');

  await save('word '.repeat(1800).trim());
  await page.locator('#original').fill('He go to work every day.');
  await page.click('#correct');
  await page.waitForFunction(() => !window.localEnglish.model.busy);
  assert.match(await page.locator('#error').innerText(), /prompt leaves too little context/);
  assert.equal(await page.locator('#corrected').inputValue(), '');
  await page.locator('#target-language').selectOption('en');
  await page.waitForFunction(() => window.localEnglish.model.targetLanguage === 'en' && !document.getElementById('target-language').disabled);
  await save('');
  const restored = await check('He go to work every day.');
  assert.equal(restored.corrected, 'He goes to work every day.');
  assert.equal(restored.promptOverride, '');
  report.checks.push('An oversized custom prompt fails without partial output; clearing it restores normal correction');
  await page.locator('#prompt-settings > summary').click();
}
