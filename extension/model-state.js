export async function setModelState(state, detail = '', tabId) {
  const text = state === 'error' ? '!' : state === 'loading' ? '...' : '';
  const title = state === 'error' ? `Wordwell — Error: ${detail}`
    : state === 'loading' ? 'Wordwell — Starting engine…'
    : state === 'ready' ? 'Wordwell — Engine ready'
    : 'Open Wordwell';
  await chrome.storage.session.set({ modelState: { state, detail, tabId } });
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ color: state === 'error' ? '#b42318' : '#2463a5' }),
    chrome.action.setBadgeTextColor({ color: '#ffffff' }),
    chrome.action.setBadgeText({ text }),
    chrome.action.setTitle({ title }),
  ]);
}
