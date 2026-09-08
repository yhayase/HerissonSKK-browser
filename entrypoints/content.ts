import { BrowserEditorAdapter } from '@/src/adapter/BrowserEditorAdapter';
import { HiraganaMode } from '@/src/core/skk/input-mode/HiraganaMode';
import { AsciiMode } from '@/src/core/skk/input-mode/AsciiMode';
import { RegistrationMode } from '@/src/core/skk/input-mode/henkan/RegistrationMode';
import { CompositeJisyoProvider } from '@/src/core/skk/jisyo/CompositeJisyoProvider';
import type { IJisyoStorage, IUserJisyoStorage } from '@/src/core/skk/jisyo/IJisyoStorage';
import { RemoteJisyoStore } from '@/src/storage/jisyo/RemoteJisyoStore';
import { RemoteUserStore } from '@/src/storage/user-jisyo/RemoteUserStore';
import { RuntimeMessageSync } from '@/src/storage/sync/RuntimeMessageSync';
import { isRuntimeAvailable, sendRuntimeMessage } from '@/src/storage/rpc/runtimeClient';
import { FloatingHUD } from '@/src/hud/FloatingHUD';
import { RegistrationModal } from '@/src/hud/RegistrationModal';
import { isInputElement, isTextAreaElement } from '@/src/adapter/TextInserter';
import { getDeepActiveElement, isTargetEditable } from '@/src/adapter/DOMUtils';

export class SkkContentEngine {
  public adapter: BrowserEditorAdapter;
  public hud: FloatingHUD;
  public jisyoProvider: CompositeJisyoProvider;
  public systemStore: IJisyoStorage;
  public userStore: IUserJisyoStorage;
  public syncNotifier: RuntimeMessageSync;
  public isInitializedPromise: Promise<void>;

  constructor() {
    this.hud = new FloatingHUD();
    this.syncNotifier = new RuntimeMessageSync();
    this.systemStore = new RemoteJisyoStore();
    this.userStore = new RemoteUserStore({ senderId: this.syncNotifier.getSenderId() });

    this.jisyoProvider = new CompositeJisyoProvider(
      this.userStore,
      [this.systemStore],
      this.syncNotifier
    );

    this.adapter = new BrowserEditorAdapter(
      this.hud,
      this.jisyoProvider
    );
    this.adapter.setInputMode(AsciiMode.getInstance(this.adapter));
    this.hud.hide();

    this.isInitializedPromise = this.initDictionary();
  }

  public async initDictionary(): Promise<void> {
    if (!isRuntimeAvailable()) {
      return;
    }
    try {
      await sendRuntimeMessage({ type: 'SKK_WAIT_READY' });
    } catch (err) {
      console.warn('[SKK] Background dictionary readiness ping error:', err);
    }
  }

  public getMode(): string {
    const mode = this.adapter.getCurrentInputMode();
    if (mode instanceof AsciiMode) return 'ascii';
    if (mode instanceof HiraganaMode) return 'hiragana';
    return this.adapter.getModeBadgeText();
  }

  public isTargetEditable(el: Element | null): boolean {
    return isTargetEditable(el);
  }

  private keyQueue: Promise<void> = Promise.resolve();

  public enqueueKeyAction(action: () => Promise<void>): Promise<void> {
    this.keyQueue = this.keyQueue
      .then(async () => {
        await this.isInitializedPromise;
        await action();
      })
      .catch((err) => {
        console.error('[SKK] Key processing error:', err);
      });
    return this.keyQueue;
  }

  public updateHUD(target?: Element | null): void {
    if (target !== undefined) {
      this.adapter.setTargetElement(target);
    }
    this.adapter.updateHUD();
  }

  public async handleKeyDown(e: KeyboardEvent): Promise<void> {
    try {
      if (e.isComposing || e.keyCode === 229) {
        return;
      }

      const activeModal = RegistrationModal.getActiveModal();
      const isModalActive = activeModal?.isOpen() ?? false;

      // Focus trap for modal: prevent tabbing away from the modal dialog
      if (isModalActive && e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }

      const target = getDeepActiveElement(document);
      if (!this.isTargetEditable(target)) {
        return;
      }

      if (!isModalActive) {
        this.adapter.setTargetElement(target);
      }

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

        await this.enqueueKeyAction(async () => {
          const mode = this.adapter.getCurrentInputMode();
          if (mode instanceof RegistrationMode) {
            await mode.ctrlJInput();
            this.adapter.updateHUD();
            return;
          }

          const isComposing =
            this.adapter.isInMidashigo() ||
            !!this.adapter.getCurrentCandidate() ||
            !!this.adapter.getRemainingRomaji();

          if (mode instanceof AsciiMode) {
            this.adapter.setInputMode(HiraganaMode.getInstance(this.adapter));
          } else if (mode instanceof HiraganaMode) {
            if (isComposing) {
              await mode.ctrlJInput();
            }
            this.adapter.updateHUD();
          } else {
            if (isComposing) {
              await mode.ctrlJInput();
              this.adapter.updateHUD();
            } else {
              this.adapter.setInputMode(HiraganaMode.getInstance(this.adapter));
            }
          }
        });
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
        await this.enqueueKeyAction(async () => {
          const currentMode = this.adapter.getCurrentInputMode();
          await currentMode.ctrlGInput();
          this.adapter.updateHUD();
        });
        return;
      }

      // Pass through other shortcuts with Ctrl/Cmd/Alt (e.g. Ctrl+Z, Ctrl+C, Ctrl+V, Ctrl+A)
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      // Allow native caret movement & navigation keys in modal when not composing
      if (isModalActive && mode instanceof RegistrationMode) {
        const mb = mode.getMiniBufferEditor();
        const isComposingInModal =
          mb.isInMidashigo() ||
          !!mb.getCurrentCandidate() ||
          !!mb.getRemainingRomaji();

        if (!isComposingInModal) {
          const navKeys = [
            'ArrowLeft',
            'ArrowRight',
            'ArrowUp',
            'ArrowDown',
            'Home',
            'End',
            'PageUp',
            'PageDown',
            'Delete',
          ];
          if (navKeys.includes(e.key)) {
            return;
          }
        }
      }

      // Space
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        await this.enqueueKeyAction(async () => {
          const currentMode = this.adapter.getCurrentInputMode();
          await currentMode.spaceInput();
          this.adapter.updateHUD();
        });
        return;
      }

      // Enter
      if (e.key === 'Enter') {
        const isComposing =
          mode instanceof RegistrationMode ||
          this.adapter.isInMidashigo() ||
          !!this.adapter.getCurrentCandidate() ||
          !!this.adapter.getRemainingRomaji();

        if (isComposing) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          await this.enqueueKeyAction(async () => {
            const currentMode = this.adapter.getCurrentInputMode();
            await currentMode.enterInput();
            this.adapter.updateHUD();
          });
          return;
        }
        return;
      }

      // Backspace
      if (e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        await this.enqueueKeyAction(async () => {
          const currentMode = this.adapter.getCurrentInputMode();
          await currentMode.backspaceInput();
          this.adapter.updateHUD();
        });
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
          await this.enqueueKeyAction(async () => {
            const currentMode = this.adapter.getCurrentInputMode();
            await currentMode.lowerAlphabetInput(char);
            this.adapter.updateHUD();
          });
          return;
        }

        // Uppercase letters (A-Z)
        if (/^[A-Z]$/.test(char)) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          await this.enqueueKeyAction(async () => {
            const currentMode = this.adapter.getCurrentInputMode();
            await currentMode.upperAlphabetInput(char);
            this.adapter.updateHUD();
          });
          return;
        }

        // Numbers (0-9)
        if (/^[0-9]$/.test(char)) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          await this.enqueueKeyAction(async () => {
            const currentMode = this.adapter.getCurrentInputMode();
            await currentMode.numberInput(char);
            this.adapter.updateHUD();
          });
          return;
        }

        // Symbols (e.g. >, /, ., ,, ;, etc.)
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        await this.enqueueKeyAction(async () => {
          const currentMode = this.adapter.getCurrentInputMode();
          await currentMode.symbolInput(char);
          this.adapter.updateHUD();
        });
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
  async main() {
    const engine = new SkkContentEngine();

    window.addEventListener(
      'keydown',
      (e) => {
        engine.handleKeyDown(e);
      },
      { capture: true }
    );

    const updateActiveTarget = () => {
      if (RegistrationModal.getActiveModal()?.isOpen()) {
        return;
      }
      const target = getDeepActiveElement(document);
      engine.adapter.setTargetElement(target);
      engine.adapter.updateHUD();
    };

    window.addEventListener('focusin', updateActiveTarget, { capture: true });
    window.addEventListener('focusout', () => {
      setTimeout(updateActiveTarget, 0);
    }, { capture: true });
    document.addEventListener('selectionchange', updateActiveTarget, { capture: true });
    window.addEventListener('pointerdown', () => {
      setTimeout(updateActiveTarget, 0);
    }, { capture: true });

    // Expose engine / adapter to window.__SKK_ENGINE__ for test inspection
    (window as any).__SKK_ENGINE__ = engine;
    (window as any).__SKK_POC_ENGINE__ = engine;

    await engine.isInitializedPromise;
    document.documentElement.setAttribute('data-skk-initialized', 'true');

    console.log('[SKK Extension] Content script loaded successfully.');
  },
});
