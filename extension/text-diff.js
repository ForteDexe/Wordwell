// Word and punctuation diff. Kept self-contained for static bundling into the
// classic content script; model output is always rendered as text, never HTML.
export function diffText(original, corrected) {
  const tokenize = text => text.match(/\s+|[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*|[^\s\p{L}\p{N}\p{M}]/gu) || [];
  const before = tokenize(original), after = tokenize(corrected);
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
