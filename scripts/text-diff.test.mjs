import test from 'node:test';
import assert from 'node:assert/strict';
import { diffText } from '../extension/text-diff.js';
import { createWritingTools } from '../extension/writing-tools.js';
const writing = createWritingTools(diffText);

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
for (const [original, corrected] of [...examples, ["He don't likes it.", "He doesn't like it."], ['He go.', 'Well, he goes!']]) {
  test(`automatic edits reconstruct the correction: ${JSON.stringify(original)}`, () => {
    const edits = writing.edits(original, corrected);
    let result = original;
    for (const edit of edits.toReversed()) {
      assert.equal(original.slice(edit.start, edit.end), edit.original);
      result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
    }
    assert.equal(result, corrected);
  });
}
test('related negation and verb changes are one action', () => {
  assert.deepEqual(writing.edits("He don't likes it.", "He doesn't like it."), [{ start: 3, end: 14, original: "don't likes", replacement: "doesn't like" }]);
});
test('sentence offsets preserve exact Unicode text and paragraph boundaries', () => {
  const text = '  He go home.  I like cafés 😊!\n\nLast line.';
  const passages = writing.passages(text);
  assert.deepEqual(passages.map(passage => passage.text), ['He go home.', 'I like cafés 😊!', 'Last line.']);
  for (const passage of passages) assert.equal(text.slice(passage.start, passage.end), passage.text);
});
test('changed range identifies insertions and deletions in the latest text', () => {
  assert.deepEqual(writing.changedRange('One. He go home.', 'One. He goes home.'), { start: 10, end: 12 });
  assert.deepEqual(writing.changedRange('One. He go home.', 'One. He home.'), { start: 8, end: 8 });
});

test('large passages retain a small changed span without a full quadratic table', () => {
  const edge = 'Unchanged words on either side. '.repeat(700);
  const original = edge + 'He go home.' + edge;
  const corrected = edge + 'He goes home.' + edge;
  const parts = diffText(original, corrected);
  assert.deepEqual(parts.filter(part => part.type === 'delete').map(part => part.text), ['go']);
  assert.deepEqual(parts.filter(part => part.type === 'insert').map(part => part.text), ['goes']);
  assert.equal(parts.filter(part => part.type !== 'insert').map(part => part.text).join(''), original);
  assert.equal(parts.filter(part => part.type !== 'delete').map(part => part.text).join(''), corrected);
});

test('large rewrites use a bounded fallback that still reconstructs both inputs', () => {
  const original = 'alpha '.repeat(2500), corrected = 'beta '.repeat(2500);
  const parts = diffText(original, corrected);
  assert.equal(parts.filter(part => part.type !== 'insert').map(part => part.text).join(''), original);
  assert.equal(parts.filter(part => part.type !== 'delete').map(part => part.text).join(''), corrected);
  assert.ok(parts.length <= 4);
});
