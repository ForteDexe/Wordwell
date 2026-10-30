// Self-contained for static bundling into the content script.
export function createWritingTools(diffText) {
  function passages(text) {
    const result = [];
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    let offset = 0;
    for (const line of text.split('\n')) {
      for (const { segment, index } of segmenter.segment(line)) {
        const trimmed = segment.trim();
        if (trimmed) result.push({ text: trimmed, start: offset + index + segment.indexOf(trimmed), end: offset + index + segment.indexOf(trimmed) + trimmed.length });
      }
      offset += line.length + 1;
    }
    return result;
  }
  function changedRange(before, after) {
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let oldEnd = before.length, end = after.length;
    while (oldEnd > start && end > start && before[oldEnd - 1] === after[end - 1]) oldEnd--, end--;
    return { start, end };
  }
  function edits(original, corrected) {
    const result = [];
    let offset = 0;
    for (const part of diffText(original, corrected)) {
      if (part.type === 'equal') { offset += part.text.length; continue; }
      const end = offset + (part.type === 'delete' ? part.text.length : 0);
      const replacement = part.type === 'insert' ? part.text : '';
      const previous = result.at(-1);
      if (previous && /^\s*$/.test(original.slice(previous.end, offset))) {
        previous.replacement += original.slice(previous.end, offset) + replacement;
        previous.end = end;
      } else result.push({ start: offset, end, replacement });
      offset = end;
    }
    // Auxiliary/negation changes often depend on a second verb change. Keep
    // the sentence's edits together instead of offering an invalid half-fix.
    const auxiliary = /\b(?:am|is|are|was|were|be|been|being|do|does|did|have|has|had|can|could|will|would|shall|should|may|might|must)\b|n['’]t/i;
    if (result.length > 1 && result.some(edit => auxiliary.test(original.slice(edit.start, edit.end)) || auxiliary.test(edit.replacement))) {
      const start = result[0].start, end = result.at(-1).end;
      let replacement = original.slice(start, end);
      for (const edit of result.toReversed()) replacement = replacement.slice(0, edit.start - start) + edit.replacement + replacement.slice(edit.end - start);
      result.splice(0, result.length, { start, end, replacement });
    }
    for (const edit of result) {
      // Give insertions a real text anchor, so they can be underlined and
      // replaced through the same native edit path as word corrections.
      if (edit.start === edit.end) {
        const next = original.slice(edit.end).match(/^\s*\S+/)?.[0];
        if (next) { edit.end += next.length; edit.replacement += next; }
        else {
          const previous = original.slice(0, edit.start).match(/\S+\s*$/)?.[0] || '';
          edit.start -= previous.length; edit.replacement = previous + edit.replacement;
        }
      }
      edit.original = original.slice(edit.start, edit.end);
    }
    // Anchored insertions can touch another edit. Merge overlapping spans so
    // every action remains a complete, unambiguous replacement.
    for (let i = result.length - 1; i > 0; i--) {
      if (result[i - 1].end > result[i].start) return [{ start: 0, end: original.length, original, replacement: corrected }];
    }
    return result.filter(edit => edit.original !== edit.replacement);
  }
  return { passages, changedRange, edits };
}
