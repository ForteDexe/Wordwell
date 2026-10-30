// Shared by ordinary website fields and the extension's workspace. This
// function is statically bundled; no remote scripts or runtime eval are used.
export function createAutoChecker(api) {
  const { on, element, button, send, valid, editableTarget, eventEditableTarget, focusedEditableTarget, onEditorFocus, editorText, editorSnapshot, editorRects, trackEditorVisibility, refreshEditorVisibility, raiseUI, insideUI, controlLayout, probeSelection, tools, ui, openSuggestion, hideSuggestion } = api;
  const { host, root } = ui();
  const records = new WeakMap();
  const underlines = element('div', 'auto-underlines');
  const indicator = button('Aa', 'auto-status', statusClick);
  indicator.hidden = true;
  on(indicator, 'pointerdown', event => event.preventDefault());
  root.append(underlines, indicator);
  let enabled = true, settingsReady = false, active = null, pending = null, running = null;
  let timer = null, drawing = 0, stopped = false, composing = false;
  let inputs = 0, mutationsDetected = 0, lastChange = null, lastPump = 'not-started';
  const observer = new ResizeObserver(layoutChanged);
  const mutations = new MutationObserver(layoutChanged);
  const outside = event => !insideUI(event);
  const textAt = record => editorText(record.target).text;
  const fresh = (record, version, value) => !stopped && enabled && !document.hidden && record.version === version && editableTarget(record.target) && record.target.isConnected && textAt(record) === value;
  const cancelQueued = () => send({ type: 'cancel-auto' }).catch(() => {});

  function recordFor(target) {
    if (!records.has(target)) {
      const value = editorText(target).text;
      records.set(target, { target, value, baseText: value, dirty: false, version: 0, phase: 'idle', results: [], cache: new Map(), ignored: new Set(), error: null });
    }
    return records.get(target);
  }
  function activate(target) {
    if ((active?.target || null) === target) return;
    clearTimeout(timer); timer = null; pending = null; cancelQueued();
    if (active) hideSuggestion();
    active = target ? recordFor(target) : null;
    trackEditorVisibility(target);
    observer.disconnect(); mutations.disconnect();
    if (target) {
      observer.observe(target);
      mutations.observe(target, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'contenteditable', 'readonly', 'disabled'] });
    }
    drawSoon();
  }
  function schedule(record, delay = 1200) {
    clearTimeout(timer);
    pending = record; record.phase = 'waiting';
    timer = setTimeout(() => { timer = null; pump(); }, delay);
    drawSoon();
  }
  function input(event) {
    if (!outside(event)) return;
    const target = eventEditableTarget(event);
    if (!target) return;
    inputs++;
    const known = records.has(target);
    activate(target);
    const record = active;
    if (!known) record.baseText = ''; // The first observable event can follow the DOM edit.
    change(record, textAt(record), 'input', event.isComposing);
  }
  function change(record, value, reason, isComposing = false) {
    record.value = value; record.version++; record.results = []; record.error = null; record.dirty = true;
    lastChange = { reason, time: Date.now(), length: value.length };
    hideSuggestion(); cancelQueued();
    clearTimeout(timer); timer = null; pending = null;
    if (enabled && settingsReady && !composing && !isComposing) schedule(record);
    else { record.phase = 'idle'; drawSoon(); }
  }
  function synchronize() {
    if (stopped || document.hidden) return;
    const target = focusedEditableTarget();
    if (target === undefined) return; // A suggestion button owns focus.
    activate(target);
    if (active && active.target.isConnected) {
      refreshEditorVisibility();
      const value = textAt(active);
      if (value !== active.value) { mutationsDetected++; change(active, value, 'focused-field-change'); }
    }
    probeSelection();
  }
  async function pump() {
    if (stopped || running || timer || !enabled || !settingsReady || !pending || document.hidden || composing) return;
    const record = pending; pending = null;
    if (record !== active || !editableTarget(record.target) || !record.target.isConnected) return;
    const value = textAt(record), version = record.version;
    const change = tools.changedRange(record.baseText, value);
    const all = tools.passages(value);
    const wanted = all.filter(passage => record.cache.has(passage.text) || (passage.end >= change.start && passage.start <= change.end));
    const candidates = wanted.filter(passage => (passage.text.match(/\p{L}+/gu)?.length || 0) >= (/[.!?]$/.test(passage.text) ? 2 : 3));
    lastPump = candidates.length ? 'checking' : 'no-eligible-passage';
    if (!candidates.length) { record.phase = 'idle'; drawSoon(); return; }
    running = record; record.phase = 'checking'; record.results = []; record.error = null; drawSoon();
    try {
      for (const passage of candidates) {
        if (!fresh(record, version, value) || record !== active) return;
        if (passage.text.length > 1600) {
          record.error = { error: 'This sentence is too long. Select a shorter passage to check.', code: 'invalid-text' }; continue;
        }
        // Reject an unsupported rich-text boundary before sending anything.
        const source = editorSnapshot(record.target, passage.start, passage.end);
        if (!source || source.text !== passage.text) { lastPump = 'editor-range-unavailable'; continue; }
        let corrected = record.cache.get(passage.text);
        if (corrected === undefined) {
          const response = await send({ type: 'auto-correct', text: passage.text });
          if (!fresh(record, version, value) || record !== active) return;
          if (!response?.result) {
            if (['engine-busy', 'engine-loading'].includes(response?.code)) { schedule(record, 1000); return; }
            if (response?.code !== 'superseded') record.error = response || { error: 'The model did not respond. Click to try again.' };
            break;
          }
          corrected = response.result.corrected;
          record.cache.set(passage.text, corrected);
          if (record.cache.size > 40) record.cache.delete(record.cache.keys().next().value);
        }
        for (const edit of tools.edits(passage.text, corrected)) {
          const key = JSON.stringify([passage.text, edit.start, edit.end, edit.replacement]);
          if (record.ignored.has(key)) continue;
          const snapshot = editorSnapshot(record.target, passage.start + edit.start, passage.start + edit.end);
          if (!snapshot || !valid(snapshot) || !snapshot.text) continue;
          Object.assign(snapshot, { automatic: true, autoKey: key, autoRecord: record });
          record.results.push({ snapshot, corrected: edit.replacement });
        }
      }
      if (fresh(record, version, value)) {
        record.baseText = value;
        record.dirty = Boolean(record.error);
        record.phase = record.error ? 'error' : record.results.length ? 'suggestions' : 'checked';
      }
    } catch (error) {
      if (fresh(record, version, value)) { record.error = { error: error.message }; record.phase = 'error'; }
    } finally {
      running = null;
      if (record.phase === 'checking') record.phase = 'idle';
      drawSoon();
      if (pending && !timer) queueMicrotask(pump);
    }
  }
  function show(result, reveal = false) {
    if (!refreshSnapshot(result)) { drawSoon(); return false; }
    openSuggestion(result.snapshot, result.corrected, reveal);
    return true;
  }
  function navigationFor(snapshot) {
    const record = snapshot.autoRecord;
    const results = enabled && record === active && record?.target.isConnected && textAt(record) === record.value
      ? record.results.filter(refreshSnapshot) : [];
    return { results, index: results.findIndex(result => result.snapshot.autoKey === snapshot.autoKey) };
  }
  function refreshSnapshot(result) {
    if (valid(result.snapshot)) return true;
    const previous = result.snapshot;
    // Some controlled editors replace their text nodes without changing the
    // draft. Rebase only automatic spans whose entire source still matches.
    if (previous.kind !== 'rich' || !previous.target.isConnected || previous.target.innerText !== previous.value) return false;
    const snapshot = editorSnapshot(previous.target, previous.start, previous.end);
    if (!snapshot || snapshot.text !== previous.text || snapshot.value !== previous.value) return false;
    result.snapshot = { ...previous, ...snapshot };
    return valid(result.snapshot);
  }
  function statusClick() {
    if (!active) return;
    if (!enabled || active.error?.code === 'model-not-loaded') { send({ type: 'open-workspace' }).catch(() => {}); return; }
    if (active.results.length) { show(active.results[0]); return; }
    if (running) return;
    active.version++; active.baseText = ''; active.error = null;
    schedule(active, 0);
  }
  function drawSoon() { cancelAnimationFrame(drawing); drawing = requestAnimationFrame(draw); }
  function layoutChanged() { refreshEditorVisibility(); drawSoon(); }
  function draw() {
    underlines.replaceChildren(); indicator.hidden = true;
    if (stopped || !settingsReady || !active || document.hidden || !active.target.isConnected || !editableTarget(active.target)) return;
    raiseUI(active.target);
    if (textAt(active) !== active.value) {
      mutationsDetected++; change(active, textAt(active), 'editor-normalized-text');
    }
    const controls = controlLayout(active.target);
    if (!controls) return;
    const { size, left, top } = controls;
    indicator.style.width = `${size}px`; indicator.style.height = `${size}px`;
    indicator.style.left = `${left}px`; indicator.style.top = `${top}px`;
    indicator.hidden = false;
    const state = running ? 'checking' : !enabled ? 'paused' : active.phase;
    const labels = { idle: 'Ready. Type to check automatically.', waiting: 'Waiting for a typing pause…', checking: enabled ? 'Checking grammar…' : 'Finishing the current check. Automatic checking is paused.', paused: 'Automatic checking is paused. Click to open settings.', checked: 'No changes suggested. The model can still miss errors.', suggestions: `${active.results.length} suggestion${active.results.length === 1 ? '' : 's'}. Click to review.`, error: active.error?.error || 'Could not check this text. Click to try again.' };
    indicator.dataset.state = state;
    indicator.title = `Local English: ${labels[state]}`; indicator.setAttribute('aria-label', indicator.title);
    indicator.setAttribute('aria-busy', String(state === 'checking'));
    indicator.replaceChildren(state === 'checking' ? element('span', 'spinner') : document.createTextNode(state === 'suggestions' ? String(active.results.length) : state === 'error' ? '!' : state === 'waiting' ? '…' : state === 'paused' ? 'Ⅱ' : 'Aa'));
    if (!enabled) return;
    for (const result of active.results) {
      if (!refreshSnapshot(result)) continue;
      for (const rect of editorRects(result.snapshot)) {
        const mark = button('', 'auto-underline', () => show(result));
        mark.setAttribute('aria-label', `Review correction: ${result.snapshot.text} → ${result.corrected || '(remove)'}`);
        mark.title = 'Review correction';
        Object.assign(mark.style, { left: `${rect.left}px`, top: `${rect.bottom - 2}px`, width: `${Math.max(3, rect.right - rect.left)}px` });
        on(mark, 'pointerdown', event => event.preventDefault());
        underlines.append(mark);
      }
    }
  }
  function setEnabled(value) {
    enabled = value !== false; settingsReady = true;
    if (!enabled) {
      clearTimeout(timer); timer = null; pending = null; hideSuggestion(); cancelQueued();
      if (active) { active.version++; active.results = []; active.phase = 'idle'; }
    } else if (active?.dirty && !composing) schedule(active);
    drawSoon();
  }
  const settingsListener = (changes, area) => { if (area === 'local' && changes.autoCheck) setEnabled(changes.autoCheck.newValue); };
  chrome.storage.onChanged.addListener(settingsListener);
  chrome.storage.local.get({ autoCheck: true }).then(({ autoCheck }) => { if (!stopped) setEnabled(autoCheck); }).catch(() => { if (!stopped) setEnabled(false); });
  onEditorFocus(event => { if (outside(event)) activate(eventEditableTarget(event)); });
  on(window, 'input', input, { capture: true });
  on(window, 'compositionstart', event => {
    if (!outside(event) || !eventEditableTarget(event)) return;
    composing = true; clearTimeout(timer); timer = null; pending = null;
    if (active) { active.version++; active.results = []; hideSuggestion(); drawSoon(); }
    cancelQueued();
  }, { capture: true });
  on(window, 'compositionend', event => { composing = false; input(event); }, { capture: true });
  on(document, 'visibilitychange', () => {
    if (document.hidden) { clearTimeout(timer); timer = null; pending = null; cancelQueued(); }
    drawSoon();
  });
  on(window, 'scroll', layoutChanged, { capture: true, passive: true });
  on(window, 'resize', layoutChanged, { passive: true });
  on(window, 'keyup', event => { if (outside(event)) synchronize(); }, { capture: true });
  on(window, 'pointerup', event => { if (outside(event)) synchronize(); }, { capture: true });
  // Only the focused field is sampled. This catches property-only textarea
  // changes and editors that swallow/non-compose their own input events.
  const poll = setInterval(synchronize, 400);
  return {
    refreshLayout: drawSoon,
    navigation(snapshot) {
      const { results, index } = navigationFor(snapshot);
      return { index, total: results.length };
    },
    navigate(snapshot, step) {
      const { results, index } = navigationFor(snapshot);
      if (index < 0) { hideSuggestion(); return false; }
      const next = results[index + step];
      return next ? show(next, true) : false;
    },
    diagnostics() {
      return { enabled, settingsReady, inputs, mutationsDetected, composing, lastChange, lastPump,
        active: Boolean(active), phase: active?.phase || null, sourceLength: active?.value.length ?? null,
        dirty: active?.dirty ?? null, timerPending: Boolean(timer), pending: Boolean(pending), running: Boolean(running),
        suggestions: active?.results.length || 0, renderedUnderlines: underlines.childElementCount,
        spans: (active?.results || []).slice(0, 8).map(result => ({ valid: valid(result.snapshot), rectangles: editorRects(result.snapshot).length, geometry: editorRects(result.snapshot, true) })),
      };
    },
    ignore(snapshot) {
      const record = snapshot.autoRecord;
      if (!record || !valid(snapshot)) return;
      record.ignored.add(snapshot.autoKey);
      if (record.ignored.size > 80) record.ignored.delete(record.ignored.values().next().value);
      record.results = record.results.filter(result => result.snapshot.autoKey !== snapshot.autoKey);
      record.phase = record.results.length ? 'suggestions' : 'idle'; drawSoon();
    },
    destroy() {
      stopped = true; clearTimeout(timer); clearInterval(poll); cancelAnimationFrame(drawing); observer.disconnect(); mutations.disconnect();
      trackEditorVisibility(null);
      chrome.storage.onChanged.removeListener(settingsListener); underlines.remove(); indicator.remove();
    },
  };
}
