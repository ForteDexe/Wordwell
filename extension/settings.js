// Shared by the workspace and bundled website selection tools.
export const TRANSLATION_DEFAULTS = Object.freeze({
  translationEnabled: false,
  translationLanguage: 'zh-CN',
  instantTranslation: true,
  pageTranslationEnabled: false,
  pageTranslationLanguage: 'vi',
});

export const ENGINE_DEFAULTS = Object.freeze({
  engineMode: 'browser',
  serverUrl: 'http://127.0.0.1:8033',
});

export function normalizeEngineMode(value) {
  return value === 'server' ? 'server' : 'browser';
}

export function normalizeServerUrl(value) {
  let text = String(value ?? '').trim();
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
  let url;
  try { url = new URL(text); }
  catch { throw new Error('Enter a valid llama.cpp server URL, such as http://127.0.0.1:8033.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port
    || url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new Error('Use a local HTTP address with a port, such as http://127.0.0.1:8033.');
  }
  return `${url.protocol}//${url.host}`;
}
