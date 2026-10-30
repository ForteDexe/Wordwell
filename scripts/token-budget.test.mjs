import test from 'node:test';
import assert from 'node:assert/strict';
import { planCorrection, outputAllowance, CONTEXT_MARGIN } from '../extension/token-budget.js';

// Deliberately simple counts let these tests exercise exact boundary decisions.
// The browser test separately compares native counts with real inference usage.
const count = async text => ({ prompt_tokens: text.length + 8, text_tokens: text.length });
const chunks = plan => plan.filter(part => part.text !== undefined);
const original = plan => plan.map(part => part.literal ?? part.prefix + part.text + part.suffix).join('');

test('a fitting passage stays whole, including its original whitespace', async () => {
  const text = '  First line.\r\nSecond line.  ';
  const plan = await planCorrection(text, count, 256);
  assert.equal(chunks(plan).length, 1);
  assert.equal(original(plan), text);
});

test('an exact fit includes the output allowance and safety margin', async () => {
  const text = 'x'.repeat(40);
  const context = 48 + outputAllowance(40) + CONTEXT_MARGIN;
  const plan = await planCorrection(text, count, context);
  assert.equal(chunks(plan).length, 1);
  await assert.rejects(planCorrection(text, count, context - 1), /too long/);
});

test('a translation expansion allowance splits a passage that fits as a correction', async () => {
  const text = 'a'.repeat(70) + '\n' + 'b'.repeat(70);
  assert.equal(chunks(await planCorrection(text, count, 512)).length, 1);
  const plan = await planCorrection(text, count, 512, tokens => Math.max(256, tokens * 3 + 32));
  assert.equal(chunks(plan).length, 2);
  assert.ok(chunks(plan).every(part => part.maxTokens >= 256 && part.promptTokens + part.maxTokens + CONTEXT_MARGIN <= 512));
  assert.equal(original(plan), text);
});

test('newlines take priority over punctuation, preserving CRLF and blank lines', async () => {
  const line = 'A'.repeat(30) + '. ' + 'b'.repeat(30);
  const text = `  ${line}\r\n\r\n\t${line}\n`;
  const plan = await planCorrection(text, count, 256);
  assert.deepEqual(chunks(plan).map(part => part.text), [line, line]);
  assert.deepEqual(chunks(plan).map(part => part.level), [1, 1]);
  assert.equal(original(plan), text);
});

test('an oversized line splits at periods before commas', async () => {
  const clause = 'A'.repeat(28) + ', ' + 'b'.repeat(28) + '.';
  const text = clause + '  ' + clause;
  const plan = await planCorrection(text, count, 256);
  assert.deepEqual(chunks(plan).map(part => part.text), [clause, clause]);
  assert.deepEqual(chunks(plan).map(part => part.level), [2, 2]);
  assert.equal(original(plan), text);
});

test('an oversized sentence splits at commas as the last fallback', async () => {
  const clause = 'word '.repeat(11).trim();
  const text = `${clause},\t${clause},  ${clause}.`;
  const plan = await planCorrection(text, count, 256);
  assert.deepEqual(chunks(plan).map(part => part.text), [clause + ',', clause + ',', clause + '.']);
  assert.ok(chunks(plan).every(part => part.level === 3));
  assert.equal(original(plan), text);
});

test('full-width periods and commas split oversized unspaced text without losing punctuation', async () => {
  const text = '甲'.repeat(55) + '，' + '乙'.repeat(55) + '。';
  const plan = await planCorrection(text, count, 256);
  assert.equal(chunks(plan).length, 2);
  assert.ok(chunks(plan).every(part => part.level === 3));
  assert.equal(original(plan), text);
});

test('mixed depths keep their source order and every separator', async () => {
  const a = 'a'.repeat(55), b = 'b'.repeat(55);
  const text = `${a}. ${b}.\n\n${a}, ${b}.\r\nshort`;
  const plan = await planCorrection(text, count, 256);
  assert.deepEqual(chunks(plan).map(part => part.level), [2, 2, 3, 3, 1]);
  assert.equal(original(plan), text);
  assert.ok(chunks(plan).every(part => part.promptTokens + part.maxTokens + CONTEXT_MARGIN <= 256));
});

test('an indivisible oversized piece fails instead of truncating it', async () => {
  await assert.rejects(planCorrection('x'.repeat(500), count, 256), /newlines, periods, and commas/);
});

test('invalid native counts and excessive chunk counts fail safely', async () => {
  await assert.rejects(planCorrection('hello', async () => ({ prompt_tokens: NaN, text_tokens: 2 })), /valid token count/);
  await assert.rejects(planCorrection(Array(129).fill('x'.repeat(60)).join('\n'), count, 256), /too many checks/);
});

test('identical text is counted once during planning', async () => {
  let calls = 0;
  const text = Array(4).fill('x'.repeat(60)).join('\n');
  const plan = await planCorrection(text, async value => { calls++; return count(value); }, 256);
  assert.equal(chunks(plan).length, 4);
  assert.equal(calls, 2);
});
