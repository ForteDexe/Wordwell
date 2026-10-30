// Self-contained so the same choices can be bundled into the content script.
export function createLanguageTools() {
  const defaultLanguage = 'en';
  const options = [
    { code: 'en', label: 'English', prompt: 'English', base: 'English' },
    { code: 'vi', label: 'Vietnamese', prompt: 'Vietnamese', base: 'Vietnamese' },
    { code: 'es', label: 'Spanish', prompt: 'Spanish', base: 'Spanish' },
    { code: 'fr', label: 'French', prompt: 'French', base: 'French' },
    { code: 'de', label: 'German', prompt: 'German', base: 'German' },
    { code: 'it', label: 'Italian', prompt: 'Italian', base: 'Italian' },
    { code: 'pt-BR', label: 'Portuguese (Brazil)', prompt: 'Brazilian Portuguese', base: 'Portuguese' },
    { code: 'zh-CN', label: 'Chinese (Simplified)', prompt: 'Simplified Chinese', base: 'Chinese' },
    { code: 'zh-TW', label: 'Chinese (Traditional)', prompt: 'Traditional Chinese', base: 'Chinese' },
    { code: 'ja', label: 'Japanese', prompt: 'Japanese', base: 'Japanese' },
    { code: 'ko', label: 'Korean', prompt: 'Korean', base: 'Korean' },
  ];
  const normalize = code => options.some(option => option.code === code) ? code : defaultLanguage;
  const normalizePrompt = value => typeof value === 'string' ? value.trim() : '';
  function instruction(code) {
    const language = options.find(option => option.code === normalize(code));
    const task = `Correct the ${language.prompt} grammar, spelling, and sentence structure with minimal edits. Preserve the original meaning. If the text is already correct, return it unchanged. Return only the corrected text, without explanations or quotation marks.`;
    // Preserve the established default prompt and its tested English behavior.
    return language.code === defaultLanguage ? task
      : `Never translate. If the input is not written in ${language.base}, return it exactly as it is. Otherwise, ${task[0].toLowerCase()}${task.slice(1)}`;
  }
  return { defaultLanguage, options, normalize, normalizePrompt, instruction };
}

export const languageTools = createLanguageTools();
