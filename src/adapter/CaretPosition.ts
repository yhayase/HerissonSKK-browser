import getCaretCoordinates from 'textarea-caret';

export interface CaretRect {
  x: number;
  y: number;
  height: number;
}

/**
 * Calculates screen (viewport) coordinates of the active caret/cursor.
 */
export function getActiveCaretCoordinates(target?: Element | null): CaretRect | null {
  const active = target ?? document.activeElement;
  if (!active) return null;

  // 1. Check Monaco Editor:
  // Monaco renders its cursor in `.monaco-editor .cursors-layer .cursor`
  // The active element in Monaco is typically `<textarea class="inputarea">` inside `.monaco-editor`
  const monacoEditor = active.closest('.monaco-editor') || document.querySelector('.monaco-editor.focused');
  if (monacoEditor) {
    const cursor = monacoEditor.querySelector('.cursors-layer .cursor') as HTMLElement | null;
    if (cursor) {
      const rect = cursor.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0 || rect.top > 0 || rect.left > 0) {
        return {
          x: rect.left,
          y: rect.top + rect.height,
          height: rect.height || 18,
        };
      }
    }
  }

  // 2. Standard HTMLInputElement or HTMLTextAreaElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    try {
      const selectionEnd = active.selectionEnd ?? 0;
      const caret = getCaretCoordinates(active, selectionEnd);
      const rect = active.getBoundingClientRect();
      return {
        x: rect.left + caret.left - active.scrollLeft,
        y: rect.top + caret.top - active.scrollTop + caret.height,
        height: caret.height,
      };
    } catch {
      // Fallback if textarea-caret fails (e.g. some input types)
      const rect = active.getBoundingClientRect();
      return {
        x: rect.left,
        y: rect.bottom,
        height: 20,
      };
    }
  }

  // 3. ContentEditable or rich text with window.getSelection()
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0 || rect.top > 0 || rect.left > 0) {
      return {
        x: rect.left,
        y: rect.bottom,
        height: rect.height || 18,
      };
    }
  }

  // 4. General fallback to bounding rect of active element
  const rect = active.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.bottom,
    height: rect.height,
  };
}
