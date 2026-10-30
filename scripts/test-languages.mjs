import assert from 'node:assert/strict';

export async function testCorrectionLanguages({ page, report }) {
  await page.bringToFront();
  await page.locator('#auto-check').uncheck();
  await page.waitForFunction(async () => (await chrome.storage.local.get('autoCheck')).autoCheck === false);
  const initial = await page.evaluate(() => window.localEnglish.snapshot());
  const instance = initial.info.instanceId;
  async function choose(language) {
    await page.locator('#target-language').selectOption(language);
    await page.waitForFunction(async language => (await chrome.storage.local.get('targetLanguage')).targetLanguage === language
      && window.localEnglish.model.targetLanguage === language && !document.getElementById('target-language').disabled, language);
  }
  const cases = [];
  for (const [language, text] of [
    ['en', 'Yesterday I go to the shop and buy some milk.'],
    ['es', 'Yo tiene un perro.'], ['fr', 'Bonjour, je suis étudiant.'],
    ['vi', 'Tôi đang học tiếng Anh.'], ['ja', '私は学生です。'],
  ]) {
    await choose(language);
    await page.locator('#original').fill(text);
    await page.click('#correct');
    await page.waitForFunction(() => !window.localEnglish.model.busy);
    assert.equal(await page.locator('#error').isVisible(), false);
    const snapshot = await page.evaluate(() => window.localEnglish.snapshot());
    assert.equal(snapshot.result.language, language);
    assert.equal(snapshot.info.instanceId, instance, 'Language changes must reuse the loaded model');
    const native = await page.evaluate(text => window.localEnglish.model.countTokens(text), text);
    assert.equal(native.prompt_tokens, snapshot.result.usage.prompt_tokens);
    cases.push({ language, original: text, corrected: snapshot.result.corrected });
  }
  report.languageCases = cases;
  console.log(`Language checks: ${JSON.stringify(cases)}`);
  assert.equal(cases[0].corrected, 'Yesterday I went to the shop and bought some milk.');
  assert.equal(cases[1].corrected, 'Yo tengo un perro.');
  assert.equal(cases[2].corrected, cases[2].original);
  assert.equal(cases[3].corrected, cases[3].original);
  assert.equal(cases[4].corrected, cases[4].original);
  report.checks.push('Saved language choices reach the correction prompt and exact token counts without reloading the model');
  report.checks.push('The real model corrects English and Spanish grammar while preserving correct French, Vietnamese, and Japanese text');

  // A language setting controls correction rather than translation.
  await choose('fr');
  await page.locator('#original').fill('I received your message yesterday.');
  await page.click('#correct');
  await page.waitForFunction(() => !window.localEnglish.model.busy);
  assert.equal(await page.locator('#corrected').inputValue(), 'I received your message yesterday.');
  report.checks.push('A French correction request leaves English text unchanged rather than translating it');

  // A cached, unchanged sentence must be checked again after changing language.
  await choose('en');
  await page.locator('#auto-check').check();
  await page.locator('#original').fill('I received your message yesterday.');
  const state = expected => page.waitForFunction(expected => document.querySelector('local-english-selection')?.shadowRoot.querySelector('.auto-status')?.dataset.state === expected, expected, { timeout: 120000 });
  await state('checked');
  const before = await page.evaluate(() => window.localEnglish.model.checkCount);
  await choose('fr');
  await page.locator('#original').focus();
  await page.waitForFunction(before => window.localEnglish.model.checkCount > before && !window.localEnglish.model.busy, before, { timeout: 120000 });
  await state('checked');
  assert.equal(await page.evaluate(() => window.localEnglish.model.checkCount), before + 1);
  await page.locator('#auto-check').uncheck();
  report.checks.push('Changing language invalidates cached suggestions and rescans the unchanged focused editor');

  await choose('ja');
  const beforeJapanese = await page.evaluate(() => window.localEnglish.model.checkCount);
  await page.locator('#auto-check').check();
  await page.locator('#original').fill('私は学生です。');
  await page.waitForFunction(before => window.localEnglish.model.checkCount > before && !window.localEnglish.model.busy, beforeJapanese, { timeout: 120000 });
  await state('checked');
  assert.equal(await page.evaluate(() => window.localEnglish.model.checkCount), beforeJapanese + 1);
  await page.locator('#auto-check').uncheck();
  report.checks.push('Automatic checks process Japanese sentences without spaces using the selected language');

  // Freeze one language across every piece even if settings change mid-check.
  await choose('en');
  await page.locator('#original').fill('');
  const frozen = await page.evaluate(async () => {
    const { model } = window.localEnglish, runtime = model.runtime;
    const generate = runtime.createChatCompletion, prompts = [];
    runtime.createChatCompletion = async options => {
      prompts.push(options.messages[0].content);
      model.targetLanguage = 'es'; model.customPrompt = 'A different prompt for future checks.';
      const count = await runtime.countChatTokens(options);
      return { choices: [{ message: { content: options.messages[1].content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: count.prompt_tokens, completion_tokens: 1, total_tokens: count.prompt_tokens + 1 } };
    };
    try {
      const result = await model.correct('word '.repeat(450) + '\n' + 'word '.repeat(450));
      return { language: result.language, promptOverride: result.promptOverride, prompts };
    } finally { runtime.createChatCompletion = generate; model.targetLanguage = 'en'; model.customPrompt = ''; }
  });
  assert.equal(frozen.language, 'en');
  assert.equal(frozen.promptOverride, '');
  assert.equal(frozen.prompts.length, 2);
  assert.ok(frozen.prompts.every(prompt => /correct the English grammar/i.test(prompt)));
  report.checks.push('A language change during a chunked request cannot mix instructions or invalidate exact counts');

  await choose('vi');
  await page.reload();
  await page.waitForFunction(() => window.localEnglish?.initialized && window.localEnglish.model.ready, undefined, { timeout: 180000 });
  assert.equal(await page.locator('#target-language').inputValue(), 'vi');
  assert.equal(await page.evaluate(() => window.localEnglish.model.targetLanguage), 'vi');
  await page.screenshot({ path: 'artifacts/correction-language-settings.png', fullPage: true });
  await choose('en');
  report.checks.push('Correction language persists across workspace/model autoload');
}
