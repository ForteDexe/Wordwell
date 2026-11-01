// Conservative word suggestions. Grammar and valid-word errors remain the model's job.
function distance(a, b) {
  let older = Array(b.length + 1).fill(0), previous = Array.from({ length: b.length + 1 }, (_, i) => i), row = older.slice();
  for (let i = 1; i <= a.length; i++) {
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] !== b[j - 1]));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], older[j - 2] + .75);
    }
    [older, previous, row] = [previous, row, older];
  }
  return previous[b.length];
}
function score(word, candidate, edits) {
  let prefix = 0, suffix = 0;
  while (prefix < Math.min(word.length, candidate.length) && word[prefix] === candidate[prefix]) prefix++;
  while (suffix < Math.min(word.length, candidate.length) - prefix && word.at(-1 - suffix) === candidate.at(-1 - suffix)) suffix++;
  return edits * 10 + Math.max(word.length, candidate.length) - prefix - suffix + Math.abs(word.length - candidate.length);
}

export function createSpellingChecker(dictionary) {
  const cache = new Map();
  let buckets;
  function fallback(word) {
    if (!buckets) {
      // nspell 2.1.5's expanded word table; the build pins this runtime version.
      if (!dictionary.data || typeof dictionary.data !== 'object') throw new Error('Unsupported spelling dictionary runtime.');
      buckets = new Map();
      for (const value of Object.keys(dictionary.data)) {
        if (!/^[a-z]{3,32}$/.test(value)) continue;
        const key = value[0] + value.length;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(value);
      }
    }
    return Array.from({ length: 7 }, (_, i) => buckets.get(word[0] + (word.length - 3 + i)) || []).flat();
  }
  function suggest(word) {
    if (cache.has(word)) return cache.get(word);
    const limit = word.length >= 10 ? 3 : word.length >= 6 ? 2 : 1;
    function rank(values) {
      return [...new Set(values)].filter(v => /^[a-z]+(?:'[a-z]+)*$/.test(v) && Math.abs(v.length - word.length) <= limit)
        .map(value => ({ value, edits: distance(word, value) }))
        .filter(v => v.edits <= limit && dictionary.correct(v.value))
        .map(v => ({ ...v, score: score(word, v.value, v.edits) })).sort((a, b) => a.score - b.score);
    }
    let candidates = rank(dictionary.suggest(word));
    if (!candidates.length && word.length >= 10) candidates = rank(fallback(word));
    // Leave ambiguous choices unchanged instead of forcing a replacement.
    const best = candidates[0], next = candidates[1];
    const selected = best && (!next || next.score - best.score >= 1) ? best.value : null;
    cache.set(word, selected);
    if (cache.size > 512) cache.delete(cache.keys().next().value);
    return selected;
  }
  return {
    correct(text) {
      const protectedRanges = [...text.matchAll(/(?:https?:\/\/|www\.)\S+|\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|`+[\s\S]*?(?:`+|$)|[A-Za-z]:\\\S+/g)].map(m => [m.index, m.index + m[0].length]);
      const edits = [], searched = new Set();
      for (const match of text.matchAll(/\p{L}+(?:['’]\p{L}+)*/gu)) {
        const raw = match[0], start = match.index, end = start + raw.length;
        if (raw.length < 3 || raw.length > 32 || !/^[A-Za-z]+(?:['’][A-Za-z]+)*$/.test(raw)
          || /[\p{L}\p{N}_@/\\-]/u.test(text[start - 1] || '') || /[\p{L}\p{N}_@/\\-]/u.test(text[end] || '')
          || protectedRanges.some(([a, b]) => start < b && end > a)) continue;
        const word = raw.replaceAll('’', "'");
        if (dictionary.correct(word)) continue;
        const initial = start === 0 || /^[\s]*$/.test(text.slice(0, start)) || /[.!?\n]\s*$/.test(text.slice(Math.max(0, start - 32), start));
        if (!/^[a-z]+(?:'[a-z]+)*$/.test(word) && !(initial && word.length >= 10 && /^[A-Z][a-z]+$/.test(word))) continue;
        const lower = word.toLowerCase();
        // Count unique words even when cached: token previews and inference
        // must choose the same bounded work, independent of previous requests.
        if (!searched.has(lower) && searched.size >= 24) continue;
        searched.add(lower);
        const candidate = suggest(lower);
        if (!candidate || candidate === lower) continue;
        const replacement = /^[A-Z]/.test(word) ? candidate[0].toUpperCase() + candidate.slice(1) : candidate;
        edits.push({ start, end, original: raw, replacement });
      }
      let corrected = text;
      for (const edit of [...edits].reverse()) corrected = corrected.slice(0, edit.start) + edit.replacement + corrected.slice(edit.end);
      return { corrected, edits };
    },
  };
}
