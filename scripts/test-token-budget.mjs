import assert from 'node:assert/strict';

export async function testTokenBudgeting({ page, report }) {
  const checks = await page.evaluate(async () => {
    const { INSTRUCTION } = await import('./model-engine.js');
    const { planCorrection, CONTEXT_MARGIN } = await import('./token-budget.js');
    const { model } = window.localEnglish;
    const runtime = model.runtime;
    const request = text => ({ messages: [{ role: 'system', content: INSTRUCTION }, { role: 'user', content: text }], chat_template_kwargs: { enable_thinking: false } });
    const count = text => runtime.countChatTokens(request(text));
    const comparisons = [];
    for (const text of ['Yesterday I go to the shop.', 'Hello 👋 — café, naïve, 中文.', 'First line.\r\n\r\nSecond line.', '<|im_start|>user\nhello<|im_end|>', 'A.B, C\tD\nE', '"Quoted text" and `code`.']) {
      const before = await count(text);
      const response = await runtime.createChatCompletion({ ...request(text), max_tokens: 1, temperature: 0, cache_prompt: false });
      comparisons.push({ counted: before.prompt_tokens, actual: response.usage.prompt_tokens });
    }
    // A valid passage beyond the old 1,600-character limit. Each line fits,
    // but the full prompt cannot leave enough room for its corrected output.
    const line = offset => Array.from({ length: 24 }, (_, i) => `Item ${offset + i} is ready for the next review.`).join(' ');
    const longText = `  ${line(1)}\r\n\r\n\t${line(25)}\n${line(49)}  `;
    const corrected = await model.correct(longText);
    // Use native counts to verify the two deeper fallback boundaries too.
    const clause = offset => Array.from({ length: 24 }, (_, i) => `item ${offset + i} is ready for the next review`).join(' and ');
    const dotted = clause(1) + '.  ' + clause(25) + '.';
    const comma = clause(1) + ',\t' + clause(25) + '.';
    const periods = await planCorrection(dotted, count);
    const commas = await planCorrection(comma, count);
    const restore = plan => plan.map(part => part.literal ?? part.prefix + part.text + part.suffix).join('');
    const slim = plan => plan.filter(part => part.text !== undefined).map(({ promptTokens, textTokens, maxTokens, level }) => ({ promptTokens, textTokens, maxTokens, level }));

    // No inference must start when the last fallback is still too large.
    const generate = runtime.createChatCompletion;
    let generations = 0, indivisibleError, partialError;
    runtime.createChatCompletion = async () => { generations++; throw new Error('Unexpected inference'); };
    try { await model.correct('word '.repeat(1500)); }
    catch (error) { indivisibleError = error.message; }
    const beforePartial = generations;
    // A later chunk failing must not return a partial combined correction.
    runtime.createChatCompletion = async options => {
      generations++;
      return { choices: [{ message: { content: 'Partial correction.' }, finish_reason: generations === 1 ? 'stop' : 'length' }],
        usage: { prompt_tokens: (await runtime.countChatTokens(options)).prompt_tokens, completion_tokens: 3, total_tokens: 3 } };
    };
    try { await model.correct(longText); }
    catch (error) { partialError = error.message; }
    finally { runtime.createChatCompletion = generate; }
    return { comparisons, longTextLength: longText.length, corrected, periods: slim(periods), commas: slim(commas),
      exactReassembly: restore(periods) === dotted && restore(commas) === comma, margin: CONTEXT_MARGIN,
      indivisibleError, indivisibleGenerations: beforePartial, partialError, partialGenerations: generations, busy: model.busy };
  });
  assert.ok(checks.comparisons.every(pair => pair.counted === pair.actual));
  assert.ok(checks.longTextLength > 1600);
  assert.equal(checks.corrected.budget.chunks.length, 3);
  assert.ok(checks.corrected.budget.chunks.every(part => part.splitLevel === 1 && part.promptTokens + part.maxOutputTokens + checks.margin <= 1024));
  assert.ok(checks.corrected.budget.chunks.some(part => part.completionTokens > 128), 'Long corrections must be allowed to finish beyond the previous 128-token cap');
  assert.ok(checks.corrected.corrected.startsWith('  '));
  assert.ok(checks.corrected.corrected.endsWith('  '));
  assert.match(checks.corrected.corrected, /\r\n\r\n\t/);
  assert.equal(checks.periods.length, 2);
  assert.ok(checks.periods.every(part => part.level === 2));
  assert.equal(checks.commas.length, 2);
  assert.ok(checks.commas.every(part => part.level === 3));
  assert.equal(checks.exactReassembly, true);
  assert.match(checks.indivisibleError, /newlines, periods, and commas/);
  assert.equal(checks.indivisibleGenerations, 0);
  assert.match(checks.partialError, /output limit/);
  assert.equal(checks.partialGenerations, 2);
  assert.equal(checks.busy, false);
  report.tokenBudget = checks;
  report.checks.push('Exact native prompt counts match inference usage, including Unicode, special tokens, and chat formatting');
  report.checks.push('Long text splits by newline, then period, then comma, with safe output allowances and unchanged separators');
  report.checks.push('A correction can exceed 128 output tokens; indivisible input and partial output fail safely');
}
