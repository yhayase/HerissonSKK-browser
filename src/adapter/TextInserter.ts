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
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    try {
      const start = active.selectionStart ?? 0;
      const end = active.selectionEnd ?? 0;
      const val = active.value;
      active.value = val.substring(0, start) + text + val.substring(end);
      const newPos = start + text.length;
      active.setSelectionRange(newPos, newPos);
      active.dispatchEvent(new Event('input', { bubbles: true }));
      return { success: true, method: 'fallback-value-replace' };
    } catch (err) {
      console.error('[SKK] fallback input value replacement failed:', err);
    }
  }

  return { success: false, method: 'failed' };
}
