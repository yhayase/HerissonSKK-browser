import { BrowserEditorAdapter } from '@/src/adapter/BrowserEditorAdapter';
import { HiraganaMode } from '@/src/core/skk/input-mode/HiraganaMode';
import { AbstractKanaMode } from '@/src/core/skk/input-mode/AbstractKanaMode';
import { AsciiMode } from '@/src/core/skk/input-mode/AsciiMode';
import { RegistrationMode } from '@/src/core/skk/input-mode/henkan/RegistrationMode';
import { CandidateDeletionMode } from '@/src/core/skk/input-mode/henkan/CandidateDeletionMode';
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
  private pendingKeyActions = 0;
  private pendingKanaActivation = 0;
  private focusGeneration = 0;

  private getDeletionMode(): CandidateDeletionMode | null {
    const inputMode = this.adapter.getCurrentInputMode();
    const kanaMode = inputMode instanceof RegistrationMode ? inputMode.getInternalMode() : inputMode;
    if (!(kanaMode instanceof AbstractKanaMode)) return null;
    const henkanMode = kanaMode.getHenkanMode();
    return henkanMode instanceof CandidateDeletionMode ? henkanMode : null;
  }

  public invalidateQueuedKeys(): void {
    this.focusGeneration++;
    this.pendingKanaActivation = 0;
  }

  public cancelDeletionOnWindowBlur(): void {
    if (this.getDeletionMode()) void this.adapter.cancelComposition();
  }

  public cancelDeletionOnModalFocusDeparture(target: Element | null, modal: RegistrationModal): void {
    if (target !== modal.getActiveInputElement() && this.getDeletionMode()) {
      void this.adapter.cancelComposition();
    }
  }

  public enqueueKeyAction(action: () => Promise<void>): Promise<void> {
    const target = getDeepActiveElement(document);
    const focusGeneration = this.focusGeneration;
    const deletionMode = this.getDeletionMode();
    this.pendingKeyActions++;
    this.keyQueue = this.keyQueue
      .then(async () => {
        await this.isInitializedPromise;
        // 辞書待機中に別の入力欄やフレームへ移ったキーは転記しません。
        if (focusGeneration !== this.focusGeneration || target !== getDeepActiveElement(document) || document.hasFocus?.() === false) return;
        if (deletionMode && (this.getDeletionMode() !== deletionMode || deletionMode.isDeleting())) return;
        await action();
      })
      .catch((err) => {
        console.error('[SKK] Key processing error:', err);
      })
      .finally(() => {
        this.pendingKeyActions--;
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
      if (!e.isTrusted) {
        return;
      }

      if (e.isComposing || e.keyCode === 229) {
        return;
      }

      const activeModal = RegistrationModal.getActiveModal();
      const isModalActive = activeModal?.isOpen() ?? false;
      const target = getDeepActiveElement(document);
      if (isModalActive && activeModal && target !== activeModal.getActiveInputElement()) {
        this.cancelDeletionOnModalFocusDeparture(target, activeModal);
        return;
      }

      // Focus trap for modal: prevent tabbing away from the modal dialog
      if (isModalActive && e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }

      if (!this.isTargetEditable(target)) {
        return;
      }

      if (!isModalActive) {
        this.adapter.setTargetElement(target);
      }

      // 保存処理を受け付けた後のキーを、完了後の新しい入力状態へ転送しません。
      if (this.getDeletionMode()?.isDeleting() && e.key !== 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }

      // Ctrl+j はかな入力の開始・確定に使い、かな種別は切り替えません。
      const isCtrlJ =
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === 'j' || e.code === 'KeyJ');

      if (isCtrlJ) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // 辞書の起動を待つ間も、直後の文字キーをかな入力として受け付けます。
        if (this.adapter.getCurrentInputMode() instanceof AsciiMode && this.pendingKeyActions === 0) {
          this.adapter.setInputMode(HiraganaMode.getInstance(this.adapter));
          this.adapter.updateHUD();
          return;
        }

        const focusGeneration = this.focusGeneration;
        this.pendingKanaActivation++;
        try {
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
            } else if (mode instanceof AbstractKanaMode) {
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
        } finally {
          if (focusGeneration === this.focusGeneration) this.pendingKanaActivation--;
        }
        return;
      }

      const mode = this.adapter.getCurrentInputMode();

      // When in AsciiMode: completely pass through all keys (do not preventDefault)
      if (mode instanceof AsciiMode && this.pendingKanaActivation === 0) {
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
          if (isEscape && this.adapter.handleCandidateListKey('Escape')) return;
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

      if (e.key.startsWith('Arrow') && this.adapter.isAnnotationHelpActive()) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        await this.enqueueKeyAction(async () => { this.adapter.handleCandidateListKey(e.key); });
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
  allFrames: true,
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  runAt: 'document_start',
  async main() {
    // 入力欄のない埋め込み文書では、HUD と辞書接続を生成しません。
    let engine: SkkContentEngine | null = window === window.top ? new SkkContentEngine() : null;
    const ensureEngine = (): SkkContentEngine => {
      if (!engine) {
        engine = new SkkContentEngine();
        exposeEngine(engine);
      }
      return engine;
    };
    const exposeEngine = (activeEngine: SkkContentEngine): void => {
      // テストと開発時の状態確認に使います。
      (window as any).__SKK_ENGINE__ = activeEngine;
      (window as any).__SKK_POC_ENGINE__ = activeEngine;
      void activeEngine.isInitializedPromise.then(() => {
        document.documentElement?.setAttribute('data-skk-initialized', 'true');
        console.log('[SKK Extension] Content script loaded successfully.');
      });
    };
    if (engine) exposeEngine(engine);

    window.addEventListener(
      'keydown',
      (e) => {
        if (!e.isTrusted) return;
        if (!engine && !isTargetEditable(getDeepActiveElement(document))) return;
        void ensureEngine().handleKeyDown(e);
      },
      { capture: true }
    );

    const updateActiveTarget = (e?: Event) => {
      if (e && !e.isTrusted) {
        return;
      }
      const activeModal = RegistrationModal.getActiveModal();
      if (activeModal?.isOpen()) {
        engine?.cancelDeletionOnModalFocusDeparture(getDeepActiveElement(document), activeModal);
        return;
      }
      const target = getDeepActiveElement(document);
      if (!engine && !isTargetEditable(target)) return;
      const activeEngine = ensureEngine();
      activeEngine.adapter.setTargetElement(target);
      activeEngine.adapter.updateHUD();
    };

    window.addEventListener('focusin', updateActiveTarget, { capture: true });
    window.addEventListener('blur', () => {
      engine?.invalidateQueuedKeys();
      engine?.cancelDeletionOnWindowBlur();
      engine?.hud.hide();
    });
    const refreshOverlay = () => engine?.adapter.refreshOverlayGeometry();
    window.addEventListener('resize', refreshOverlay);
    window.addEventListener('scroll', refreshOverlay, { capture: true, passive: true });
    window.visualViewport?.addEventListener('resize', refreshOverlay);
    window.visualViewport?.addEventListener('scroll', refreshOverlay);
    window.addEventListener('focusout', (e) => {
      if (!e.isTrusted) return;
      engine?.invalidateQueuedKeys();
      setTimeout(() => updateActiveTarget(), 0);
    }, { capture: true });
    document.addEventListener('selectionchange', (e) => {
      if (e && !e.isTrusted) return;
      updateActiveTarget();
    }, { capture: true });
    window.addEventListener('pointerdown', (e) => {
      if (!e.isTrusted) return;
      setTimeout(() => updateActiveTarget(), 0);
    }, { capture: true });

  },
});
