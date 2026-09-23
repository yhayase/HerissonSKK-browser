export default defineContentScript({
  matches: [
    '*://vscode.dev/*',
    '*://*.vscode.dev/*',
    '*://github.dev/*',
    '*://*.github.dev/*',
    '*://*.github.com/*',
  ],
  allFrames: true,
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    try {
      delete (window as any).EditContext;
    } catch {
      try {
        (window as any).EditContext = undefined;
      } catch {}
    }
    console.log('[SKK Extension] Monaco compatibility mode initialized (EditContext bypassed).');
  },
});
