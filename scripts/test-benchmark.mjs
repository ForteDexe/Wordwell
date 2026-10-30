import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function testBenchmark({ page, report }) {
  await page.bringToFront();
  assert.equal(await page.locator('#benchmark-panel').getAttribute('open'), null);
  await page.locator('#auto-check').uncheck();
  await page.locator('#original').fill('He go to work every day.'); await page.locator('#correct').click();
  await page.waitForFunction(() => !window.localEnglish.model.busy);
  const before = await page.evaluate(() => window.localEnglish.snapshot());
  assert.equal(await page.locator('#corrected').inputValue(), 'He goes to work every day.');
  const original = await page.locator('#original').inputValue(), corrected = await page.locator('#corrected').inputValue();
  await page.locator('#benchmark-panel > summary').click();
  await page.locator('#benchmark-run').click();
  await page.waitForFunction(() => window.localEnglish.benchmark.running);
  await page.waitForFunction(() => !window.localEnglish.benchmark.running, undefined, { timeout: 180000 });
  const full = await page.evaluate(() => window.localEnglish.benchmark.report);
  assert.equal(full.completed, true); assert.equal(full.results.length, 16); assert.equal(full.summary.errors, 0);
  assert.equal(full.summary.exampleMatches, full.results.filter(row => row.output.trim() === row.reference.trim()).length);
  assert.equal(full.summary.controlsPreserved, 2); assert.ok(full.summary.medianSeconds > 0);
  assert.equal(full.model.instanceId, before.info.instanceId);
  assert.equal(await page.evaluate(() => window.localEnglish.model.loadCount), before.loadCount);
  assert.equal(await page.locator('#original').inputValue(), original); assert.equal(await page.locator('#corrected').inputValue(), corrected);
  assert.deepEqual(await page.evaluate(() => window.localEnglish.snapshot().result), before.result);
  assert.equal(await page.locator('#benchmark-results tr').count(), 16);
  await page.locator('#benchmark-panel').evaluate(node => node.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'artifacts/benchmark.png' });
  report.checks.push('The collapsed benchmark runs all 16 cases on the existing engine, preserves writing/results, and reports timings and example matches without grading accuracy');

  const saved = await page.evaluate(() => chrome.storage.local.get(['targetLanguage', 'customPrompt']));
  const custom = 'Return exactly: CUSTOM PROMPT SHOULD NOT RUN';
  await page.evaluate(custom => chrome.storage.local.set({ targetLanguage: 'fr', customPrompt: custom }), custom);
  await page.waitForFunction(custom => window.localEnglish.model.targetLanguage === 'fr' && window.localEnglish.model.customPrompt === custom, custom);
  async function gate(failFirst = false) {
    await page.evaluate(failFirst => {
      const runtime = window.localEnglish.model.runtime, generate = runtime.createChatCompletion;
      let release, calls = 0; const wait = new Promise(resolve => { release = resolve; });
      window.benchmarkGate = { release, waiting: false, restore: () => { runtime.createChatCompletion = generate; } };
      runtime.createChatCompletion = async function(options) {
        calls++;
        if (failFirst && calls === 1) throw new Error('Simulated benchmark generation failure');
        window.benchmarkGate.waiting = true; await wait; return generate.call(this, options);
      };
    }, failFirst);
  }
  async function releaseGate() { await page.evaluate(() => window.benchmarkGate.release()); }
  async function restoreGate() { await page.evaluate(() => { window.benchmarkGate.release(); window.benchmarkGate.restore(); delete window.benchmarkGate; }); }
  try {
    await gate();
    try {
      await page.locator('#benchmark-run').click(); await page.waitForFunction(() => window.benchmarkGate.waiting);
      for (const id of ['correct', 'unload', 'context-size', 'target-language', 'model-file', 'benchmark-run']) assert.equal(await page.locator(`#${id}`).isDisabled(), true);
      const busy = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'inline-correct', text: 'They is late.' }));
      assert.equal(busy.code, 'engine-busy'); assert.match(busy.error, /benchmark/);
      await page.locator('#benchmark-stop').click(); assert.equal(await page.locator('#benchmark-stop').isDisabled(), true);
      await releaseGate(); await page.waitForFunction(() => !window.localEnglish.benchmark.running, undefined, { timeout: 120000 });
      const partial = await page.evaluate(() => window.localEnglish.benchmark.report);
      assert.equal(partial.stopped, true); assert.equal(partial.completed, false); assert.equal(partial.results.length, 1);
      assert.equal(partial.results[0].output, 'I received your message yesterday.');
      assert.equal(partial.language, 'en'); assert.match(partial.prompt, /^Correct the English grammar/);
      assert.equal(await page.evaluate(() => window.localEnglish.model.targetLanguage), 'fr');
      assert.equal(await page.evaluate(() => window.localEnglish.model.customPrompt), custom);
      assert.equal(await page.locator('#original').inputValue(), original);
      assert.equal(await page.locator('#unload').isEnabled(), true);
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#benchmark-download').click()]);
      const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
      assert.equal(exported.results.length, 1); assert.equal(exported.stopped, true); assert.equal(exported.model.instanceId, before.info.instanceId);
      report.checks.push('Benchmark locking rejects website checks and conflicting controls; Stop finishes only the current sentence and restores controls');
      report.checks.push('A fixed default English benchmark ignores saved French/custom prompts without changing them, and partial JSON results download locally');
    } finally { await restoreGate(); }
    await gate(true);
    try {
      await page.locator('#benchmark-run').click(); await page.waitForFunction(() => window.benchmarkGate.waiting);
      await page.locator('#benchmark-stop').click(); await releaseGate();
      await page.waitForFunction(() => !window.localEnglish.benchmark.running, undefined, { timeout: 120000 });
      const failed = await page.evaluate(() => window.localEnglish.benchmark.report);
      assert.equal(failed.results.length, 2); assert.equal(failed.summary.errors, 1);
      assert.match(failed.results[0].error, /Simulated benchmark/); assert.ok(failed.results[1].output);
      assert.equal(await page.locator('#benchmark-run').isEnabled(), true);
      assert.equal(await page.locator('#benchmark-results .benchmark-error').count(), 1);
      report.checks.push('A failed benchmark case is reported, later cases can still run, and stopping after an error releases the engine');
    } finally { await restoreGate(); }
  } finally {
    await page.evaluate(values => chrome.storage.local.set(values), saved);
    await page.waitForFunction(values => window.localEnglish.model.targetLanguage === (values.targetLanguage || 'en') && window.localEnglish.model.customPrompt === (values.customPrompt || ''), saved);
    await page.locator('#benchmark-panel > summary').click();
  }
}
