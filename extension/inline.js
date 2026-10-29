(() => {
  'use strict';
  const CSS = '__INLINE_CSS__';
  const diffText = '__INLINE_DIFF__';
  const events = new AbortController();
  let host, root, trigger, panel, current = null;
  let requestVersion = 0, frame = 0, destroyed = false, observer;
  const on = (target, type, listener, options = {}) => target.addEventListener(type, listener, { ...options, signal: events.signal });
  const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
  const insideUI = event => host && event.composedPath().includes(host);

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function button(label, className, action) {
    const node = element('button', className, label); node.type = 'button';
    on(node, 'click', action);
    return node;
  }
  function ensureUI() {
    if (host) return;
    host = document.createElement('local-english-selection');
    host.dataset.state = 'hidden';
    root = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet(); sheet.replaceSync(CSS); root.adoptedStyleSheets = [sheet];
    trigger = button('Aa', 'trigger', checkSelection);
    trigger.setAttribute('aria-label', 'Check selected text with Local English');
    trigger.title = 'Check selected text'; trigger.hidden = true;
    on(trigger, 'pointerdown', event => event.preventDefault());
    panel = element('section', 'panel'); panel.hidden = true;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Local English suggestion');
    root.append(trigger, panel);
    document.documentElement.append(host);
  }
  function destroy() {
    destroyed = true; events.abort(); observer?.disconnect(); cancelAnimationFrame(frame); host?.remove();
  }
  function hide() {
    requestVersion += 1;
    current = null; observer?.disconnect();
    if (host) { host.dataset.state = 'hidden'; trigger.hidden = true; panel.hidden = true; }
  }
  function valid(snapshot) {
    if (!snapshot?.target.isConnected) return false;
    if (snapshot.kind === 'plain') return snapshot.target.value === snapshot.value && !snapshot.target.disabled && !snapshot.target.readOnly
      && (!(snapshot.target instanceof HTMLInputElement) || ['text', 'search', 'url', 'tel'].includes(snapshot.target.type));
    return snapshot.target.isContentEditable && snapshot.target.contains(snapshot.range.startContainer)
      && snapshot.target.contains(snapshot.range.endContainer) && snapshot.target.innerText === snapshot.value && snapshot.range.toString() === snapshot.text;
  }

  function plainAnchor(snapshot) {
    const target = snapshot.target;
    const rect = target.getBoundingClientRect();
    const styles = getComputedStyle(target);
    const mirror = document.createElement('div');
    const copied = ['boxSizing', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textTransform', 'textIndent', 'textAlign', 'direction', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle', 'tabSize', 'wordBreak'];
    for (const property of copied) mirror.style[property] = styles[property];
    Object.assign(mirror.style, { position: 'fixed', boxSizing: 'border-box', top: `${rect.top}px`, left: `${rect.left}px`,
      width: `${target.clientWidth + parseFloat(styles.borderLeftWidth) + parseFloat(styles.borderRightWidth)}px`,
      height: 'auto', minHeight: '0', maxHeight: 'none', visibility: 'hidden', pointerEvents: 'none',
      whiteSpace: target instanceof HTMLInputElement || target.wrap === 'off' ? 'pre' : 'pre-wrap', overflowWrap: 'break-word' });
    mirror.append(document.createTextNode(snapshot.value.slice(0, snapshot.start)));
    const marker = document.createElement('span'); marker.textContent = snapshot.value.slice(snapshot.start, snapshot.start + 1) || '\u200b';
    mirror.append(marker, document.createTextNode(snapshot.value.slice(snapshot.start + 1)));
    document.documentElement.append(mirror);
    const position = marker.getBoundingClientRect();
    const top = position.top - target.scrollTop, left = position.left - target.scrollLeft;
    const height = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.2;
    mirror.remove();
    if (top + height < rect.top || top > rect.bottom || left < rect.left - 3 || left > rect.right) return null;
    return { left, top, bottom: top + height };
  }
  function anchor(snapshot) {
    if (!valid(snapshot)) return null;
    if (snapshot.kind === 'plain') return plainAnchor(snapshot);
    const rect = snapshot.range.getClientRects()[0];
    return rect ? { left: rect.left, top: rect.top, bottom: rect.bottom } : null;
  }
  function position() {
    if (!current || !host || host.dataset.state === 'hidden') return;
    const point = anchor(current);
    if (!point || point.bottom < 0 || point.top > innerHeight) { hide(); return; }
    trigger.style.left = `${clamp(point.left, 8, innerWidth - 35)}px`;
    trigger.style.top = `${clamp(point.top - 31, 8, innerHeight - 35)}px`;
    if (!panel.hidden) {
      const width = panel.offsetWidth, height = panel.offsetHeight;
      panel.style.left = `${clamp(point.left, 8, innerWidth - width - 8)}px`;
      const below = point.bottom + 6;
      panel.style.top = `${clamp(below + height + 8 > innerHeight ? point.top - height - 6 : below, 8, innerHeight - height - 8)}px`;
    }
  }
  function readSelection() {
    let target = document.activeElement;
    while (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      if (target instanceof HTMLInputElement && !['text', 'search', 'url', 'tel'].includes(target.type)) return null;
      if (target.disabled || target.readOnly || target.selectionStart == null || target.selectionEnd <= target.selectionStart) return null;
      const text = target.value.slice(target.selectionStart, target.selectionEnd);
      if (!text.trim()) return null;
      return { kind: 'plain', target, value: target.value, start: target.selectionStart, end: target.selectionEnd, text };
    }
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    if (!start?.isContentEditable) return null;
    const editor = start.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]');
    if (!editor?.contains(range.endContainer)) return null;
    const text = range.toString();
    if (!text.trim()) return null;
    return { kind: 'rich', target: editor, value: editor.innerText, range: range.cloneRange(), text };
  }
  function scan() {
    if (destroyed) return;
    try { if (!chrome.runtime?.id) { destroy(); return; } } catch { destroy(); return; }
    // Buttons in our own shadow root may take focus without changing the saved selection.
    if (host && document.activeElement === host && !panel.hidden) return;
    const next = readSelection();
    if (!next) { hide(); return; }
    const sameRange = current && (next.kind === 'plain'
      ? current.start === next.start && current.end === next.end
      : current.range?.startContainer === next.range.startContainer && current.range.startOffset === next.range.startOffset && current.range.endContainer === next.range.endContainer && current.range.endOffset === next.range.endOffset);
    if (sameRange && valid(current) && current.target === next.target && current.text === next.text) { position(); return; }
    hide(); current = next; ensureUI();
    host.dataset.state = 'trigger'; trigger.hidden = false; panel.hidden = true;
    observer = new ResizeObserver(position); observer.observe(current.target);
    position();
  }
  function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(scan); }
  function close(restore = true) {
    const snapshot = current;
    hide();
    if (restore && valid(snapshot)) {
      snapshot.target.focus({ preventScroll: true });
      if (snapshot.kind === 'plain') snapshot.target.setSelectionRange(snapshot.start, snapshot.end);
      else { const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(snapshot.range); }
    }
  }

  function selectionMatches(snapshot) {
    const selected = readSelection();
    if (!selected || selected.target !== snapshot.target || selected.text !== snapshot.text) return false;
    if (snapshot.kind === 'plain') return selected.start === snapshot.start && selected.end === snapshot.end;
    return selected.range.compareBoundaryPoints(Range.START_TO_START, snapshot.range) === 0
      && selected.range.compareBoundaryPoints(Range.END_TO_END, snapshot.range) === 0;
  }
  function replacementError(snapshot, message) {
    if (!valid(snapshot)) { hide(); return; }
    let note = panel.querySelector('.replace-error');
    if (!note) { note = element('p', 'message replace-error'); note.setAttribute('role', 'alert'); panel.querySelector('.body').append(note); }
    note.textContent = message; position();
  }
  function replaceSelection(snapshot, corrected) {
    if (!valid(snapshot)) { hide(); return; }
    if (snapshot.kind === 'plain') {
      const length = snapshot.value.length - (snapshot.end - snapshot.start) + corrected.length;
      if (snapshot.target.maxLength >= 0 && length > snapshot.target.maxLength) {
        replacementError(snapshot, 'The correction exceeds this field’s character limit.'); return;
      }
      if (snapshot.target instanceof HTMLInputElement && /[\r\n]/.test(corrected)) {
        replacementError(snapshot, 'This field needs a single-line correction.'); return;
      }
    }
    snapshot.target.focus({ preventScroll: true });
    if (!valid(snapshot)) { hide(); return; }
    if (snapshot.kind === 'plain') snapshot.target.setSelectionRange(snapshot.start, snapshot.end);
    else { const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(snapshot.range.cloneRange()); }
    if (!selectionMatches(snapshot)) { hide(); return; }
    // Let the host editor veto the edit, and recheck after synchronous handlers.
    const allowed = snapshot.target.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true, composed: true, cancelable: true, inputType: 'insertReplacementText', data: corrected,
    }));
    if (!allowed) { replacementError(snapshot, 'This editor blocked replacement.'); return; }
    if (!valid(snapshot) || !selectionMatches(snapshot)) { hide(); return; }
    try {
      // Chrome's native text edit keeps Undo and emits the editor's input event.
      // Never use insertHTML: the correction must remain literal plain text.
      if (!document.execCommand('insertText', false, corrected)) {
        replacementError(snapshot, 'This editor could not replace the selection.'); return;
      }
      hide();
    } catch {
      replacementError(snapshot, 'This editor could not replace the selection.');
    }
  }

  function renderDiff(original, corrected) {
    const correction = element('p', 'text correction');
    const removed = element('p', 'removed');
    const parts = diffText(original, corrected);
    for (const part of parts) {
      if (part.type === 'delete') {
        if (part.text.trim()) {
          if (!removed.childNodes.length) removed.append(document.createTextNode('Removed: '));
          else removed.append(document.createTextNode(' · '));
          removed.append(element('del', '', part.text));
        }
      } else if (part.type === 'insert' && part.text.trim()) {
        const mark = element('mark', 'diff-added', part.text); mark.title = 'Added or changed text'; correction.append(mark);
      } else correction.append(document.createTextNode(part.text));
    }
    return removed.childNodes.length ? [correction, removed] : [correction];
  }

  function render(state, snapshot, response) {
    ensureUI(); panel.replaceChildren(); panel.hidden = false; trigger.hidden = true; host.dataset.state = state;
    const heading = element('div', 'heading'); heading.append(element('span', 'swatch'), element('span', '', 'Sentence correction'));
    const closeButton = button('×', 'close', () => close()); closeButton.setAttribute('aria-label', 'Close suggestion'); heading.append(closeButton);
    const body = element('div', 'body'); body.setAttribute('aria-live', 'polite');
    const actions = element('div', 'actions');
    if (state === 'loading') {
      const message = element('p', 'message'); message.append(element('span', 'spinner'), document.createTextNode('Checking selected text…')); body.append(message);
    } else if (state === 'result') {
      const unchanged = snapshot.text.trim() === response.result.corrected;
      body.append(element('p', 'label', 'Original'), element('p', 'text original', snapshot.text), element('p', 'label', unchanged ? 'No changes suggested' : 'Suggested correction'), ...renderDiff(snapshot.text, response.result.corrected));
      const replace = button('Replace', 'action', () => replaceSelection(snapshot, response.result.corrected));
      replace.disabled = unchanged;
      if (unchanged) replace.title = 'No changes to replace';
      actions.append(replace);
    } else {
      body.append(element('p', 'message', response.error));
      if (response.code === 'model-not-loaded') actions.append(button('Open model workspace', 'action', () => send({ type: 'open-workspace' }).catch(() => {})));
      else actions.append(button('Try again', 'action secondary', checkSelection));
    }
    const footer = element('div', 'footer'); footer.append(element('span', '', 'Local English'), button('Model workspace', '', () => send({ type: 'open-workspace' }).catch(() => {})));
    if (state === 'result') { const note = element('p', 'message', 'Review before using. The model can still miss errors.'); note.style.fontSize = '11px'; body.append(note); }
    panel.append(heading, body, actions, footer); position();
  }
  async function send(message) {
    try { return await chrome.runtime.sendMessage(message); }
    catch (error) {
      if (error.message?.includes('Extension context invalidated')) destroy();
      throw error;
    }
  }
  async function checkSelection() {
    if (!current || !valid(current)) { hide(); return; }
    const snapshot = current, version = ++requestVersion;
    if (snapshot.text.length > 1600) { render('error', snapshot, { error: 'Select a shorter passage (up to 1,600 characters).', code: 'invalid-text' }); return; }
    render('loading', snapshot);
    try {
      const response = await send({ type: 'inline-correct', text: snapshot.text });
      if (destroyed || version !== requestVersion) return;
      if (!valid(snapshot)) { hide(); return; }
      render(response?.result ? 'result' : 'error', snapshot, response || { error: 'The model workspace did not respond. Please try again.' });
    } catch (error) {
      if (!destroyed && version === requestVersion) {
        if (valid(snapshot)) render('error', snapshot, { error: error.message });
        else hide();
      }
    }
  }

  on(document, 'selectionchange', schedule);
  on(document, 'select', schedule, { capture: true });
  on(document, 'pointerup', event => { if (!insideUI(event)) schedule(); }, { capture: true });
  on(document, 'keyup', event => { if (!insideUI(event)) schedule(); }, { capture: true });
  on(document, 'input', event => { if (!insideUI(event) && current) hide(); }, { capture: true });
  on(document, 'pointerdown', event => { if (!insideUI(event)) hide(); }, { capture: true });
  on(document, 'keydown', event => { if (event.key === 'Escape' && current) { event.preventDefault(); close(); } }, { capture: true });
  on(window, 'scroll', position, { capture: true, passive: true });
  on(window, 'resize', position, { passive: true });
})();
