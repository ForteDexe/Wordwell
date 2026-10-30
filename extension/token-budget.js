export const CONTEXT_SIZE = 1024;
export const MIN_CONTEXT_SIZE = 512;
export const MAX_CONTEXT_SIZE = 8192;
export const CONTEXT_STEP = 256;
export function normalizeContextSize(value) {
  return Number.isInteger(value) && value >= MIN_CONTEXT_SIZE && value <= MAX_CONTEXT_SIZE
    ? Math.ceil(value / CONTEXT_STEP) * CONTEXT_STEP : null;
}
export const CONTEXT_MARGIN = 16;
export const MAX_TEXT_LENGTH = 50000;
const MAX_CHUNKS = 128;

// A correction reproduces the input, so reserve its token count plus room for
// expansion. This is an output allowance, not a prediction of the final text.
export function outputAllowance(textTokens) {
  return Math.max(128, Math.ceil(textTokens * 1.25) + 16);
}

// Keep punctuation with its clause, and separators verbatim outside inference.
// A level is only used when its parent cannot fit: newline -> period -> comma.
function sections(text, level) {
  const pattern = [/\r\n|\r|\n/g, /[.。][ \t]*/g, /[,，、][ \t]*/g][level];
  const result = [];
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    const end = match.index + (level === 0 ? 0 : 1);
    result.push({ text: text.slice(start, end), separator: text.slice(end, match.index + match[0].length) });
    start = match.index + match[0].length;
  }
  result.push({ text: text.slice(start), separator: '' });
  return result;
}

export async function planCorrection(text, countTokens, context = CONTEXT_SIZE) {
  const plan = [];
  const counts = new Map();
  let chunks = 0;
  async function visit(value, level) {
    if (!value.trim()) { plan.push({ literal: value }); return; }
    const core = value.trim();
    const prefix = value.slice(0, value.length - value.trimStart().length);
    const suffix = value.slice(value.trimEnd().length);
    let count = counts.get(core);
    if (!count) {
      count = await countTokens(core);
      if (!Number.isInteger(count.prompt_tokens) || count.prompt_tokens < 1 || !Number.isInteger(count.text_tokens) || count.text_tokens < 0) {
        throw new Error('The model did not return a valid token count.');
      }
      counts.set(core, count);
    }
    const maxTokens = outputAllowance(count.text_tokens);
    if (count.prompt_tokens + maxTokens + CONTEXT_MARGIN <= context) {
      if (++chunks > MAX_CHUNKS) throw new Error('This passage needs too many checks. Select a shorter section.');
      plan.push({ text: core, prefix, suffix, promptTokens: count.prompt_tokens, textTokens: count.text_tokens, maxTokens, level });
      return;
    }
    if (level === 3) {
      throw new Error('This passage is too long for the model, even after splitting at newlines, periods, and commas. Select a shorter passage or add a sentence break.');
    }
    for (const part of sections(value, level)) {
      await visit(part.text, level + 1);
      if (part.separator) plan.push({ literal: part.separator });
    }
  }
  await visit(text, 0);
  return plan;
}
