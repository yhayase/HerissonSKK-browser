import { isInputElement, isTextAreaElement, isSelectableInput } from './TextInserter';

export { isInputElement, isTextAreaElement, isSelectableInput };

export interface CaretRect {
  x: number;
  y: number;
  height: number;
  /** 入力要素の余白を除いた、キャレット行の上下端です。 */
  top?: number;
  bottom?: number;
}

let measureCanvas: HTMLCanvasElement | null = null;

function getTextWidth(text: string, font: string): number {
  try {
    if (!measureCanvas) {
      measureCanvas = document.createElement('canvas');
    }
    const ctx = typeof measureCanvas?.getContext === 'function' ? measureCanvas.getContext('2d') : null;
    if (!ctx) return text.length * 8;
    ctx.font = font;
    return ctx.measureText(text).width;
  } catch {
    return text.length * 8;
  }
}

/**
 * Calculates screen (viewport) coordinates of the active caret/cursor.
 */
export function getActiveCaretCoordinates(target?: Element | null): CaretRect | null {
  const active = target ?? document.activeElement;
  if (!active) return null;

  // 1. Check Monaco Editor:
  // Monaco renders its cursor in `.monaco-editor .cursors-layer .cursor`
  const monacoEditor =
    typeof active.closest === 'function'
      ? active.closest('.monaco-editor') || document.querySelector('.monaco-editor.focused')
      : document.querySelector('.monaco-editor.focused');
  if (monacoEditor) {
    const cursor = monacoEditor.querySelector('.cursors-layer .cursor') as HTMLElement | null;
    if (cursor) {
      const rect = cursor.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0 || rect.top > 0 || rect.left > 0) {
        return {
          x: rect.left,
          y: rect.top + (rect.height || 18),
          height: rect.height || 18,
        };
      }
    }
  }

  // 2. Standard HTMLInputElement (single-line)
  if (isInputElement(active)) {
    try {
      const rect = active.getBoundingClientRect();
      const computed = window.getComputedStyle(active);
      const paddingLeft = parseFloat(computed.paddingLeft) || 0;
      const borderLeft = parseFloat(computed.borderLeftWidth) || 0;
      const font = computed.font || `${computed.fontSize} ${computed.fontFamily}`;

      let selectionEnd: number | null = null;
      try {
        if (isSelectableInput(active)) {
          selectionEnd = active.selectionEnd;
        }
      } catch {
        selectionEnd = null;
      }

      const pos = selectionEnd ?? (active.value?.length ?? 0);
      const textBeforeCaret = (active.value ?? '').substring(0, pos);
      const textWidth = getTextWidth(textBeforeCaret, font);

      const caretX = rect.left + borderLeft + paddingLeft + textWidth - (active.scrollLeft || 0);
      // Clamp inside element bounding box
      const clampedX = Math.max(rect.left + borderLeft, Math.min(caretX, rect.right));
      const caretHeight = parseFloat(computed.fontSize) * 1.2 || 18;
      const lineHeight = parseFloat(computed.lineHeight) || caretHeight;
      const paddingTop = parseFloat(computed.paddingTop) || 0;
      const paddingBottom = parseFloat(computed.paddingBottom) || 0;
      const borderTop = parseFloat(computed.borderTopWidth) || 0;
      const borderBottom = parseFloat(computed.borderBottomWidth) || 0;
      const innerTop = rect.top + borderTop + paddingTop;
      const innerBottom = rect.bottom - borderBottom - paddingBottom;
      const lineTop = innerTop + Math.max(0, (innerBottom - innerTop - lineHeight) / 2);

      return {
        x: clampedX,
        y: rect.bottom,
        height: caretHeight,
        top: lineTop,
        bottom: lineTop + lineHeight,
      };
    } catch {
      const rect = active.getBoundingClientRect();
      return {
        x: rect.left,
        y: rect.bottom,
        height: 18,
      };
    }
  }

  // 3. Standard HTMLTextAreaElement (multi-line)
  if (isTextAreaElement(active)) {
    const rect = active.getBoundingClientRect();
    const computed = window.getComputedStyle(active);

    try {
      const mirror = document.createElement('div');
      mirror.style.position = 'fixed';
      mirror.style.top = '0';
      mirror.style.left = '0';
      mirror.style.visibility = 'hidden';
      mirror.style.pointerEvents = 'none';
      mirror.style.whiteSpace = 'pre-wrap';
      mirror.style.wordWrap = 'break-word';
      mirror.style.overflow = 'hidden';

      // Copy relevant styling properties
      const props = [
        'direction', 'boxSizing', 'width', 'borderTopWidth', 'borderRightWidth',
        'borderBottomWidth', 'borderLeftWidth', 'paddingTop', 'paddingRight',
        'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight',
        'fontStretch', 'fontSize', 'lineHeight', 'fontFamily', 'textAlign',
        'textTransform', 'letterSpacing', 'wordSpacing'
      ];
      props.forEach(p => {
        (mirror.style as any)[p] = (computed as any)[p];
      });

      const parsedLineHeight = parseFloat(computed.lineHeight);
      const lineHeight = isNaN(parsedLineHeight) ? (parseFloat(computed.fontSize) * 1.2 || 18) : parsedLineHeight;
      mirror.style.lineHeight = `${lineHeight}px`;

      let pos: number;
      try {
        pos = active.selectionEnd ?? (active.value?.length ?? 0);
      } catch {
        pos = active.value?.length ?? 0;
      }
      mirror.textContent = (active.value ?? '').substring(0, pos);

      const span = document.createElement('span');
      span.textContent = (active.value ?? '').substring(pos) || '.';
      mirror.appendChild(span);

      document.body.appendChild(mirror);
      let caretOffsetLeft = 0;
      let caretOffsetTop = 0;
      try {
        caretOffsetLeft = span.offsetLeft;
        caretOffsetTop = span.offsetTop;
      } finally {
        if (mirror.parentNode) {
          mirror.parentNode.removeChild(mirror);
        }
      }

      const borderLeft = parseFloat(computed.borderLeftWidth) || 0;
      const borderTop = parseFloat(computed.borderTopWidth) || 0;

      const x = rect.left + borderLeft + caretOffsetLeft - (active.scrollLeft || 0);
      const y = rect.top + borderTop + caretOffsetTop - (active.scrollTop || 0) + lineHeight;

      if (!isNaN(x) && !isNaN(y)) {
        return {
          x,
          y,
          height: lineHeight,
        };
      }
    } catch (e) {
      console.warn('[SKK] Caret mirror measurement failed:', e);
    }

    return {
      x: rect.left,
      y: rect.bottom,
      height: 20,
    };
  }

  // 4. ContentEditable or rich text with window.getSelection()
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

  // 5. General fallback to bounding rect of active element
  const rect = active.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.bottom,
    height: rect.height || 20,
  };
}
