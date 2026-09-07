import { BrowserEditorAdapter } from '@/src/adapter/BrowserEditorAdapter';
import { HiraganaMode } from '@/src/core/skk/input-mode/HiraganaMode';
import { AsciiMode } from '@/src/core/skk/input-mode/AsciiMode';
import { SimpleMemoryJisyoProvider } from '@/src/core/skk/jisyo/SimpleMemoryJisyoProvider';
import { FloatingHUD } from '@/src/hud/FloatingHUD';
import { isInputElement, isTextAreaElement } from '@/src/adapter/TextInserter';

export class SkkContentEngine {
  public adapter: BrowserEditorAdapter;
  public hud: FloatingHUD;
  public jisyoProvider: SimpleMemoryJisyoProvider;

  constructor() {
    this.hud = new FloatingHUD();
    this.jisyoProvider = new SimpleMemoryJisyoProvider();
    this.adapter = new BrowserEditorAdapter(
      this.hud,
      this.jisyoProvider
    );
    this.adapter.setInputMode(AsciiMode.getInstance());
    this.hud.hide();
  }

  public getMode(): string {
    const mode = this.adapter.getCurrentInputMode();
    if (mode instanceof AsciiMode) return 'ascii';
    if (mode instanceof HiraganaMode) return 'hiragana';
    return this.adapter.getModeBadgeText();
  }

  public isTargetEditable(el: Element | null): boolean {
    if (!el) return false;

    if (isInputElement(el)) {
      if (el.readOnly || el.disabled) return false;
      const nonTextTypes = [
        'button',
        'checkbox',
        'color',
        'file',
        'hidden',
        'image',
        'radio',
        'range',
        'reset',
        'submit',
      ];
      return !nonTextTypes.includes((el.type || 'text').toLowerCase());
    }

    if (isTextAreaElement(el)) {
      if (el.readOnly || el.disabled) return false;
      return true;
    }

    if ((el as HTMLElement).isContentEditable) {
      return true;
    }

    if (typeof el.closest === 'function' && el.closest('.monaco-editor')) {
      return true;
    }

    return false;
  }

  public updateHUD(target?: Element | null): void {
    if (target !== undefined) {
      this.adapter.setTargetElement(target);
    }
    const currentMode = this.adapter.getCurrentInputMode();
    if (currentMode instanceof AsciiMode) {
      this.hud.hide();
    } else {
      this.adapter.updateHUD();
    }
  }

  public async handleKeyDown(e: KeyboardEvent): Promise<void> {
    try {
      if (e.isComposing || e.keyCode === 229) {
        return;
      }

      const target = document.activeElement;
      if (!this.isTargetEditable(target)) {
        return;
      }

      this.adapter.setTargetElement(target);

      // 1. Intercept Ctrl+j to toggle between AsciiMode and HiraganaMode
      const isCtrlJ =
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === 'j' || e.code === 'KeyJ');

      if (isCtrlJ) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const mode = this.adapter.getCurrentInputMode();
        const isComposing =
          this.adapter.isInMidashigo() ||
          !!this.adapter.getCurrentCandidate() ||
          !!this.adapter.getRemainingRomaji();

        if (mode instanceof AsciiMode) {
          this.adapter.setInputMode(HiraganaMode.getInstance());
          this.adapter.updateHUD();
        } else if (mode instanceof HiraganaMode) {
          if (isComposing) {
            await mode.ctrlJInput();
            this.adapter.updateHUD();
          } else {
            this.adapter.setInputMode(AsciiMode.getInstance());
            this.hud.hide();
          }
        } else {
          if (isComposing) {
            await mode.ctrlJInput();
            this.adapter.updateHUD();
          } else {
            this.adapter.setInputMode(HiraganaMode.getInstance());
            this.adapter.updateHUD();
          }
        }
        return;
      }

      const mode = this.adapter.getCurrentInputMode();

      // When in AsciiMode: completely pass through all keys (do not preventDefault)
      if (mode instanceof AsciiMode) {
        return;
      }

      // When in SKK mode:
      // Ctrl+g or Escape
      const isCtrlG =
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === 'g' || e.code === 'KeyG');
      const isEscape = e.key === 'Escape';

      if (isCtrlG || isEscape) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        await mode.ctrlGInput();
        this.adapter.updateHUD();
        return;
      }

      // Pass through other shortcuts with Ctrl/Cmd/Alt (e.g. Ctrl+Z, Ctrl+C, Ctrl+V, Ctrl+A)
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      // Space
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        await mode.spaceInput();
        this.adapter.updateHUD();
        return;
      }

      // Enter
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        await mode.enterInput();
        this.adapter.updateHUD();
        return;
      }

      // Backspace
      if (e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        await mode.backspaceInput();
        this.adapter.updateHUD();
        return;
      }

      // Single character keys
      if (e.key.length === 1) {
        const char = e.key;

        // Lowercase letters (a-z)
        if (/^[a-z]$/.test(char)) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          await mode.lowerAlphabetInput(char);
          if (this.adapter.getCurrentInputMode() instanceof AsciiMode) {
            this.hud.hide();
          } else {
            this.adapter.updateHUD();
          }
          return;
        }

        // Uppercase letters (A-Z)
        if (/^[A-Z]$/.test(char)) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          await mode.upperAlphabetInput(char);
          if (this.adapter.getCurrentInputMode() instanceof AsciiMode) {
            this.hud.hide();
          } else {
            this.adapter.updateHUD();
          }
          return;
        }

        // Numbers (0-9)
        if (/^[0-9]$/.test(char)) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          await mode.numberInput(char);
          this.adapter.updateHUD();
          return;
        }

        // Symbols (e.g. >, /, ., ,, ;, etc.)
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        await mode.symbolInput(char);
        this.adapter.updateHUD();
        return;
      }
    } catch (err) {
      console.error('[SKK] Keydown error:', err);
    }
  }
}

export default defineContentScript({
  matches: ['<all_urls>', '*://localhost/*', '*://127.0.0.1/*'],
  runAt: 'document_start',
  main() {
    const engine = new SkkContentEngine();

    window.addEventListener(
      'keydown',
      (e) => {
        engine.handleKeyDown(e);
      },
      { capture: true }
    );

    const updateActiveTarget = () => {
      const target = document.activeElement;
      engine.adapter.setTargetElement(target);
      if (!(engine.adapter.getCurrentInputMode() instanceof AsciiMode)) {
        engine.adapter.updateHUD();
      } else {
        engine.hud.hide();
      }
    };

    window.addEventListener('focusin', updateActiveTarget, { capture: true });
    document.addEventListener('selectionchange', updateActiveTarget, { capture: true });

    // Expose engine / adapter to window.__SKK_ENGINE__ for test inspection
    (window as any).__SKK_ENGINE__ = engine;
    (window as any).__SKK_POC_ENGINE__ = engine;

    console.log('[SKK Extension] Content script loaded successfully.');
  },
});
