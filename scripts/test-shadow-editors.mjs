import assert from 'node:assert/strict';

// Browser-native selection is essential here: creating a Range in page JS can
// prime Chrome's range cache and conceal the original shadow-selection bug.
export async function testShadowEditors({ page, site, report, loaded }) {
  await site.bringToFront();
  await site.evaluate(() => {
    const container = document.createElement('section'); container.id = 'shadow-fixture'; document.body.append(container);
    window.shadowFixture = { editors: {}, drafts: {}, inputEvents: {} };
    for (const mode of ['open', 'closed', 'nested', 'textarea']) {
      const host = document.createElement('shreddit-composer'); container.append(host);
      let root = host.attachShadow({ mode: mode === 'open' || mode === 'nested' ? 'open' : 'closed' });
      if (mode === 'nested') {
        const inner = document.createElement('reddit-richtext-editor'); root.append(inner); root = inner.attachShadow({ mode: 'closed' });
      }
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(':host { display:block; margin:20px 0; max-width:650px; } [contenteditable],textarea { display:block; box-sizing:border-box; min-height:88px; width:100%; border:1px solid #9aafa4; padding:12px; font:16px/1.5 system-ui; white-space:pre-wrap; }');
      root.adoptedStyleSheets = [sheet];
      const editor = document.createElement(mode === 'textarea' ? 'textarea' : 'div');
      if (mode === 'textarea') editor.value = 'He go to work every day.';
      else {
        editor.contentEditable = 'true'; editor.tabIndex = 0; editor.setAttribute('role', 'textbox');
        editor.setAttribute('data-lexical-editor', 'true');
        const paragraph = document.createElement('p'), span = document.createElement('span');
        span.setAttribute('data-lexical-text', 'true'); span.textContent = 'Yesterday I go to the shop and buy some milk.';
        paragraph.append(span); editor.append(paragraph);
      }
      root.append(editor); window.shadowFixture.editors[mode] = editor;
      window.shadowFixture.inputEvents[mode] = [];
      editor.addEventListener('input', event => {
        window.shadowFixture.drafts[mode] = 'value' in editor ? editor.value : editor.innerText;
        window.shadowFixture.inputEvents[mode].push({ trusted: event.isTrusted, inputType: event.inputType });
      });
      if (mode === 'textarea') {
        const password = document.createElement('input'); password.type = 'password'; password.value = 'keepthisprivate'; root.append(password);
        const readonly = document.createElement('textarea'); readonly.readOnly = true; readonly.value = 'Never check this read-only field.'; root.append(readonly);
        window.shadowFixture.editors.password = password; window.shadowFixture.editors.readonly = readonly;
      }
    }
  });
  const host = site.locator('local-english-selection');
  const trigger = host.getByRole('button', { name: 'Check selected text with Local English', exact: true });
  const value = mode => site.evaluate(mode => {
    const editor = window.shadowFixture.editors[mode]; return 'value' in editor ? editor.value : editor.innerText;
  }, mode);
  async function focus(mode) {
    await site.evaluate(mode => { const editor = window.shadowFixture.editors[mode]; editor.scrollIntoView({ block: 'center' }); editor.focus(); }, mode);
  }
  async function state(expected) {
    await site.waitForFunction(expected => document.querySelector('local-english-selection').dataset.state === expected, expected, { timeout: 120000 });
  }
  for (const mode of ['open', 'closed', 'nested', 'textarea']) {
    await focus(mode);
    await site.keyboard.press('Control+a');
    await trigger.waitFor({ state: 'visible' });
    const original = await value(mode);
    await trigger.click(); await state('result');
    const expected = mode === 'textarea' ? 'He goes to work every day.' : 'Yesterday I went to the shop and bought some milk.';
    assert.equal(await host.locator('.correction').innerText(), expected);
    await host.getByRole('button', { name: 'Replace', exact: true }).click();
    assert.equal(await value(mode), expected);
    assert.equal(await site.evaluate(mode => window.shadowFixture.drafts[mode], mode), expected, 'The editor input handler must receive the actual replacement');
    assert.equal(await site.evaluate(mode => window.shadowFixture.inputEvents[mode].at(-1).trusted, mode), true);
    await site.keyboard.press('Control+z');
    assert.equal(await value(mode), original);
    report.checks.push(`Native selection, correction, Replace, editor state, and Undo work in ${mode} shadow editors`);
  }
  for (const mode of ['password', 'readonly']) {
    await focus(mode); await site.keyboard.press('Control+a');
    await trigger.waitFor({ state: 'hidden' });
    await host.locator('.auto-status').waitFor({ state: 'hidden' });
  }
  report.checks.push('Password and read-only fields remain excluded inside closed components');

  await page.locator('#auto-check').check();
  await page.waitForFunction(async () => (await chrome.storage.local.get('autoCheck')).autoCheck === true);
  await site.bringToFront(); await focus('closed');
  await site.keyboard.press('Control+a'); await site.keyboard.insertText('I look forward to hear from you.');
  await site.waitForFunction(() => document.querySelector('local-english-selection').shadowRoot.querySelector('.auto-status').dataset.state === 'suggestions', undefined, { timeout: 120000 });
  await host.getByRole('button', { name: 'Review correction: hear → hearing', exact: true }).click();
  await site.screenshot({ path: 'artifacts/shadow-editor-suggestion.png', fullPage: true });
  await host.getByRole('button', { name: 'Replace', exact: true }).click();
  assert.equal(await value('closed'), 'I look forward to hearing from you.');
  await site.waitForFunction(() => document.querySelector('local-english-selection').shadowRoot.querySelector('.auto-status').dataset.state === 'checked', undefined, { timeout: 120000 });
  assert.equal(await page.evaluate(() => window.localEnglish.model.info.instanceId), loaded.info.instanceId);
  report.checks.push('Retargeted typing inside a closed component checks automatically and rescans a replacement');
  await page.locator('#auto-check').uncheck();
  await page.waitForFunction(async () => (await chrome.storage.local.get('autoCheck')).autoCheck === false);
  await site.evaluate(() => { document.getElementById('shadow-fixture').remove(); delete window.shadowFixture; });
}
