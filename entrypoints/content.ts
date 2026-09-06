import { PocEngine } from '@/src/poc/PocEngine';

export default defineContentScript({
  matches: ['<all_urls>', '*://localhost/*', '*://127.0.0.1/*'],
  runAt: 'document_start',
  main() {
    const engine = new PocEngine();

    window.addEventListener(
      'keydown',
      (e) => {
        engine.handleKeyDown(e);
      },
      { capture: true }
    );

    window.addEventListener(
      'focusin',
      () => {
        if (engine.getMode() !== 'ascii') {
          engine.updateHUD(document.activeElement);
        }
      },
      { capture: true }
    );

    // Expose engine to window for automated testing / debugging if needed
    (window as any).__SKK_POC_ENGINE__ = engine;

    console.log('[SKK Extension] Content script loaded successfully.');
  },
});
