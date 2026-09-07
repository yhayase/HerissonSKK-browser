/**
 * Cross-realm safe check for HTMLInputElement.
 */
export function isInputElement(target: unknown): target is HTMLInputElement {
  if (target == null || typeof target !== 'object') {
    return false;
  }
  if ('tagName' in target) {
    const tag = (target as Element).tagName;
    if (typeof tag === 'string' && tag.toUpperCase() === 'INPUT') {
      return true;
    }
  }
  return typeof HTMLInputElement !== 'undefined' && target instanceof HTMLInputElement;
}

/**
 * Cross-realm safe check for HTMLTextAreaElement.
 */
export function isTextAreaElement(target: unknown): target is HTMLTextAreaElement {
  if (target == null || typeof target !== 'object') {
    return false;
  }
  if ('tagName' in target) {
    const tag = (target as Element).tagName;
    if (typeof tag === 'string' && tag.toUpperCase() === 'TEXTAREA') {
      return true;
    }
  }
  return typeof HTMLTextAreaElement !== 'undefined' && target instanceof HTMLTextAreaElement;
}

/**
 * Determines whether an input element supports selectionStart/selectionEnd/setSelectionRange.
 * Non-text input types like email, number, date, range, etc. throw InvalidStateError in modern browsers.
 */
export function isSelectableInput(el: HTMLInputElement): boolean {
  try {
    const type = (el.type || 'text').toLowerCase();
    return ['text', 'search', 'url', 'tel', 'password'].includes(type);
  } catch {
    return false;
  }
}

/**
 * Synthetic text insertion helper using document.execCommand('insertText').
 * This triggers browser-native beforeinput / input events, ensuring compatibility
 * with rich text editors (ProseMirror, Lexical, Monaco) and maintaining undo history.
 */
export function insertText(text: string): { success: boolean; method: string } {
  const active = document.activeElement;
  if (!active) {
    return { success: false, method: 'no-active-element' };
  }

  // Primary method: document.execCommand('insertText')
  try {
    const success = document.execCommand('insertText', false, text);
    if (success) {
      return { success: true, method: 'execCommand' };
    }
  } catch (err) {
    console.warn('[SKK] execCommand failed:', err);
  }

  // Fallback for standard HTMLInputElement / HTMLTextAreaElement if execCommand is ever rejected
  if (isInputElement(active) || isTextAreaElement(active)) {
    try {
      let start: number | null = null;
      let end: number | null = null;
      let canSelect = false;

      if (isTextAreaElement(active) || isSelectableInput(active)) {
        try {
          start = active.selectionStart;
          end = active.selectionEnd;
          canSelect = true;
        } catch {
          canSelect = false;
        }
      }

      const val = active.value ?? '';
      if (canSelect && start !== null && end !== null) {
        active.value = val.substring(0, start) + text + val.substring(end);
        const newPos = start + text.length;
        try {
          active.setSelectionRange(newPos, newPos);
        } catch {}
      } else {
        active.value = val + text;
      }
      active.dispatchEvent(new Event('input', { bubbles: true }));
      return { success: true, method: 'fallback-value-replace' };
    } catch (err) {
      console.error('[SKK] fallback input value replacement failed:', err);
    }
  }

  return { success: false, method: 'failed' };
}

