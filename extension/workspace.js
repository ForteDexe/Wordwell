import { LocalModel } from './model-engine.js';
import { savedModelInfo, savedModelFile, rememberModel, forgetModel } from './model-cache.js';
import { setModelState } from './model-state.js';

const $ = id => document.getElementById(id);
const status = message => { $('status').textContent = message; };
const model = new LocalModel(status);
let result = null;
let pendingSelection = null;
let lastSelectionId = null;
let inlineBusy = false;
let selectedFile = null, remembered = null, fileOperation = false, initialized = false, workspaceTabId;

function showError(error) {
  $('error').textContent = error.message; $('error').hidden = false;
  setModelState('error', error.message, workspaceTabId).catch(console.error);
}
function clearError() { $('error').hidden = true; $('error').textContent = ''; }
function refresh() {
  const busy = model.busy || fileOperation || !initialized;
  $('load').disabled = busy || Boolean(model.runtime) || !selectedFile;
  $('unload').disabled = busy || !model.runtime;
  $('model-file').disabled = busy || Boolean(model.runtime);
  $('forget').disabled = busy || !remembered;
  $('correct').disabled = busy || !model.ready || !$('original').value.trim();
  $('original').disabled = busy && !inlineBusy;
  $('clear').disabled = busy;
  $('copy').disabled = busy || !result;
  $('use-selection').hidden = !pendingSelection;
  $('use-selection').disabled = busy;
  $('count').textContent = `${$('original').value.length.toLocaleString()} / 1,600 characters`;
  $('model-state').textContent = busy ? 'Working…' : model.ready ? 'Ready' : 'Not loaded';
  $('model-state').classList.toggle('ready', model.ready && !busy);
  $('remember-state').textContent = remembered ? `Remembered on this device: ${remembered.name} · ${(remembered.bytes / 1e6).toFixed(0)} MB. Autoload is enabled.` : 'Load a model once to remember it on this device.';
  $('diagnostics').textContent = JSON.stringify({ ...model.info, loadCount: model.loadCount, contextRequested: 1024, isolated: crossOriginIsolated }, null, 2);
}
function clearResult() { result = null; $('corrected').value = ''; $('result-meta').textContent = 'Review the suggestion before using it.'; }
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

async function loadFile(file, { remember = true, automatic = false } = {}) {
  fileOperation = true; clearError();
  selectedFile = file;
  $('model-file-name').textContent = `${file.name} · ${(file.size / 1e6).toFixed(0)} MB`;
  refresh();
  try {
    await setModelState('loading', '', workspaceTabId);
    await model.load(file);
    await setKeepLoaded(true);
    if (remember) {
      status('Model loaded. Remembering a local copy…');
      await rememberModel(file);
      remembered = await savedModelInfo();
    }
    await setModelState('ready', '', workspaceTabId);
    status(`${automatic ? 'Saved model autoloaded' : 'Model ready'} · loaded in ${model.info.loadSeconds.toFixed(1)} seconds. It will be reused for each check.`);
  } catch (error) {
    showError(error);
    status(model.ready ? 'The model is loaded, but could not be remembered. See the error below.' : 'Model could not be loaded. Choose another file or try again.');
  } finally { fileOperation = false; refresh(); }
}

async function restoreRememberedModel() {
  try {
    workspaceTabId = (await chrome.tabs.getCurrent())?.id;
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
    result = await checking;
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
  if (area === 'session' && changes.selection?.newValue) useSelection(changes.selection.newValue);
});
chrome.storage.session.get('selection').then(({ selection }) => { if (selection) useSelection(selection); }).catch(showError);

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab || message?.target !== 'model-workspace' || message.type !== 'correct-inline') return false;
  if (!initialized || fileOperation) { respond({ error: 'Your saved model is loading. Try again in a moment.', code: 'engine-loading' }); return false; }
  if (!model.ready) { respond({ error: 'Load your model in Local English first, then try the icon again.', code: 'model-not-loaded' }); return false; }
  if (model.busy) { respond({ error: 'The model is checking another passage. Please try again in a moment.', code: 'engine-busy' }); return false; }
  // The workspace is also an inline-test surface. Keep its text box editable
  // and focused during an inline request, just like a normal webpage field.
  inlineBusy = true;
  status('Checking selected webpage text…');
  const checking = model.correct(message.text);
  refresh();
  checking.then(async correction => { await setModelState('ready', '', workspaceTabId); respond({ result: correction }); })
    .catch(error => { showError(error); respond({ error: error.message, code: 'engine-error' }); })
    .finally(() => { inlineBusy = false; status('Model ready. You can check more text.'); refresh(); });
  return true;
});

// First-party diagnostics used by the reproducible browser test.
window.localEnglish = { model, get initialized() { return initialized; }, snapshot: () => ({ info: model.info, loadCount: model.loadCount, checkCount: model.checkCount, ready: model.ready, busy: model.busy || fileOperation, initialized, remembered, result, logs: model.logs }) };
refresh();
restoreRememberedModel();
