(() => {
  'use strict';
  const CSS = '__INLINE_CSS__';
  const diffText = '__INLINE_DIFF__';
  const createWritingTools = '__INLINE_WRITING_TOOLS__';
  const createAutoChecker = '__INLINE_AUTO_CHECKER__';
  const events = new AbortController();
  let host, root, trigger, panel, current = null;
  let requestVersion = 0, frame = 0, destroyed = false, observer;
  let automatic;
  let componentFocusListener;
  let topLayerScope = null, topLayerDirty = false;
  const observedEvents = { focusin: 0, input: 0, keyup: 0, pointerup: 0 };
  let lastScriptError = null;
  let visibilityTarget = null, visibilityFrame = 0;
  const editorVisibility = new WeakMap();
  const visibilityObserver = new IntersectionObserver(entries => {
    let changed = false;
    for (const entry of entries) {
      const box = entry.boundingClientRect, visible = entry.intersectionRect;
      const next = { intersecting: entry.isIntersecting && visible.width > 0 && visible.height > 0,
        bounds: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
        insets: { left: Math.max(0, visible.left - box.left), top: Math.max(0, visible.top - box.top), right: Math.max(0, box.right - visible.right), bottom: Math.max(0, box.bottom - visible.bottom) } };
      const previous = editorVisibility.get(entry.target);
      if (!previous || previous.intersecting !== next.intersecting || Object.keys(next.insets).some(key => Math.abs(previous.insets[key] - next.insets[key]) > .01 || Math.abs(previous.bounds[key] - next.bounds[key]) > .01)) changed = true;
      editorVisibility.set(entry.target, next);
    }
    if (changed) automatic?.refreshLayout();
  });
  const focusRoots = new WeakSet();
  const on = (target, type, listener, options = {}) => target.addEventListener(type, listener, { ...options, signal: events.signal });
  const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
  function belongsToUI(node) {
    for (let parent = node; parent instanceof Element; parent = composedParent(parent)) if (parent === host) return true;
    return false;
  }
  function deepElementFromPoint(x, y) {
    let hit = document.elementFromPoint(x, y);
    const seen = new Set();
    for (let next; hit && !seen.has(hit);) {
      seen.add(hit); next = shadowRootOf(hit)?.elementFromPoint?.(x, y);
      if (!next || next === hit) break;
      hit = next;
    }
    return hit;
  }
  function insideUI(event) {
    if (!host) return false;
    if (event.composedPath().includes(host)) return true;
    if (host.getRootNode() === document) return false;
    // A dialog may itself live inside a closed component, which retargets
    // our button events too. Resolve the hit/focus before hiding our card.
    if (event instanceof MouseEvent) {
      return belongsToUI(deepElementFromPoint(event.clientX, event.clientY));
    }
    return belongsToUI(deepActiveElement());
  }

  function shadowRootOf(node) {
    if (!(node instanceof HTMLElement)) return null;
    // Chrome exposes closed component roots to content scripts without
    // patching the website's attachShadow or changing its encapsulation.
    try {
      const shadow = node.shadowRoot || chrome.dom?.openOrClosedShadowRoot?.(node) || null;
      if (shadow && componentFocusListener && !focusRoots.has(shadow)) {
        focusRoots.add(shadow);
        // Moving focus between two controls in one component can suppress
        // the document's retargeted focus event. Observe that root directly.
        on(shadow, 'focusin', componentFocusListener, { capture: true });
      }
      return shadow;
    }
    catch { return null; }
  }
  function deepActiveElement(scope = document) {
    let target = scope instanceof Element ? scope : scope.activeElement;
    for (let next; target && (next = shadowRootOf(target)?.activeElement);) target = next;
    return target;
  }
  function selectionFor(target) {
    return target?.getRootNode()?.getSelection?.() || window.getSelection();
  }
  function selectedRange(target) {
    const scope = target?.getRootNode();
    const selection = selectionFor(target);
    if (scope instanceof ShadowRoot && typeof selection?.getComposedRanges === 'function') {
      const shadowRoots = [];
      for (let tree = scope; tree instanceof ShadowRoot; tree = tree.host.getRootNode()) shadowRoots.push(tree);
      const selected = selection.getComposedRanges({ shadowRoots })[0];
      if (selected?.startContainer.getRootNode() === scope && selected.endContainer.getRootNode() === scope) {
        const range = document.createRange();
        range.setStart(selected.startContainer, selected.startOffset); range.setEnd(selected.endContainer, selected.endOffset);
        return range;
      }
    }
    return selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  }
  function restoreRange(target, range) {
    selectionFor(target).setBaseAndExtent(range.startContainer, range.startOffset, range.endContainer, range.endOffset);
  }
  function composedParent(node) { return node.assignedSlot || node.parentElement || node.getRootNode()?.host || null; }
  function raiseUI(target) {
    if (!host || typeof host.showPopover !== 'function') return;
    let overlay = null, modal = null;
    for (let parent = target; parent instanceof Element; parent = composedParent(parent)) {
      if (parent !== host && parent.matches(':modal, :popover-open')) overlay ||= parent;
      if (parent.matches(':modal')) modal ||= parent;
    }
    modal ||= document.querySelector(':modal'); overlay ||= modal;
    const parent = modal || document.documentElement;
    if (host.matches(':popover-open') && host.parentNode === parent && overlay === topLayerScope && !topLayerDirty) return;
    try {
      if (host.matches(':popover-open')) host.hidePopover();
      // A popover outside a modal is still inert. Keep our host inside the
      // active dialog while its children remain in our own shadow tree.
      if (host.parentNode !== parent) parent.append(host);
      host.showPopover(); topLayerScope = overlay; topLayerDirty = false;
    } catch { /* The regular fixed overlay remains the fallback. */ }
  }

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
    host.popover = 'manual';
    host.dataset.state = 'hidden';
    root = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet(); sheet.replaceSync(CSS); root.adoptedStyleSheets = [sheet];
    trigger = button('', 'trigger', checkSelection);
    const bulb = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    bulb.setAttribute('viewBox', '0 0 24 24'); bulb.setAttribute('aria-hidden', 'true'); bulb.setAttribute('focusable', 'false');
    const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    outline.setAttribute('d', 'M9 16v-1.5c0-1.1-.8-2-1.5-2.8a6 6 0 1 1 9 0c-.7.8-1.5 1.7-1.5 2.8V16M9 17h6M10 20h4');
    bulb.append(outline); trigger.append(bulb);
    trigger.setAttribute('aria-label', 'Refine selected text');
    trigger.title = 'Refine selected text'; trigger.hidden = true;
    on(trigger, 'pointerdown', event => event.preventDefault());
    panel = element('section', 'panel'); panel.hidden = true;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Local English suggestion');
    root.append(trigger, panel);
    document.documentElement.append(host);
    raiseUI(deepActiveElement());
  }
  function destroy() {
    destroyed = true; automatic?.destroy(); events.abort(); observer?.disconnect(); visibilityObserver.disconnect(); cancelAnimationFrame(visibilityFrame); cancelAnimationFrame(frame); host?.remove();
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

  function plainAnchor(snapshot, allRects = false) {
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
    const end = allRects ? snapshot.end : snapshot.start + 1;
    const marker = document.createElement('span'); marker.textContent = snapshot.value.slice(snapshot.start, end) || '\u200b';
    mirror.append(marker, document.createTextNode(snapshot.value.slice(end)));
    // Website selectors (including !important rules) must not alter the
    // measuring div/span. Use our isolated styles, not the page's root.
    ensureUI(); root.append(mirror);
    const position = marker.getBoundingClientRect();
    const rectangles = allRects ? [...marker.getClientRects()].map(item => ({ left: item.left - target.scrollLeft, right: item.right - target.scrollLeft, top: item.top - target.scrollTop, bottom: item.bottom - target.scrollTop })) : null;
    const top = position.top - target.scrollTop, left = position.left - target.scrollLeft;
    const height = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.2;
    mirror.remove();
    if (allRects) return rectangles;
    if (top + height < rect.top || top > rect.bottom || left < rect.left - 3 || left > rect.right) return null;
    return { left, top, bottom: top + height };
  }
  function anchor(snapshot) {
    if (!valid(snapshot)) return null;
    if (snapshot.kind === 'plain') return plainAnchor(snapshot);
    const rect = snapshot.range.getClientRects()[0];
    return rect ? { left: rect.left, top: rect.top, bottom: rect.bottom } : null;
  }
  function revealSuggestion(snapshot) {
    const target = snapshot.target;
    const source = snapshot.kind === 'plain' ? target : snapshot.range.startContainer.parentElement || target;
    source.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    if (snapshot.kind !== 'plain') return;
    const rect = plainAnchor(snapshot, true)?.[0];
    if (!rect) return;
    const box = target.getBoundingClientRect();
    const top = box.top + target.clientTop, left = box.left + target.clientLeft;
    const bottom = top + target.clientHeight, right = left + target.clientWidth;
    if (rect.top < top) target.scrollTop += rect.top - top;
    else if (rect.bottom > bottom) target.scrollTop += rect.bottom - bottom;
    if (rect.left < left) target.scrollLeft += rect.left - left;
    else if (rect.right > right) target.scrollLeft += rect.right - right;
  }
  function controlLayout(target) {
    const box = target.getBoundingClientRect();
    if (box.width < 20 || box.height < 15 || box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) return null;
    const size = box.height < 40 ? 18 : 24;
    return { size, left: clamp(box.right - size - 5, 4, innerWidth - size - 4),
      top: clamp(Math.max(box.top + 1, box.bottom - size - 5), 4, innerHeight - size - 4) };
  }
  function position() {
    if (!current || !host || host.dataset.state === 'hidden') return;
    if (!valid(current)) { hide(); return; }
    raiseUI(current.target);
    const controls = controlLayout(current.target);
    if (!controls) { hide(); return; }
    const { size, left, top } = controls;
    // Use the same geometry as the status/count, with a six-pixel gap. If
    // the viewport is too narrow for the pair, put the bulb above the count.
    const bulbLeft = left - size - 6, stacked = bulbLeft < 4;
    const bulbTop = stacked ? clamp(top - size - 6, 4, innerHeight - size - 4) : top;
    Object.assign(trigger.style, { width: `${size}px`, height: `${size}px`, left: `${stacked ? left : bulbLeft}px`, top: `${bulbTop}px` });
    if (!panel.hidden) {
      const point = anchor(current) || (!current.automatic ? { left: Math.max(4, bulbLeft), top: bulbTop, bottom: bulbTop + size } : null);
      if (!point || point.bottom < 0 || point.top > innerHeight) { hide(); return; }
      const width = panel.offsetWidth, height = panel.offsetHeight;
      panel.style.left = `${clamp(point.left, 8, innerWidth - width - 8)}px`;
      const below = point.bottom + 6;
      panel.style.top = `${clamp(below + height + 8 > innerHeight ? point.top - height - 6 : below, 8, innerHeight - height - 8)}px`;
    }
  }
  function readSelection() {
    const target = deepActiveElement();
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      if (target instanceof HTMLInputElement && !['text', 'search', 'url', 'tel'].includes(target.type)) return null;
      if (target.disabled || target.readOnly || target.selectionStart == null || target.selectionEnd <= target.selectionStart) return null;
      const text = target.value.slice(target.selectionStart, target.selectionEnd);
      if (!text.trim()) return null;
      return { kind: 'plain', target, value: target.value, start: target.selectionStart, end: target.selectionEnd, text };
    }
    const range = selectedRange(target);
    if (!range || range.collapsed) return null;
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
    if (host && belongsToUI(deepActiveElement()) && (!panel.hidden || !trigger.hidden)) return;
    if (current?.automatic && valid(current) && !panel.hidden) return;
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
      else restoreRange(snapshot.target, snapshot.range);
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
    else restoreRange(snapshot.target, snapshot.range);
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
    panel.dataset.source = snapshot.automatic ? 'automatic' : 'selection';
    const unchanged = state === 'result' && snapshot.text.trim() === response.result.corrected;
    const title = state === 'loading' ? 'Checking your writing…' : state === 'result'
      ? unchanged ? 'No changes suggested' : snapshot.automatic ? 'Grammar suggestion' : 'Improve clarity and fix grammar'
      : 'Couldn’t check this text';
    const heading = element('div', 'heading'); heading.append(element('span', '', title));
    const closeButton = button('×', 'close', () => close()); closeButton.setAttribute('aria-label', 'Close suggestion'); heading.append(closeButton);
    const body = element('div', 'body'); body.setAttribute('aria-live', 'polite');
    const actions = element('div', 'actions');
    if (state === 'loading') {
      const message = element('p', 'message'); message.append(element('span', 'spinner'), document.createTextNode('Checking selected text…')); body.append(message);
    } else if (state === 'result') {
      const [correction, removed] = renderDiff(snapshot.text, response.result.corrected);
      body.append(correction);
      const details = element('details', 'change-details');
      details.append(element('summary', '', 'Show changes'), element('p', 'label', 'Original'), element('p', 'text original', snapshot.text));
      if (removed) details.append(removed);
      details.append(element('p', 'message review-note', 'Review before using. The model can still miss errors.'));
      on(details, 'toggle', position);
      body.append(details);
      const replace = button('Replace', 'action', () => replaceSelection(snapshot, response.result.corrected));
      on(replace, 'pointerdown', event => event.preventDefault());
      replace.disabled = unchanged;
      if (unchanged) replace.title = 'No changes to replace';
      actions.append(replace);
      if (snapshot.automatic) actions.append(button('Ignore', 'action secondary', () => { automatic.ignore(snapshot); hide(); }));
      if (snapshot.automatic) {
        const { index, total } = automatic.navigation(snapshot);
        if (index >= 0) {
          const navigation = element('div', 'suggestion-navigation');
          navigation.setAttribute('role', 'group'); navigation.setAttribute('aria-label', 'Suggestion navigation');
          for (const [step, label, disabled] of [[-1, 'Previous suggestion', index === 0], [1, 'Next suggestion', index === total - 1]]) {
            if (step === 1) {
              const count = element('span', 'suggestion-position', `${index + 1} / ${total}`);
              count.setAttribute('role', 'status'); navigation.append(count);
            }
            const arrow = button(step < 0 ? '<' : '>', 'suggestion-nav', () => {
              if (!automatic.navigate(snapshot, step)) return;
              const preferred = panel.querySelector(`.suggestion-nav[data-step="${step}"]`);
              const focus = preferred?.disabled ? panel.querySelector('.suggestion-nav:not(:disabled)') : preferred;
              focus?.focus({ preventScroll: true });
            });
            arrow.dataset.step = String(step); arrow.disabled = disabled;
            arrow.setAttribute('aria-label', label); arrow.title = label;
            on(arrow, 'pointerdown', event => event.preventDefault());
            navigation.append(arrow);
          }
          actions.append(navigation);
        }
      }
    } else {
      body.append(element('p', 'message', response.error));
      if (response.code === 'model-not-loaded') actions.append(button('Open model workspace', 'action', () => send({ type: 'open-workspace' }).catch(() => {})));
      else actions.append(button('Try again', 'action secondary', checkSelection));
    }
    panel.append(heading, body, actions); position();
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
    const snapshot = current;
    // Keyboard activation hides the focused bulb when the card opens. Return
    // focus to the source first so the browser keeps its saved selection.
    if (belongsToUI(deepActiveElement())) {
      snapshot.target.focus({ preventScroll: true });
      if (!valid(snapshot)) { hide(); return; }
      if (snapshot.kind === 'plain') snapshot.target.setSelectionRange(snapshot.start, snapshot.end);
      else restoreRange(snapshot.target, snapshot.range);
    }
    const version = ++requestVersion;
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

  function editableTarget(node) {
    if (!(node instanceof Element)) return null;
    if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
      if (node.disabled || node.readOnly || (node instanceof HTMLInputElement && !['text', 'search', 'url', 'tel'].includes(node.type))) return null;
      return node;
    }
    if (!node.isContentEditable) return null;
    return node.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]');
  }
  function eventEditableTarget(event) {
    return editableTarget(deepActiveElement(event.composedPath()[0]));
  }
  function focusedEditableTarget() {
    const node = deepActiveElement();
    return belongsToUI(node) ? undefined : editableTarget(node);
  }
  function editorText(target) {
    if ('value' in target) return { text: target.value };
    let text = '';
    const nodes = [];
    const newline = () => { if (text && !text.endsWith('\n')) text += '\n'; };
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        nodes.push({ node, start: text.length, end: text.length + node.data.length }); text += node.data; return;
      }
      if (!(node instanceof Element)) return;
      if (node.tagName === 'BR') { text += '\n'; return; }
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || node.getAttribute('contenteditable') === 'false') { newline(); return; }
      const block = /^(block|list-item|table-row|flex|grid)$/.test(style.display);
      if (block) newline();
      for (const child of node.childNodes) walk(child);
      if (block) newline();
    }
    for (const child of target.childNodes) walk(child);
    return { text: text.replace(/\n+$/, ''), nodes };
  }
  function editorSnapshot(target, start, end, data = editorText(target)) {
    if (!editableTarget(target)) return null;
    if ('value' in target) return { kind: 'plain', target, value: target.value, start, end, text: target.value.slice(start, end) };
    const first = data.nodes.find(item => start >= item.start && start < item.end);
    const last = data.nodes.findLast(item => end > item.start && end <= item.end);
    if (!first || !last) return null;
    const range = document.createRange(); range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
    const text = range.toString();
    if (text !== data.text.slice(start, end)) return null;
    return { kind: 'rich', target, value: target.innerText, range, text, start, end };
  }
  function trackEditorVisibility(target) {
    if (visibilityTarget === target) return;
    if (visibilityTarget) visibilityObserver.unobserve(visibilityTarget);
    visibilityTarget = target;
    if (target) visibilityObserver.observe(target);
  }
  function refreshEditorVisibility() {
    if (!visibilityTarget?.isConnected || visibilityFrame) return;
    // Re-observe after movement even when the intersection ratio did not
    // cross a threshold. The callback redraws without re-observing itself.
    visibilityFrame = requestAnimationFrame(() => {
      visibilityFrame = 0;
      if (visibilityTarget?.isConnected) { visibilityObserver.unobserve(visibilityTarget); visibilityObserver.observe(visibilityTarget); }
    });
  }
  function editorRects(snapshot, diagnostic = false) {
    if (!valid(snapshot)) return diagnostic ? { valid: false, raw: [], clipped: [] } : [];
    const target = snapshot.target, box = target.getBoundingClientRect();
    const rectangles = snapshot.kind === 'plain' ? plainAnchor(snapshot, true) : [...snapshot.range.getClientRects()];
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const native = editorVisibility.get(target);
    if (native?.intersecting) {
      clip.left = Math.max(clip.left, box.left + native.insets.left); clip.top = Math.max(clip.top, box.top + native.insets.top);
      clip.right = Math.min(clip.right, box.right - native.insets.right); clip.bottom = Math.min(clip.bottom, box.bottom - native.insets.bottom);
    }
    if (snapshot.kind === 'plain') {
      clip.left = Math.max(clip.left, box.left + target.clientLeft); clip.top = Math.max(clip.top, box.top + target.clientTop);
      clip.right = Math.min(clip.right, box.left + target.clientLeft + target.clientWidth); clip.bottom = Math.min(clip.bottom, box.top + target.clientTop + target.clientHeight);
    }
    // The browser resolves real clipping/containing-block relationships.
    // Walking all overflow ancestors incorrectly clips absolute descendants
    // against wrappers they visibly escape (as in complex comment layouts).
    const clipped = native && !native.intersecting ? [] : rectangles.map(rect => ({ left: Math.max(clip.left, rect.left), right: Math.min(clip.right, rect.right), top: Math.max(clip.top, rect.top), bottom: Math.min(clip.bottom, rect.bottom) }))
      .filter(rect => rect.right > rect.left && rect.bottom - rect.top >= 4);
    if (!diagnostic) return clipped;
    const summarize = rect => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
    return { valid: true, raw: rectangles.slice(0, 4).map(summarize), clip, native: native || null, clipped: clipped.slice(0, 4).map(summarize) };
  }
  function describeElement(node) {
    if (!(node instanceof Element)) return null;
    const basic = { tag: node.localName, type: node instanceof HTMLInputElement ? node.type : undefined };
    if (node instanceof HTMLInputElement && node.type === 'password') return { ...basic, excluded: true };
    const style = getComputedStyle(node), rect = node.getBoundingClientRect();
    const describeRoot = tree => tree instanceof ShadowRoot ? { host: tree.host.localName, mode: tree.mode } : { host: 'document' };
    return { ...basic, id: node.id.slice(0, 100), classes: [...node.classList].slice(0, 6), role: node.getAttribute('role'),
      contentEditable: node.getAttribute('contenteditable'), writable: Boolean(editableTarget(node)), disabled: Boolean(node.disabled), readOnly: Boolean(node.readOnly), inert: node.inert,
      root: describeRoot(node.getRootNode()), display: style.display, visibility: style.visibility, overflow: style.overflow,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, client: { width: node.clientWidth, height: node.clientHeight },
      scroll: { top: node.scrollTop, left: node.scrollLeft },
      textLength: editableTarget(node) ? editorText(node).text.length : undefined,
      selection: node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? { start: node.selectionStart, end: node.selectionEnd } : undefined,
      frame: node instanceof HTMLIFrameElement ? { srcScheme: new URL(node.src || 'about:blank', location.href).protocol, sameOriginDocument: Boolean(node.contentDocument) } : undefined,
    };
  }
  function collectDiagnostics() {
    const focused = deepActiveElement();
    let selected = null, selectionError = null;
    try { selected = readSelection(); } catch (error) { selectionError = error.name; }
    const ancestors = [];
    for (let node = focused; node instanceof Element && ancestors.length < 8; node = composedParent(node)) ancestors.push(describeElement(node));
    const scopes = [document], seen = new Set(), candidates = [];
    for (let tree = focused?.getRootNode(); tree instanceof ShadowRoot; tree = tree.host.getRootNode()) scopes.unshift(tree);
    let visited = 0;
    while (scopes.length && visited < 5000 && seen.size < 40) {
      const scope = scopes.shift(); if (seen.has(scope)) continue; seen.add(scope);
      for (const node of scope.querySelectorAll('*')) {
        if (node === host) continue;
        if (visited++ >= 5000) break;
        if (node.matches('textarea,input,[contenteditable],iframe') && candidates.length < 12) candidates.push(describeElement(node));
        if (node.localName.includes('-')) { const shadow = shadowRootOf(node); if (shadow && shadow !== root) scopes.push(shadow); }
      }
    }
    function uiElement(node) {
      if (!node) return null;
      const style = getComputedStyle(node), rect = node.getBoundingClientRect();
      const hit = !node.hidden && rect.width > 0 && rect.height > 0 ? deepElementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
      return { hidden: Boolean(node.hidden), display: style.display, visibility: style.visibility, opacity: style.opacity, position: style.position,
        pointerEvents: style.pointerEvents, overflow: style.overflow, transform: style.transform, clipPath: style.clipPath,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, hitBelongsToUI: belongsToUI(hit), hitTag: hit?.localName || null };
    }
    return { extensionVersion: chrome.runtime.getManifest().version, hostname: location.hostname, capturedAt: new Date().toISOString(),
      commentTextIncluded: false, documentHidden: document.hidden, observedEvents: { ...observedEvents }, lastScriptError,
      capabilities: { closedRoots: typeof chrome.dom?.openOrClosedShadowRoot === 'function', composedRanges: typeof window.getSelection()?.getComposedRanges === 'function', popover: typeof host?.showPopover === 'function' },
      focused: describeElement(focused), ancestors, selectionError, selection: selected ? { kind: selected.kind, length: selected.text.length, valid: valid(selected) } : null,
      ui: { connected: Boolean(host?.isConnected), state: host?.dataset.state, topLayer: Boolean(host?.matches(':popover-open')), triggerHidden: trigger?.hidden, statusHidden: root?.querySelector('.auto-status')?.hidden,
        viewport: { width: innerWidth, height: innerHeight }, hostStyle: uiElement(host), trigger: uiElement(trigger), status: uiElement(root?.querySelector('.auto-status')),
        underlineSamples: [...(root?.querySelectorAll('.auto-underline') || [])].slice(0, 3).map(uiElement) },
      automatic: automatic?.diagnostics() || { initialized: false }, candidates,
      scanBudget: { visited, roots: seen.size, truncated: Boolean(scopes.length) || visited >= 5000 },
    };
  }
  function diagnosticRequest(message, sender, respond) {
    if (sender.id !== chrome.runtime.id || message?.type !== 'collect-editor-diagnostics') return false;
    try { respond(collectDiagnostics()); }
    catch (error) { respond({ extensionVersion: chrome.runtime.getManifest().version, hostname: location.hostname, commentTextIncluded: false, diagnosticError: error.name, lastScriptError }); }
    return false;
  }
  // Install this before initialization so a broken editor adapter can still
  // explain itself through the toolbar/context-menu diagnostics route.
  chrome.runtime.onMessage.addListener(diagnosticRequest);
  for (const type of Object.keys(observedEvents)) on(window, type, () => { observedEvents[type]++; }, { capture: true });
  on(window, 'error', event => {
    if (event.filename?.startsWith(chrome.runtime.getURL(''))) lastScriptError = { name: event.error?.name || 'Error', file: event.filename.split('/').at(-1), line: event.lineno, time: Date.now() };
  });
  automatic = createAutoChecker({ on, element, button, send, valid, editableTarget, eventEditableTarget, focusedEditableTarget, editorText, editorSnapshot, editorRects, trackEditorVisibility, refreshEditorVisibility, raiseUI, insideUI, controlLayout,
    probeSelection: scan,
    onEditorFocus: listener => { componentFocusListener = listener; on(window, 'focusin', listener, { capture: true }); },
    tools: createWritingTools(diffText),
    ui: () => { ensureUI(); return { host, root }; },
    openSuggestion: (snapshot, corrected, reveal) => {
      hide(); current = snapshot;
      if (reveal) revealSuggestion(snapshot);
      observer = new ResizeObserver(position); observer.observe(snapshot.target);
      render('result', snapshot, { result: { corrected } });
    },
    hideSuggestion: () => { if (current?.automatic) hide(); },
  });

  on(document, 'selectionchange', schedule);
  on(document, 'beforetoggle', event => { if (!insideUI(event)) topLayerDirty = true; }, { capture: true });
  on(document, 'select', schedule, { capture: true });
  on(window, 'pointerup', event => { if (!insideUI(event)) schedule(); }, { capture: true });
  on(window, 'keyup', event => { if (!insideUI(event)) schedule(); }, { capture: true });
  on(document, 'input', event => { if (!insideUI(event) && current) hide(); }, { capture: true });
  on(document, 'pointerdown', event => { if (!insideUI(event)) hide(); }, { capture: true });
  on(document, 'keydown', event => { if (event.key === 'Escape' && current) { event.preventDefault(); close(); } }, { capture: true });
  on(window, 'scroll', position, { capture: true, passive: true });
  on(window, 'resize', position, { passive: true });
})();
