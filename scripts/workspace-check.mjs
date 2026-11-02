import assert from 'node:assert/strict';

// Exercise the workspace through the same selection bulb used on websites.
// Capture the model response only inside the disposable test page, not product UI.
export async function checkWorkspace(page) {
  await page.bringToFront();
  const close = page.locator('local-english-selection').getByRole('button', { name: 'Close suggestion', exact: true });
  if (await close.isVisible()) await close.click();
  await page.evaluate(() => {
    const model = window.localEnglish.model, correct = model.correct;
    window.workspaceCheck = { result: null, error: null };
    model.correct = async function(...args) {
      try { return window.workspaceCheck.result = await correct.apply(this, args); }
      catch (error) { window.workspaceCheck.error = error.message; throw error; }
    };
    window.restoreWorkspaceCheck = () => { model.correct = correct; };
  });
  try {
    await page.locator('#original').evaluate(field => {
      field.focus(); field.setSelectionRange(0, field.value.length);
      field.dispatchEvent(new Event('select', { bubbles: true }));
    });
    const host = page.locator('local-english-selection');
    await host.getByRole('button', { name: 'Refine selected text', exact: true }).click();
    await page.waitForFunction(() => ['result', 'error'].includes(document.querySelector('local-english-selection')?.dataset.state), undefined, { timeout: 120000 });
    const capture = await page.evaluate(() => window.workspaceCheck);
    if (await host.getAttribute('data-state') === 'result') assert.ok(capture.result);
    return capture;
  } finally {
    await page.evaluate(() => { window.restoreWorkspaceCheck?.(); delete window.restoreWorkspaceCheck; });
  }
}
