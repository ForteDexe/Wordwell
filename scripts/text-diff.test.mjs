import test from 'node:test';
import assert from 'node:assert/strict';
import { diffText } from '../extension/text-diff.js';

const examples = [
  ['Yesterday I go to the shop and buy some milk.', 'Yesterday I went to the shop and bought some milk.'],
  ['I like the the book.', 'I like the book.'],
  ['hello world', 'Hello, world!'],
  ['One\n\n two\tthree', 'One\n two three'],
  ['A café 😊 works.', 'The café 😊 works!'],
  ['I write <script>text</script> & more.', 'I wrote <script>text</script> & more.'],
  ['', 'New text.'], ['Old text.', ''], ['', ''], ['Unchanged.', 'Unchanged.'],
];
for (const [original, corrected] of examples) {
  test(`diff preserves both inputs: ${JSON.stringify(original)}`, () => {
    const parts = diffText(original, corrected);
    assert.equal(parts.filter(part => part.type !== 'insert').map(part => part.text).join(''), original);
    assert.equal(parts.filter(part => part.type !== 'delete').map(part => part.text).join(''), corrected);
    if (original === corrected) assert.ok(parts.every(part => part.type === 'equal'));
  });
}
test('highlights changed words while keeping the shared sentence unmarked', () => {
  const parts = diffText(...examples[0]);
  assert.deepEqual(parts.filter(part => part.type === 'insert').map(part => part.text), ['went', 'bought']);
  assert.deepEqual(parts.filter(part => part.type === 'delete').map(part => part.text), ['go', 'buy']);
});
test('deletion-only changes remain visible', () => {
  const parts = diffText(...examples[1]);
  assert.equal(parts.filter(part => part.type === 'delete').map(part => part.text).join('').trim(), 'the');
  assert.equal(parts.some(part => part.type === 'insert'), false);
});
