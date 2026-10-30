import { LocalModel } from './model-engine.js';
import { savedModelInfo, savedModelFile, rememberModel, forgetModel } from './model-cache.js';
import { setModelState } from './model-state.js';
import { CONTEXT_SIZE, normalizeContextSize, CONTEXT_MARGIN, outputAllowance } from './token-budget.js';
import { TRANSLATION_DEFAULTS } from './settings.js';
import { languageTools } from './languages.js';

const $ = id => document.getElementById(id);
$('gpu-settings').addEventListener('click', async event => {
  event.preventDefault();
  const note = $('gpu-tip-status');
  note.hidden = true;
  try { await chrome.tabs.create({ url: event.currentTarget.href }); }
  catch {
    note.textContent = 'Could not open the setting. Paste chrome://flags/#force-high-performance-gpu into the address bar.';
    note.hidden = false;
  }
});
const status = message => { $('status').textContent = message; };
const model = new LocalModel(status);
for (const id of ['target-language', 'translation-language', 'page-translation-language']) {
  $(id).replaceChildren(...languageTools.options.map(language => {
    const option = document.createElement('option'); option.value = language.code; option.textContent = language.label; return option;
  }));
}
let result = null;
let pendingSelection = null;
let lastSelectionId = null;
let inlineBusy = false;
let selectedFile = null, remembered = null, fileOperation = false, initialized = false, workspaceTabId;
let contextSize = CONTEXT_SIZE, settingsSaving = false;
let { translationEnabled, translationLanguage, instantTranslation, pageTranslationEnabled, pageTranslationLanguage } = TRANSLATION_DEFAULTS;
let tokenKey = '', tokenPreview = null, tokenTimer = null, tokenRunning = false;
let promptDirty = false, promptEditorKey = null;
const promptKey = () => JSON.stringify([model.targetLanguage, model.customPrompt]);

function refreshPromptEditor() {
  const defaultPrompt = languageTools.instruction(model.targetLanguage), key = promptKey();
  $('custom-prompt').placeholder = defaultPrompt;
  if (!promptDirty && key !== promptEditorKey) {
    $('custom-prompt').value = model.customPrompt || defaultPrompt;
    promptEditorKey = key;
  }
  $('prompt-status').textContent = promptDirty ? 'Unsaved changes' : model.customPrompt ? 'Custom prompt active' : 'Using default prompt';
}

function refreshTokenCount() {
  const text = $('original').value.trim(), activeContext = model.info?.context ?? contextSize;
  const key = JSON.stringify([model.info?.instanceId, model.targetLanguage, model.customPrompt, text]);
  if (key !== tokenKey) { tokenKey = key; tokenPreview = null; clearTimeout(tokenTimer); tokenTimer = null; }
  const counter = $('token-count');
  if (!text) {
    counter.textContent = `0 / ${activeContext.toLocaleString()} prompt tokens`;
    counter.title = 'Enter text to count the complete prompt, including instructions and chat formatting.';
    return;
  }
  if (!model.ready) {
    counter.textContent = `— / ${activeContext.toLocaleString()} prompt tokens`;
    counter.title = 'Load a model to count tokens with its tokenizer.';
    return;
  }
  if (tokenPreview) {
    counter.textContent = `${tokenPreview.error ? '—' : tokenPreview.prompt_tokens.toLocaleString()} / ${activeContext.toLocaleString()} prompt tokens`;
    if (tokenPreview.error) counter.title = `Token count unavailable: ${tokenPreview.error}`;
    else {
      const output = outputAllowance(tokenPreview.text_tokens);
      const split = tokenPreview.prompt_tokens + output + CONTEXT_MARGIN > activeContext;
      counter.title = `${tokenPreview.text_tokens.toLocaleString()} text tokens plus instructions and chat formatting. Reserves ${output.toLocaleString()} output tokens and ${CONTEXT_MARGIN} safety tokens.${split ? ' This text needs splitting into smaller checks.' : ''}`;
    }
    return;
  }
  counter.textContent = `… / ${activeContext.toLocaleString()} prompt tokens`;
  counter.title = 'Counting with your loaded model. Counts wait while a check is running.';
  if (model.busy || fileOperation || tokenTimer || tokenRunning) return;
  tokenTimer = setTimeout(async () => {
    tokenTimer = null; tokenRunning = true;
    try {
      const count = await model.countTokens(text);
      if (key === tokenKey && count) tokenPreview = count;
    } catch (error) { if (key === tokenKey) tokenPreview = { error: error.message }; }
    finally { tokenRunning = false; refreshTokenCount(); }
  }, 300);
}

function showError(error) {
  $('error').textContent = error.message; $('error').hidden = false;
  setModelState('error', error.message, workspaceTabId).catch(console.error);
}
function clearError() { $('error').hidden = true; $('error').textContent = ''; }
function refresh() {
  const busy = model.busy || fileOperation || settingsSaving || !initialized;
  $('load').disabled = busy || Boolean(model.runtime) || !selectedFile;
  $('unload').disabled = busy || !model.runtime;
  $('model-file').disabled = busy || Boolean(model.runtime);
  $('forget').disabled = busy || !remembered;
  $('setup-privacy').hidden = model.ready || Boolean(remembered);
  $('correct').disabled = busy || !model.ready || !$('original').value.trim();
  $('original').disabled = busy && !inlineBusy;
  $('clear').disabled = busy;
  $('copy').disabled = busy || !result;
  $('use-selection').hidden = !pendingSelection;
  $('use-selection').disabled = busy;
  $('count').textContent = `${$('original').value.length.toLocaleString()} / 50,000 characters`;
  if (document.activeElement !== $('context-size')) $('context-size').value = String(contextSize);
  $('context-size').disabled = busy;
  $('target-language').value = model.targetLanguage;
  $('target-language').disabled = busy;
  $('translation-enabled').checked = translationEnabled;
  $('translation-enabled').disabled = busy;
  $('translation-language').value = translationLanguage;
  $('translation-language').disabled = busy || !translationEnabled;
  $('instant-translation').checked = instantTranslation;
  $('instant-translation').disabled = busy || !translationEnabled;
  $('page-translation-enabled').checked = pageTranslationEnabled;
  $('page-translation-enabled').disabled = busy;
  $('page-translation-language').value = pageTranslationLanguage;
  $('page-translation-language').disabled = busy || !pageTranslationEnabled;
  $('custom-prompt').disabled = busy;
  $('save-prompt').disabled = busy || !promptDirty;
  $('default-prompt').disabled = busy;
  refreshPromptEditor();
  const pendingContext = model.ready && model.info.context !== contextSize;
  $('apply-context').hidden = !pendingContext;
  $('apply-context').disabled = busy;
  $('context-help').textContent = pendingContext
    ? `Currently using ${model.info.context.toLocaleString()} tokens. Apply and reload the model to use ${contextSize.toLocaleString()}.`
    : 'Shared by instructions, your text, and the correction. Larger contexts use more memory. Values round up to blocks of 256 tokens.';
  $('context-badge').textContent = `Local model · ${(model.info?.context ?? contextSize).toLocaleString()} context tokens`;
  refreshTokenCount();
  $('model-state').textContent = busy ? 'Working…' : model.ready ? 'Ready' : 'Not loaded';
  $('model-state').classList.toggle('ready', model.ready && !busy);
  $('diagnostics').textContent = JSON.stringify({ ...model.info, loadCount: model.loadCount, contextRequested: contextSize, targetLanguage: model.targetLanguage, isolated: crossOriginIsolated }, null, 2);
}
function clearResult() { result = null; $('corrected').value = ''; $('result-meta').textContent = 'Review the suggestion before using it.'; }
function setLanguage(value) {
  const language = languageTools.normalize(value);
  if (model.targetLanguage !== language) { model.targetLanguage = language; clearResult(); }
}
function setPrompt(value) {
  const prompt = languageTools.normalizePrompt(value);
  if (model.customPrompt !== prompt) { model.customPrompt = prompt; clearResult(); }
}
function useSelection(selection) {
  if (!selection || selection.id === lastSelectionId) return;
  if (model.busy) { pendingSelection = selection; refresh(); return; }
  lastSelectionId = selection.id; pendingSelection = null;
  $('original').value = selection.text;
  clearResult(); clearError();
  status(model.ready ? 'Selected text is ready to check.' : 'Selected text received. Load a model to check it.');
  refresh();
  chrome.storage.session.remove('selection').catch(() => {});
}
async function setKeepLoaded(loaded) {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id !== undefined) await chrome.tabs.update(tab.id, { autoDiscardable: !loaded });
}

async function loadFile(file, { remember = true, automatic = false, reload = false } = {}) {
  fileOperation = true; clearError();
  selectedFile = file;
  $('model-file-name').textContent = `${file.name} · ${(file.size / 1e6).toFixed(0)} MB`;
  refresh();
  try {
    await setModelState('loading', '', workspaceTabId);
    if (reload) await model.unload();
    await model.load(file, { contextSize });
    await setKeepLoaded(true);
    if (remember) {
      status('Model loaded. Remembering a local copy…');
      await rememberModel(file);
      remembered = await savedModelInfo();
    }
    await setModelState('ready', '', workspaceTabId);
    status(`Loaded in ${model.info.loadSeconds.toFixed(1)} seconds`);
  } catch (error) {
    if (!model.ready) await setKeepLoaded(false).catch(() => {});
    showError(error);
    status(model.ready ? 'The model is loaded, but could not be remembered. See the error below.' : 'Model could not be loaded. Choose another file or try again.');
  } finally { fileOperation = false; refresh(); }
}

async function restoreRememberedModel() {
  try {
    workspaceTabId = (await chrome.tabs.getCurrent())?.id;
    const settings = await chrome.storage.local.get({ contextSize: CONTEXT_SIZE, targetLanguage: languageTools.defaultLanguage, customPrompt: '', ...TRANSLATION_DEFAULTS });
    contextSize = normalizeContextSize(settings.contextSize) ?? CONTEXT_SIZE;
    setLanguage(settings.targetLanguage);
    setPrompt(settings.customPrompt);
    translationEnabled = settings.translationEnabled === true;
    translationLanguage = languageTools.normalize(settings.translationLanguage);
    instantTranslation = settings.instantTranslation === true;
    pageTranslationEnabled = settings.pageTranslationEnabled === true;
    pageTranslationLanguage = languageTools.normalize(settings.pageTranslationLanguage);
    remembered = await savedModelInfo();
    if (remembered) {
      await setModelState('loading', '', workspaceTabId);
      status(`Autoloading ${remembered.name}…`); refresh();
      const file = await savedModelFile();
      if (!file) throw new Error('The saved model is missing. Choose your GGUF file again or use Forget model.');
      await loadFile(file, { remember: false, automatic: true });
    } else {
      await setModelState('unloaded', '', workspaceTabId);
    }
  } catch (error) { showError(error); status('Could not restore the saved model.'); }
  finally { initialized = true; refresh(); }
}

$('model-file').addEventListener('change', () => {
  const file = $('model-file').files[0];
  selectedFile = file || null;
  $('model-file-name').textContent = file ? `${file.name} · ${(file.size / 1e6).toFixed(0)} MB` : 'Select your Qwen model to begin.';
  clearError(); refresh();
});
$('load').addEventListener('click', async () => {
  if (selectedFile) await loadFile(selectedFile);
});
$('context-size').addEventListener('change', async () => {
  const previous = contextSize, next = normalizeContextSize(Number($('context-size').value));
  if (next === null) {
    $('context-size').value = String(contextSize);
    $('context-validation').textContent = 'Enter a whole number from 512 to 8,192 tokens.';
    $('context-validation').hidden = false;
    return;
  }
  $('context-validation').hidden = true;
  $('context-size').value = String(next);
  contextSize = next; settingsSaving = true; refresh();
  try { await chrome.storage.local.set({ contextSize }); }
  catch (error) { contextSize = previous; showError(error); }
  finally { settingsSaving = false; refresh(); }
});
$('context-size').addEventListener('input', () => { $('context-validation').hidden = true; });
$('target-language').addEventListener('change', async () => {
  const previous = model.targetLanguage;
  setLanguage($('target-language').value); settingsSaving = true; refresh();
  try { await chrome.storage.local.set({ targetLanguage: model.targetLanguage }); }
  catch (error) { setLanguage(previous); showError(error); }
  finally { settingsSaving = false; refresh(); }
});
async function saveTranslationSettings() {
  const previous = { translationEnabled, translationLanguage, instantTranslation };
  translationEnabled = $('translation-enabled').checked;
  translationLanguage = languageTools.normalize($('translation-language').value);
  instantTranslation = $('instant-translation').checked;
  settingsSaving = true; refresh();
  try { await chrome.storage.local.set({ translationEnabled, translationLanguage, instantTranslation }); }
  catch (error) { ({ translationEnabled, translationLanguage, instantTranslation } = previous); showError(error); }
  finally { settingsSaving = false; refresh(); }
}
$('translation-enabled').addEventListener('change', saveTranslationSettings);
$('translation-language').addEventListener('change', saveTranslationSettings);
$('instant-translation').addEventListener('change', saveTranslationSettings);
async function savePageTranslationSettings() {
  const previous = { pageTranslationEnabled, pageTranslationLanguage };
  pageTranslationEnabled = $('page-translation-enabled').checked;
  pageTranslationLanguage = languageTools.normalize($('page-translation-language').value);
  settingsSaving = true; refresh();
  try { await chrome.storage.local.set({ pageTranslationEnabled, pageTranslationLanguage }); }
  catch (error) { ({ pageTranslationEnabled, pageTranslationLanguage } = previous); showError(error); }
  finally { settingsSaving = false; refresh(); }
}
$('page-translation-enabled').addEventListener('change', savePageTranslationSettings);
$('page-translation-language').addEventListener('change', savePageTranslationSettings);
$('custom-prompt').addEventListener('input', () => { promptDirty = true; refresh(); });
$('default-prompt').addEventListener('click', () => {
  $('custom-prompt').value = languageTools.instruction(model.targetLanguage); promptDirty = true; refresh(); $('custom-prompt').focus();
});
$('save-prompt').addEventListener('click', async () => {
  const previous = model.customPrompt;
  let next = languageTools.normalizePrompt($('custom-prompt').value);
  if (next === languageTools.instruction(model.targetLanguage)) next = '';
  setPrompt(next); promptDirty = false; promptEditorKey = promptKey(); settingsSaving = true; refresh();
  try { await chrome.storage.local.set({ customPrompt: next }); }
  catch (error) { setPrompt(previous); promptDirty = true; showError(error); }
  finally { settingsSaving = false; refresh(); }
});
$('apply-context').addEventListener('click', async () => {
  if (selectedFile) await loadFile(selectedFile, { remember: false, reload: true });
});
$('unload').addEventListener('click', async () => {
  clearError();
  const unloading = model.unload(); refresh();
  try { await unloading; await setKeepLoaded(false); await setModelState('unloaded', '', workspaceTabId); }
  catch (error) { showError(error); }
  finally { refresh(); }
});
$('forget').addEventListener('click', async () => {
  fileOperation = true; clearError(); refresh();
  try {
    await forgetModel(); remembered = null;
    await setModelState(model.ready ? 'ready' : 'unloaded', '', workspaceTabId);
    status(model.ready ? 'Saved copy removed. The model stays loaded for this session.' : 'Saved model removed. Autoload is disabled.');
  } catch (error) { showError(error); }
  finally { fileOperation = false; refresh(); }
});
$('original').addEventListener('input', () => { clearResult(); clearError(); refresh(); });
$('correct').addEventListener('click', async () => {
  clearError(); clearResult(); status('Checking your text…');
  const checking = model.correct($('original').value); refresh();
  try {
    const correction = await checking;
    if (correction.language !== model.targetLanguage || correction.promptOverride !== model.customPrompt) { status('Correction settings changed. Check your text again.'); return; }
    result = correction;
    await setModelState('ready', '', workspaceTabId);
    $('corrected').value = result.corrected;
    const unchanged = result.original.trim() === result.corrected;
    $('result-meta').textContent = `${result.seconds.toFixed(1)} seconds · ${unchanged ? 'No changes suggested' : 'Suggestion ready'}`;
    status(unchanged ? 'No changes suggested. The model may still miss errors.' : 'Review the correction, then copy it when you are ready.');
  } catch (error) { showError(error); status('Could not finish this check. Try a shorter passage.'); }
  finally { refresh(); }
});
$('copy').addEventListener('click', async () => {
  if (!result) return;
  try { await navigator.clipboard.writeText(result.corrected); status('Correction copied. Paste it where you want to use it.'); }
  catch (error) { showError(error); }
});
$('clear').addEventListener('click', () => { $('original').value = ''; clearResult(); clearError(); status('Text cleared.'); refresh(); });
$('use-selection').addEventListener('click', () => useSelection(pendingSelection));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.editorDiagnostics) showEditorDiagnostics(changes.editorDiagnostics.newValue || []);
  if (area === 'local' && changes.autoCheck) $('auto-check').checked = changes.autoCheck.newValue !== false;
  if (area === 'local' && changes.targetLanguage) { setLanguage(changes.targetLanguage.newValue); refresh(); }
  if (area === 'local' && changes.customPrompt) { setPrompt(changes.customPrompt.newValue); refresh(); }
  if (area === 'local' && (changes.translationEnabled || changes.translationLanguage || changes.instantTranslation)) {
    if (changes.translationEnabled) translationEnabled = changes.translationEnabled.newValue === true;
    if (changes.translationLanguage) translationLanguage = languageTools.normalize(changes.translationLanguage.newValue ?? TRANSLATION_DEFAULTS.translationLanguage);
    if (changes.instantTranslation) instantTranslation = (changes.instantTranslation.newValue ?? TRANSLATION_DEFAULTS.instantTranslation) === true;
    refresh();
  }
  if (area === 'local' && (changes.pageTranslationEnabled || changes.pageTranslationLanguage)) {
    if (changes.pageTranslationEnabled) pageTranslationEnabled = changes.pageTranslationEnabled.newValue === true;
    if (changes.pageTranslationLanguage) pageTranslationLanguage = languageTools.normalize(changes.pageTranslationLanguage.newValue ?? TRANSLATION_DEFAULTS.pageTranslationLanguage);
    refresh();
  }
  if (area === 'local' && changes.contextSize) {
    const next = changes.contextSize.newValue;
    contextSize = normalizeContextSize(next) ?? CONTEXT_SIZE;
    refresh();
  }
  if (area === 'session' && changes.selection?.newValue) useSelection(changes.selection.newValue);
});
function showEditorDiagnostics(reports) {
  $('editor-diagnostics').textContent = reports.length ? JSON.stringify(reports, null, 2) : 'No reports captured.';
  $('copy-editor-diagnostics').disabled = !reports.length; $('clear-editor-diagnostics').disabled = !reports.length;
  if (reports.length) {
    $('editor-diagnostics-panel').open = true;
    $('editor-diagnostic-status').textContent = `${reports.length} report${reports.length === 1 ? '' : 's'} captured. No comment text included.`;
    requestAnimationFrame(() => $('editor-diagnostics-panel').scrollIntoView({ block: 'start' }));
  }
  else $('editor-diagnostic-status').textContent = '';
}
chrome.storage.session.get('editorDiagnostics').then(({ editorDiagnostics = [] }) => showEditorDiagnostics(editorDiagnostics)).catch(showError);
$('copy-editor-diagnostics').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('editor-diagnostics').textContent); $('editor-diagnostic-status').textContent = 'Diagnostics copied. You can paste them into this chat.'; }
  catch (error) { showError(error); }
});
$('clear-editor-diagnostics').addEventListener('click', () => chrome.storage.session.remove('editorDiagnostics').catch(showError));
chrome.storage.local.get({ autoCheck: true }).then(({ autoCheck }) => { $('auto-check').checked = autoCheck !== false; }).catch(showError);
$('auto-check').addEventListener('change', () => { chrome.storage.local.set({ autoCheck: $('auto-check').checked }).catch(showError); });
chrome.storage.session.get('selection').then(({ selection }) => { if (selection) useSelection(selection); }).catch(showError);

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab || message?.target !== 'model-workspace' || message.type !== 'correct-inline') return false;
  if (!initialized || fileOperation) { respond({ error: 'Your saved model is loading. Try again in a moment.', code: 'engine-loading' }); return false; }
  const translating = message.operation === 'translate';
  const enabled = message.pageSelection ? pageTranslationEnabled : translationEnabled;
  const language = message.pageSelection ? pageTranslationLanguage : translationLanguage;
  if (translating && !enabled) { respond({ error: 'Enable this translation option in Settings first.', code: 'translation-disabled' }); return false; }
  if (translating && languageTools.normalize(message.language) !== language) { respond({ error: 'Translation language changed. Please try again.', code: 'superseded' }); return false; }
  if (!model.ready) { respond({ error: 'Load your model in Wordwell first, then try the icon again.', code: 'model-not-loaded' }); return false; }
  if (model.busy) { respond({ error: 'The model is checking another passage. Please try again in a moment.', code: 'engine-busy' }); return false; }
  // The workspace is also an inline-test surface. Keep its text box editable
  // and focused during an inline request, just like a normal webpage field.
  inlineBusy = true;
  status(translating ? 'Translating selected text…' : 'Checking writing…');
  const checking = translating ? model.translate(message.text, language) : model.correct(message.text);
  refresh();
  (async () => {
    let response;
    try {
      const correction = await checking;
      await setModelState('ready', '', workspaceTabId);
      const currentEnabled = message.pageSelection ? pageTranslationEnabled : translationEnabled;
      const currentLanguage = message.pageSelection ? pageTranslationLanguage : translationLanguage;
      const settingsMatch = translating ? currentEnabled && correction.language === currentLanguage
        : correction.language === model.targetLanguage && correction.promptOverride === model.customPrompt;
      response = settingsMatch ? { result: correction }
        : { error: 'Correction settings changed. Please try again.', code: 'superseded' };
    }
    catch (error) { showError(error); response = { error: error.message, code: 'engine-error' }; }
    finally { inlineBusy = false; status('Model ready. You can check more text.'); refresh(); }
    respond(response);
  })();
  return true;
});

// First-party diagnostics used by the reproducible browser test.
window.localEnglish = { model, get initialized() { return initialized; }, snapshot: () => ({ info: model.info, loadCount: model.loadCount, checkCount: model.checkCount, ready: model.ready, busy: model.busy || fileOperation, initialized, remembered, result, logs: model.logs }) };
refresh();
restoreRememberedModel();
