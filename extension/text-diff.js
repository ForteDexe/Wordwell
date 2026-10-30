// Word and punctuation diff. Kept self-contained for static bundling into the
// classic content script; model output is always rendered as text, never HTML.
export function diffText(original, corrected) {
  const tokenize = text => text.match(/\s+|[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*|[^\s\p{L}\p{N}\p{M}]/gu) || [];
  const before = tokenize(original), after = tokenize(corrected);
  // Large, chunked checks can outgrow a quadratic LCS table. Retain common
  // edges and bound the remaining comparison; show a broad changed span when
  // its interior is still too large rather than freezing the page.
  if (before.length * after.length > 2_000_000) {
    let start = 0, tail = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    while (tail < before.length - start && tail < after.length - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
    const a = before.slice(start, before.length - tail), b = after.slice(start, after.length - tail);
    const middle = a.length * b.length <= 2_000_000 ? diffText(a.join(''), b.join(''))
      : [{ type: 'delete', text: a.join('') }, { type: 'insert', text: b.join('') }];
    return [{ type: 'equal', text: before.slice(0, start).join('') }, ...middle,
      { type: 'equal', text: tail ? before.slice(-tail).join('') : '' }].filter(part => part.text);
  }
  const rows = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1));
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      rows[i][j] = before[i] === after[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
    }
  }
  const parts = [];
  function append(type, text) {
    if (parts.at(-1)?.type === type) parts.at(-1).text += text;
    else parts.push({ type, text });
  }
  let i = 0, j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) append('equal', before[i++]), j++;
    else if (j < after.length && (i === before.length || rows[i][j + 1] > rows[i + 1][j])) append('insert', after[j++]);
    else append('delete', before[i++]);
  }
  return parts;
}
