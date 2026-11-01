// Loader support bounds, not a way to extend a model's learned context capacity.
const MIN_EDIT_CONTEXT = 64, MAX_EDIT_CONTEXT = 8192, EDIT_EXPANSION_RESERVE = 32;
export function editTokenBudget(context) {
  if (!Number.isInteger(context) || context < MIN_EDIT_CONTEXT || context > MAX_EDIT_CONTEXT) {
    throw new Error(`Invalid edit-model context limit. Bundles must declare ${MIN_EDIT_CONTEXT.toLocaleString()}–${MAX_EDIT_CONTEXT.toLocaleString()} input tokens.`);
  }
  return { context, inputLimit: context - EDIT_EXPANSION_RESERVE, safetyMargin: EDIT_EXPANSION_RESERVE };
}

// Data-only bundle format. No model-supplied JavaScript is executed.
export async function openEditBundle(file) {
  if (!file || file.size < 12 || file.size > 1024 ** 3) throw new Error('Choose a Wordwell edit-model bundle under 1 GB (.wwedit).');
  const first = await file.slice(0, 12).arrayBuffer();
  if (new TextDecoder().decode(first.slice(0, 8)) !== 'WWEDIT01') throw new Error('This is not a Wordwell edit-model bundle (.wwedit).');
  const length = new DataView(first).getUint32(8, true);
  if (!length || length > 1024 * 1024 || 12 + length > file.size) throw new Error('Invalid edit-model bundle header.');
  const header = JSON.parse(await file.slice(12, 12 + length).text());
  if (header.format !== 'wordwell-edit' || header.version !== 1) throw new Error('Unsupported edit-model bundle version.');
  const required = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'verbs.json', 'model.onnx'];
  const spans = [];
  for (const name of required) {
    const entry = header.entries?.[name];
    if (!entry || !Number.isSafeInteger(entry.offset) || entry.offset < 0 || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1
      || 12 + length + entry.offset + entry.bytes > file.size || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || (name !== 'model.onnx' && entry.bytes > 20 * 1024 * 1024)) throw new Error(`Invalid bundle entry: ${name}`);
    spans.push([entry.offset, entry.offset + entry.bytes]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  if (spans.some((span, i) => i && span[0] < spans[i - 1][1])) throw new Error('Overlapping edit-model assets.');
  async function bytes(name) {
    const entry = header.entries[name];
    const value = new Uint8Array(await file.slice(12 + length + entry.offset, 12 + length + entry.offset + entry.bytes).arrayBuffer());
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(v => v.toString(16).padStart(2, '0')).join('');
    if (hash !== entry.sha256) throw new Error(`The bundle's ${name} is damaged. Export or select the file again.`);
    return value;
  }
  async function json(name) { return JSON.parse(new TextDecoder().decode(await bytes(name))); }
  const config = await json('config.json');
  const budget = editTokenBudget(config.context);
  if (!['roberta', 'bert'].includes(config.architecture) || config.language !== 'en'
    || !Array.isArray(config.labels) || config.labels.length < 2 || config.labels.length > 20000
    || config.labels.some(v => typeof v !== 'string' || v.length > 256) || config.labels[config.keepId] !== '$KEEP'
    || !Number.isFinite(config.threshold) || config.threshold < 0 || config.threshold > 1
    || !Number.isInteger(config.bos) || !Number.isInteger(config.eos)) throw new Error('Unsupported edit-model configuration.');
  return { config, budget, bytes, json };
}

export function encodeEditWords(words, tokenizer, config) {
  const ids = [config.bos], positions = [];
  for (const word of ['$START', ...words]) {
    const encoded = tokenizer.encode(word, { add_special_tokens: false }).ids;
    if (!encoded.length) throw new Error('The edit tokenizer could not encode part of this text.');
    positions.push(ids.length); ids.push(...encoded);
  }
  ids.push(config.eos);
  return { ids, positions };
}

export function selectEditTags(positions, labels, confidence, errors, config) {
  // START is an editable position: it can append a missing first word. BOS/EOS
  // and continuation subwords are already excluded by the word alignment.
  let maxError = 0;
  for (const i of positions) {
    const label = Number(labels[i]), score = Number(confidence[i]), error = Number(errors[i]);
    if (!Number.isInteger(i) || i < 0 || !Number.isInteger(label) || label < 0 || label >= config.labels.length
      || !Number.isFinite(score) || !Number.isFinite(error)) throw new Error('The edit model returned invalid predictions.');
    maxError = Math.max(maxError, error);
  }
  return positions.map(i => maxError < config.threshold || Number(confidence[i]) < config.threshold ? '$KEEP' : config.labels[Number(labels[i])]);
}

function capitalize(word) { return word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase(); }
export function applyEditTags(words, tags, verbs) {
  const edited = [];
  let joiner = null;
  function emit(value) {
    for (const word of value.split(/\s+/).filter(Boolean)) {
      if (joiner !== null && edited.length) { edited[edited.length - 1] += joiner + word; joiner = null; }
      else edited.push(word);
    }
  }
  for (let i = 0; i < words.length; i++) {
    const word = words[i], tag = tags[i] || '$KEEP';
    if (tag.startsWith('$APPEND_')) { emit(word); emit(tag.slice(8)); }
    else if (word === '$START' || ['$KEEP', '<PAD>', '<OOV>'].includes(tag)) emit(word);
    else if (tag === '$DELETE') continue;
    else if (tag.startsWith('$REPLACE_')) emit(tag.slice(9));
    else if (tag === '$TRANSFORM_CASE_LOWER') emit(word.toLowerCase());
    else if (tag === '$TRANSFORM_CASE_UPPER') emit(word.toUpperCase());
    else if (tag === '$TRANSFORM_CASE_CAPITAL') emit(capitalize(word));
    else if (tag === '$TRANSFORM_CASE_CAPITAL_1') emit(word.slice(0, 1) + capitalize(word.slice(1)));
    else if (tag === '$TRANSFORM_AGREEMENT_PLURAL') emit(word + 's');
    else if (tag === '$TRANSFORM_AGREEMENT_SINGULAR') emit(word.slice(0, -1));
    else if (tag === '$TRANSFORM_SPLIT_HYPHEN') emit(word.split('-').join(' '));
    else if (tag.startsWith('$TRANSFORM_VERB_')) emit(verbs[`${word}_${tag.slice(16)}`] ?? word);
    else if (tag === '$MERGE_SPACE' || tag === '$MERGE_HYPHEN') { emit(word); joiner = tag === '$MERGE_HYPHEN' ? '-' : ''; }
    else emit(word);
  }
  return edited;
}

export function renderEditWords(original, oldWords, newWords) {
  if (oldWords.length === newWords.length && oldWords.every((v, i) => v === newWords[i])) return original;
  // Preserve the original layout outside the changed word range.
  const spans = [...original.matchAll(/\S+/gu)];
  let left = 0, right = 0;
  while (left < oldWords.length && left < newWords.length && oldWords[left] === newWords[left]) left++;
  while (right < oldWords.length - left && right < newWords.length - left && oldWords.at(-1 - right) === newWords.at(-1 - right)) right++;
  const start = spans[left]?.index ?? original.length;
  const last = spans[oldWords.length - right - 1];
  const end = oldWords.length - right === left ? start : last ? last.index + last[0].length : start;
  let replacement = newWords.slice(left, newWords.length - right).join(' ')
    .replace(/``\s?/g, '"').replace(/\s?''/g, '"')
    .replace(/\s+([,.;:!?%\)\]\}])/g, '$1').replace(/([\(\[\{])\s+/g, '$1')
    .replace(/\s+(n't|'(?:s|m|d|ll|re|ve))\b/gi, '$1');
  let before = original.slice(0, start), after = original.slice(end);
  const attachesLeft = /^[,.;:!?%\)\]\}]|^(?:n't|'(?:s|m|d|ll|re|ve))\b/i.test(replacement);
  if (attachesLeft) before = before.replace(/[ \t]+$/, '');
  if (start === end && replacement) {
    if (before && !/\s$/.test(before) && !attachesLeft) replacement = ' ' + replacement;
    if (after && !/^\s/.test(after) && !/[\(\[\{]$/.test(replacement)) replacement += ' ';
  }
  if (!replacement) {
    if (!before) after = after.replace(/^[ \t]+/, '');
    else if (!after) before = before.replace(/[ \t]+$/, '');
    else if (/[ \t]$/.test(before) && /^[ \t]/.test(after)) after = after.replace(/^[ \t]+/, '');
  }
  return before + replacement + after;
}
