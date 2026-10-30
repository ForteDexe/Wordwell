import assert from 'node:assert/strict';

export async function testAutomaticChecking({ page, site, report, loaded }) {
  const host = site.locator('local-english-selection');
  const status = host.locator('.auto-status');
  const marks = host.locator('.auto-underline');
  const field = site.locator('#paragraph');
  const count = () => page.evaluate(() => window.localEnglish.model.checkCount);
  async function state(expected) {
    await site.waitForFunction(expected => {
      const node = document.querySelector('local-english-selection')?.shadowRoot.querySelector('.auto-status');
      return node && !node.hidden && node.dataset.state === expected;
    }, expected, { timeout: 120000 });
  }
  const sentence = 'Yesterday I go to the shop and buy some milk.';
  await page.locator('#auto-check').check();
  await page.waitForFunction(async () => (await chrome.storage.local.get('autoCheck')).autoCheck === true);
  await site.bringToFront();
  await site.reload();
  await field.fill('');
  const baseline = await count();
  await field.pressSequentially(sentence, { delay: 12 });
  await state('waiting');
  await site.waitForTimeout(400);
  assert.equal(await count(), baseline, 'Keystrokes must be debounced before inference');
  const box = await field.boundingBox(), icon = await status.boundingBox();
  assert.ok(Math.abs(icon.x + icon.width - box.x - box.width) <= 8);
  assert.ok(Math.abs(icon.y + icon.height - box.y - box.height) <= 8);
  await state('checking');
  assert.equal(await status.getAttribute('aria-busy'), 'true');
  await site.screenshot({ path: 'artifacts/automatic-checking.png', fullPage: true });
  await state('suggestions');
  assert.equal(await count(), baseline + 1);
  assert.equal(await field.inputValue(), sentence);
  assert.equal(await marks.count(), 2);
  assert.equal(await host.locator('.panel').isVisible(), false, 'Automatic checks must not open a popup while typing');
  report.checks.push('Typing is debounced; a bottom-right spinner reports processing without changing the text');
  report.checks.push('Automatic sentence checks display clickable word underlines without opening a popup');

  await host.getByRole('button', { name: 'Review correction: go → went', exact: true }).click();
  assert.equal(await host.locator('.correction').innerText(), 'went');
  const previous = host.getByRole('button', { name: 'Previous suggestion', exact: true });
  const next = host.getByRole('button', { name: 'Next suggestion', exact: true });
  assert.equal(await host.locator('.workspace-link').count(), 0);
  assert.equal(await host.locator('.suggestion-position').innerText(), '1 / 2');
  assert.equal(await previous.isDisabled(), true);
  assert.equal(await next.isEnabled(), true);
  await next.click();
  assert.equal(await host.locator('.correction').innerText(), 'bought');
  assert.equal(await host.locator('.suggestion-position').innerText(), '2 / 2');
  assert.equal(await next.isDisabled(), true);
  assert.equal(await previous.isEnabled(), true);
  assert.equal(await previous.evaluate(node => node.getRootNode().activeElement === node), true);
  await previous.press('Enter');
  assert.equal(await host.locator('.correction').innerText(), 'went');
  assert.equal(await host.locator('.suggestion-position').innerText(), '1 / 2');
  assert.equal(await next.evaluate(node => node.getRootNode().activeElement === node), true);
  assert.equal(await field.inputValue(), sentence);
  assert.equal(await count(), baseline + 1, 'Navigating suggestions must reuse the existing results');
  report.checks.push('Previous/next arrows navigate existing suggestions with a position count, endpoint states, and keyboard focus');
  report.checks.push('Suggestion navigation leaves the draft unchanged and runs no additional inference; the card Aa button is removed');
  await site.screenshot({ path: 'artifacts/automatic-suggestion.png', fullPage: true });
  await host.getByRole('button', { name: 'Replace', exact: true }).click();
  assert.equal(await field.inputValue(), 'Yesterday I went to the shop and buy some milk.');
  await state('waiting');
  await state('suggestions');
  assert.equal(await count(), baseline + 2);
  assert.equal(await marks.count(), 1);
  await host.getByRole('button', { name: 'Review correction: buy → bought', exact: true }).click();
  assert.equal(await host.locator('.suggestion-position').innerText(), '1 / 1');
  assert.equal(await previous.isDisabled(), true);
  assert.equal(await next.isDisabled(), true);
  await host.getByRole('button', { name: 'Ignore', exact: true }).click();
  await marks.waitFor({ state: 'hidden' });
  assert.equal(await marks.count(), 0);
  assert.equal(await field.inputValue(), 'Yesterday I went to the shop and buy some milk.');
  await site.waitForTimeout(1500);
  assert.equal(await count(), baseline + 2);
  report.checks.push('Replacing one word rescans the whole updated sentence and offers the remaining correction');
  report.checks.push('Ignore dismisses a suggestion without editing text or creating a checking loop');

  // Unchanged sentences are reused; only the newly typed sentence is sent.
  const beforeAppend = await count();
  await field.press('End');
  await field.pressSequentially(' I received your message yesterday.', { delay: 3 });
  await state('checked');
  assert.equal(await count(), beforeAppend + 1);
  assert.equal(await marks.count(), 0, 'An ignored suggestion must stay ignored in an unchanged sentence');
  report.checks.push('Only changed sentences need inference; Ignore remains effective for unchanged sentences');

  await page.locator('#auto-check').uncheck();
  await state('paused');
  const paused = await count();
  await field.fill('He go to work every day.');
  await site.waitForTimeout(1600);
  assert.equal(await count(), paused);
  await site.reload();
  await field.focus();
  await state('paused');
  assert.equal(await count(), paused);
  report.checks.push('The automatic-checking toggle stops checks and persists across page reloads');
  await page.locator('#auto-check').check();
  await site.bringToFront();

  // Keep just the latest input while an older request is still running.
  const beforeStale = await count();
  await field.fill('I look forward to hear from you.');
  await state('checking');
  await page.waitForFunction(() => window.localEnglish.model.busy, undefined, { timeout: 30000 });
  await field.fill('He go to work every day.');
  await site.waitForTimeout(100);
  await field.fill('I received your message yesterday.');
  await state('checked');
  assert.equal(await field.inputValue(), 'I received your message yesterday.');
  assert.equal(await marks.count(), 0);
  assert.equal(await count(), beforeStale + 2, 'Only the running request and latest queued text should be checked');
  report.checks.push('New typing discards in-flight suggestions and replaces the pending check with the latest text');

  // A field left during inference must not retain a permanent busy icon.
  await field.fill('Can you please helps me?');
  await state('checking');
  await page.waitForFunction(() => window.localEnglish.model.busy);
  await site.locator('#sentence').focus();
  await page.waitForFunction(() => !window.localEnglish.model.busy, undefined, { timeout: 120000 });
  await field.focus();
  await state('idle');
  assert.equal(await status.getAttribute('aria-busy'), 'false');
  report.checks.push('Moving to another field during inference does not leave a stale busy indicator');

  const single = site.locator('#sentence');
  await single.fill('I very like this extension.');
  await state('suggestions');
  const singleBox = await single.boundingBox(), singleIcon = await status.boundingBox();
  assert.ok(singleIcon.y >= singleBox.y && singleIcon.y + singleIcon.height <= singleBox.y + singleBox.height + 1);
  await host.getByRole('button', { name: 'Review correction: very → really', exact: true }).click();
  await host.getByRole('button', { name: 'Replace', exact: true }).click();
  assert.equal(await single.inputValue(), 'I really like this extension.');
  await state('checked');
  report.checks.push('Automatic checking supports single-line inputs and fits the status icon within the field');

  const rich = site.locator('#rich');
  await rich.fill('He go to work every day.');
  await state('suggestions');
  await host.getByRole('button', { name: 'Review correction: go → goes', exact: true }).click();
  await host.getByRole('button', { name: 'Replace', exact: true }).click();
  assert.equal(await rich.innerText(), 'He goes to work every day.');
  await state('checked');
  report.checks.push('Automatic checking and replacement work in basic rich text, followed by a clean recheck');

  const beforeComposition = await count();
  await field.evaluate(node => {
    node.focus();
    node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, composed: true }));
    node.value = 'I look forward to hear from you.';
    node.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, isComposing: true, data: node.value }));
  });
  await site.waitForTimeout(1600);
  assert.equal(await count(), beforeComposition);
  await field.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, composed: true })));
  await state('suggestions');
  assert.equal(await count(), beforeComposition + 1);
  report.checks.push('IME composition waits until compositionend before scheduling a check');

  const beforeLong = await count();
  await field.fill('word '.repeat(400));
  await state('error');
  assert.match(await status.getAttribute('title'), /too long/);
  assert.equal(await count(), beforeLong);
  report.checks.push('Overlong automatic input shows a field error without sending it to the model');

  // Requests from separate callers use one shared model. Later automatic work
  // from the same caller supersedes queued work before it reaches inference.
  const beforeQueue = await count();
  const queued = await page.evaluate(() => Promise.all([
    chrome.runtime.sendMessage({ type: 'auto-correct', text: 'He go to work every day.' }),
    chrome.runtime.sendMessage({ type: 'auto-correct', text: 'I very like this extension.' }),
    chrome.runtime.sendMessage({ type: 'auto-correct', text: 'I received your message yesterday.' }),
  ]));
  assert.equal(queued[0].result.corrected, 'He goes to work every day.');
  assert.equal(queued[1].code, 'superseded');
  assert.equal(queued[2].result.corrected, 'I received your message yesterday.');
  assert.equal(await count(), beforeQueue + 2);
  assert.equal(await page.evaluate(() => window.localEnglish.model.info.instanceId), loaded.info.instanceId);
  report.checks.push('The shared queue supersedes obsolete automatic requests and reuses one model instance');

  await page.bringToFront();
  await page.locator('#original').fill('He go to work every day.');
  const workspaceHost = page.locator('local-english-selection');
  const workspaceState = expected => page.waitForFunction(expected => document.querySelector('local-english-selection')?.shadowRoot.querySelector('.auto-status')?.dataset.state === expected, expected, { timeout: 120000 });
  await workspaceState('checking');
  assert.equal(await page.locator('#original').isEnabled(), true);
  await workspaceState('suggestions');
  await workspaceHost.getByRole('button', { name: 'Review correction: go → goes', exact: true }).click();
  await workspaceHost.getByRole('button', { name: 'Replace', exact: true }).click();
  assert.equal(await page.locator('#original').inputValue(), 'He goes to work every day.');
  await workspaceState('checked');
  assert.equal(await page.evaluate(() => window.localEnglish.model.loadCount), 1);
  report.checks.push('The workspace Original box supports automatic checking, stays editable, and rescans replacements');

  // Navigation crosses sentence boundaries and reveals offscreen textarea spans.
  await site.bringToFront();
  const originalHeight = await field.evaluate(node => { const height = node.style.height; node.style.height = '72px'; return height; });
  const longDraft = `${sentence}\n${'The message is clear.\n'.repeat(12)}He go to work every day.`;
  await field.fill(longDraft);
  await state('suggestions');
  await field.evaluate(node => { node.scrollTop = 0; });
  const beforeNavigation = await count();
  await host.getByRole('button', { name: 'Review correction: go → went', exact: true }).click();
  assert.equal(await host.locator('.suggestion-position').innerText(), '1 / 3');
  await next.click();
  await next.click();
  assert.equal(await host.locator('.correction').innerText(), 'goes');
  assert.equal(await host.locator('.suggestion-position').innerText(), '3 / 3');
  assert.equal(await host.locator('.panel').isVisible(), true);
  assert.ok(await field.evaluate(node => node.scrollTop) > 0);
  await previous.click();
  assert.equal(await host.locator('.correction').innerText(), 'bought');
  assert.equal(await host.locator('.suggestion-position').innerText(), '2 / 3');
  assert.equal(await field.inputValue(), longDraft);
  assert.equal(await count(), beforeNavigation);
  await field.evaluate((node, height) => { node.style.height = height; }, originalHeight);
  report.checks.push('Suggestion navigation crosses sentences and scrolls offscreen textarea corrections into view without inference');

  // Keep the remainder of the persistence/manual checks independent.
  await page.locator('#auto-check').uncheck();
  await page.waitForFunction(async () => (await chrome.storage.local.get('autoCheck')).autoCheck === false);
}
