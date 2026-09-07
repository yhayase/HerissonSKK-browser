export interface CaretRect {
  x: number;
  y: number;
  height: number;
}

let measureCanvas: HTMLCanvasElement | null = null;

function getTextWidth(text: string, font: string): number {
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas');
  }
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return text.length * 8;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/**
 * Calculates screen (viewport) coordinates of the active caret/cursor.
 */
export function getActiveCaretCoordinates(target?: Element | null): CaretRect | null {
  const active = target ?? document.activeElement;
  if (!active) return null;

  // 1. Check Monaco Editor:
  // Monaco renders its cursor in `.monaco-editor .cursors-layer .cursor`
  const monacoEditor = active.closest('.monaco-editor') || document.querySelector('.monaco-editor.focused');
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
  if (active instanceof HTMLInputElement) {
    const rect = active.getBoundingClientRect();
    const computed = window.getComputedStyle(active);
    const paddingLeft = parseFloat(computed.paddingLeft) || 0;
    const borderLeft = parseFloat(computed.borderLeftWidth) || 0;
    const font = computed.font || `${computed.fontSize} ${computed.fontFamily}`;

    const textBeforeCaret = active.value.substring(0, active.selectionEnd ?? active.value.length);
    const textWidth = getTextWidth(textBeforeCaret, font);

    const caretX = rect.left + borderLeft + paddingLeft + textWidth - active.scrollLeft;
    // Clamp inside element bounding box
    const clampedX = Math.max(rect.left + borderLeft, Math.min(caretX, rect.right));
    const caretHeight = parseFloat(computed.fontSize) * 1.2 || 18;

    return {
      x: clampedX,
      y: rect.bottom,
      height: caretHeight,
    };
  }

  // 3. Standard HTMLTextAreaElement (multi-line)
  if (active instanceof HTMLTextAreaElement) {
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

      const pos = active.selectionEnd ?? active.value.length;
      mirror.textContent = active.value.substring(0, pos);

      const span = document.createElement('span');
      span.textContent = active.value.substring(pos) || '.';
      mirror.appendChild(span);

      document.body.appendChild(mirror);

      const caretOffsetLeft = span.offsetLeft;
      const caretOffsetTop = span.offsetTop;
      document.body.removeChild(mirror);

      const borderLeft = parseFloat(computed.borderLeftWidth) || 0;
      const borderTop = parseFloat(computed.borderTopWidth) || 0;

      const x = rect.left + borderLeft + caretOffsetLeft - active.scrollLeft;
      const y = rect.top + borderTop + caretOffsetTop - active.scrollTop + lineHeight;

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
