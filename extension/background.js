import { savedModelInfo } from './model-cache.js';
import { setModelState } from './model-state.js';

const WORKSPACE = 'workspace.html';
const MENU_ID = 'correct-selection';
const DIAGNOSE_ID = 'diagnose-editor';
let opening;
let processing = false;
const correctionQueue = [];
const callerKey = sender => `${sender.tab?.id ?? 'extension'}:${sender.frameId ?? 0}:${sender.documentId ?? ''}`;
function cancelAutomatic(key) {
  for (let i = correctionQueue.length - 1; i >= 0; i--) {
    if (correctionQueue[i].automatic && correctionQueue[i].key === key) {
      correctionQueue.splice(i, 1)[0].resolve({ code: 'superseded' });
    }
  }
}
function queueCorrection(text, sender, automatic) {
  const key = callerKey(sender);
  if (automatic) cancelAutomatic(key);
  return new Promise(resolve => {
    const request = { text, key, automatic, resolve };
    if (automatic) correctionQueue.push(request);
    else correctionQueue.unshift(request); // Explicit checks take priority.
    drainCorrections();
  });
}
async function drainCorrections() {
  if (processing) return;
  processing = true;
  try {
    while (correctionQueue.length) {
      const request = correctionQueue.shift();
      try { request.resolve(await correctInline(request.text)); }
      catch (error) { request.resolve({ error: error.message, code: 'engine-error' }); }
    }
  } finally { processing = false; }
}

export async function openWorkspace({ focus = true } = {}) {
  if (!opening) {
    opening = (async () => {
      const url = chrome.runtime.getURL(WORKSPACE);
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
      return contexts.find(context => context.tabId >= 0)?.tabId ?? (await chrome.tabs.create({ url, active: focus })).id;
    })().finally(() => { opening = null; });
  }
  const tabId = await opening;
  if (focus) {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId >= 0) await chrome.windows.update(tab.windowId, { focused: true });
  }
  return tabId;
}

export async function queueSelection(text) {
  if (typeof text !== 'string' || !text.trim()) return;
  await chrome.storage.session.set({ selection: { text, id: crypto.randomUUID() } });
  return openWorkspace();
}

export async function captureEditorDiagnostics(tabId, frameId = 0, hostname = 'unknown') {
  let report;
  try { report = await chrome.tabs.sendMessage(tabId, { type: 'collect-editor-diagnostics' }, { frameId }); }
  catch { report = { extensionVersion: chrome.runtime.getManifest().version, hostname, commentTextIncluded: false, contentScriptConnected: false, reason: 'The editor content script did not respond. Refresh this page after reloading the extension.' }; }
  const { editorDiagnostics = [] } = await chrome.storage.session.get('editorDiagnostics');
  const reports = [...editorDiagnostics.slice(-4), { ...report, capturedAt: new Date().toISOString(), frameId }];
  await chrome.storage.session.set({ editorDiagnostics: reports });
  await openWorkspace();
  return reports;
}
// First-party inspection entry point for the reproducible browser checks.
globalThis.localEnglishDiagnostics = { captureEditorDiagnostics };

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: 'Check with Local English', contexts: ['selection'] });
    chrome.contextMenus.create({ id: DIAGNOSE_ID, title: 'Local English: Diagnose this editor', contexts: ['editable', 'selection', 'page'] });
  });
  restoreOnStartup().catch(error => setModelState('error', error.message));
});
chrome.runtime.onStartup.addListener(() => { restoreOnStartup().catch(error => setModelState('error', error.message)); });
chrome.tabs.onRemoved.addListener(async tabId => {
  const { modelState } = await chrome.storage.session.get('modelState');
  if (modelState?.tabId === tabId) await setModelState('unloaded');
});
chrome.action.onClicked.addListener(() => { openWorkspace().catch(console.error); });
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID) queueSelection(info.selectionText).catch(console.error);
  if (info.menuItemId === DIAGNOSE_ID && tab?.id !== undefined) {
    let hostname = 'unknown'; try { hostname = new URL(info.pageUrl).hostname; } catch {}
    captureEditorDiagnostics(tab.id, info.frameId || 0, hostname).catch(console.error);
  }
});

// A shared entry point for extension-owned UI pages. External messages are
// not enabled; all routes use the same singleton workspace lookup.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !['open-workspace', 'selected-text', 'inline-correct', 'auto-correct', 'cancel-auto'].includes(message?.type)) return false;
  if (message.type === 'cancel-auto') {
    cancelAutomatic(callerKey(sender)); respond({ cancelled: true }); return false;
  }
  if (['inline-correct', 'auto-correct'].includes(message.type)) {
    queueCorrection(message.text, sender, message.type === 'auto-correct').then(respond);
  } else {
    const task = message.type === 'selected-text' ? queueSelection(message.text) : openWorkspace();
    task.then(tabId => respond({ tabId })).catch(error => respond({ error: error.message }));
  }
  return true;
});

async function correctInline(text) {
  if (typeof text !== 'string' || !text.trim()) return { error: 'Select a sentence to check.', code: 'invalid-text' };
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [chrome.runtime.getURL(WORKSPACE)] });
  if (!contexts.length) {
    if (await savedModelInfo()) {
      await openWorkspace({ focus: false });
      return { error: 'Your saved model is loading. Try the icon again in a moment.', code: 'engine-loading' };
    }
    return { error: 'Open Local English and load your model first.', code: 'model-not-loaded' };
  }
  try {
    return await chrome.runtime.sendMessage({ target: 'model-workspace', type: 'correct-inline', text });
  } catch {
    return { error: 'The model workspace is unavailable. Open it and load your model again.', code: 'model-not-loaded' };
  }
}

async function restoreOnStartup() {
  if (await savedModelInfo()) await openWorkspace({ focus: false });
}
