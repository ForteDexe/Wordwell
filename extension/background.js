import { savedModelInfo } from './model-cache.js';
import { setModelState } from './model-state.js';

const WORKSPACE = 'workspace.html';
const MENU_ID = 'correct-selection';
let opening;

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

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: 'Check with Local English', contexts: ['selection'] });
  });
  restoreOnStartup().catch(error => setModelState('error', error.message));
});
chrome.runtime.onStartup.addListener(() => { restoreOnStartup().catch(error => setModelState('error', error.message)); });
chrome.tabs.onRemoved.addListener(async tabId => {
  const { modelState } = await chrome.storage.session.get('modelState');
  if (modelState?.tabId === tabId) await setModelState('unloaded');
});
chrome.action.onClicked.addListener(() => { openWorkspace().catch(console.error); });
chrome.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId === MENU_ID) queueSelection(info.selectionText).catch(console.error);
});

// A shared entry point for extension-owned UI pages. External messages are
// not enabled; all routes use the same singleton workspace lookup.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !['open-workspace', 'selected-text', 'inline-correct'].includes(message?.type)) return false;
  if (message.type === 'inline-correct') {
    correctInline(message.text).then(respond).catch(error => respond({ error: error.message, code: 'engine-error' }));
  } else {
    const task = message.type === 'selected-text' ? queueSelection(message.text) : openWorkspace();
    task.then(tabId => respond({ tabId })).catch(error => respond({ error: error.message }));
  }
  return true;
});

async function correctInline(text) {
  if (typeof text !== 'string' || !text.trim()) return { error: 'Select a sentence to check.', code: 'invalid-text' };
  if (text.length > 1600) return { error: 'Select a shorter passage (up to 1,600 characters).', code: 'invalid-text' };
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
