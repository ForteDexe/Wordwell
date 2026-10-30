import assert from 'node:assert/strict';

export async function testWorkspaceSettings({ page, report }) {
  await page.bringToFront();
  await page.locator('#auto-check').uncheck();
  await page.waitForFunction(async () => (await chrome.storage.local.get('autoCheck')).autoCheck === false);
  const before = await page.evaluate(() => window.localEnglish.snapshot());
  const text = 'Yesterday I go to the shop and buy some milk.';
  await page.locator('#original').fill(text);
  await page.waitForFunction(() => /^\d[\d,]* \/ 1,024 prompt tokens$/.test(document.getElementById('token-count').textContent));
  const native = await page.evaluate(text => window.localEnglish.model.countTokens(text), text);
  assert.equal(await page.locator('#token-count').innerText(), `${native.prompt_tokens.toLocaleString()} / 1,024 prompt tokens`);
  assert.match(await page.locator('#token-count').getAttribute('title'), /instructions and chat formatting/);
  assert.equal(await page.locator('#original').isEditable(), true);
  assert.equal(await page.evaluate(() => window.localEnglish.model.checkCount), before.checkCount, 'Counting tokens must not run inference');
  report.checks.push('The live prompt-token counter matches native counts beside the character count without running inference');

  // A pending count must finish before inference enters the same WASM runtime.
  const concurrency = await page.evaluate(async () => {
    const { model } = window.localEnglish, runtime = model.runtime;
    const count = runtime.countChatTokens, generate = runtime.createChatCompletion;
    let counting = false, overlap = false;
    runtime.countChatTokens = async function(options) {
      counting = true;
      try { await new Promise(resolve => setTimeout(resolve, 30)); return await count.call(this, options); }
      finally { counting = false; }
    };
    runtime.createChatCompletion = function(options) { overlap ||= counting; return generate.call(this, options); };
    try {
      const preview = model.countTokens('A pending token preview.');
      await new Promise(resolve => setTimeout(resolve, 5));
      const correction = model.correct('I look forward to hear from you.');
      const [tokens, result] = await Promise.all([preview, correction]);
      return { overlap, tokens, corrected: result.corrected, busy: model.busy };
    } finally { runtime.countChatTokens = count; runtime.createChatCompletion = generate; }
  });
  assert.equal(concurrency.overlap, false);
  assert.ok(concurrency.tokens.prompt_tokens > 0);
  assert.equal(concurrency.corrected, 'I look forward to hearing from you.');
  assert.equal(concurrency.busy, false);
  report.checks.push('Token previews and grammar inference serialize safely in the shared runtime');

  const saved = await page.evaluate(async () => (await import('./model-cache.js')).savedModelInfo());
  for (const invalid of ['511', '8193', '1024.5', '']) {
    await page.locator('#context-size').fill(invalid);
    await page.locator('#context-size').press('Tab');
    assert.equal(await page.locator('#context-validation').isVisible(), true);
    assert.equal(await page.locator('#context-size').inputValue(), '1024');
    assert.equal(await page.evaluate(async () => (await chrome.storage.local.get('contextSize')).contextSize ?? 1024), 1024);
  }
  assert.equal(await page.locator('#context-size').getAttribute('min'), '512');
  await page.locator('#context-size').fill('1500');
  await page.locator('#context-size').press('Tab');
  await page.waitForFunction(async () => (await chrome.storage.local.get('contextSize')).contextSize === 1536);
  assert.equal(await page.locator('#context-size').inputValue(), '1536');
  report.checks.push('Numeric context input rejects values below 512, above 8,192, fractions, and blanks; custom values round to engine blocks');
  await page.locator('#apply-context').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => window.localEnglish.model.info.context), 1024);
  assert.match(await page.locator('#context-help').innerText(), /Currently using 1,024/);
  assert.match(await page.locator('#token-count').innerText(), /\/ 1,024/);
  await page.locator('#apply-context').click();
  await page.waitForFunction(() => window.localEnglish.model.ready && window.localEnglish.model.info.context === 1536 && !document.getElementById('context-size').disabled, undefined, { timeout: 180000 });
  assert.equal(await page.locator('#apply-context').isVisible(), false);
  assert.match(await page.locator('#context-badge').innerText(), /1,536/);
  await page.waitForFunction(() => /^\d[\d,]* \/ 1,536 prompt tokens$/.test(document.getElementById('token-count').textContent));
  assert.deepEqual(await page.evaluate(async () => (await import('./model-cache.js')).savedModelInfo()), saved, 'Context reload must reuse the saved model without rewriting its copy');
  await page.click('#correct');
  await page.waitForFunction(() => !window.localEnglish.model.busy);
  const result = await page.evaluate(() => window.localEnglish.snapshot().result);
  assert.equal(result.corrected, 'Yesterday I went to the shop and bought some milk.');
  assert.equal(result.budget.context, 1536);
  report.checks.push('Context changes stay pending until Apply, then reload the model and use the new context in token budgeting');

  // Persisted context must be used by model autoload, not just by the input.
  await page.reload();
  await page.waitForFunction(() => window.localEnglish?.initialized && window.localEnglish.model.ready, undefined, { timeout: 180000 });
  assert.equal(await page.locator('#context-size').inputValue(), '1536');
  assert.equal(await page.evaluate(() => window.localEnglish.model.info.context), 1536);
  await page.locator('#original').fill(text);
  await page.waitForFunction(() => /^\d[\d,]* \/ 1,536 prompt tokens$/.test(document.getElementById('token-count').textContent));
  await page.screenshot({ path: 'artifacts/workspace-token-settings.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'artifacts/workspace-token-settings-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
  report.checks.push('Saved context survives workspace autoload; token controls and counts fit a narrow viewport');
}
