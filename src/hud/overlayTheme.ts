/**
 * HUDと辞書登録ダイアログで共有する配色トークンです。
 * ページ側のテーマには依存せず、ブラウザーの配色設定だけを利用します。
 */
export const OVERLAY_THEME_CSS = `
  :host {
    --skk-overlay-surface: #ffffff;
    --skk-overlay-text: #1f2937;
    --skk-overlay-muted: #475569;
    --skk-overlay-border: #cbd5e1;
    --skk-overlay-input: #f8fafc;
    --skk-overlay-mode: #bfdbfe;
    --skk-overlay-mode-text: #172554;
    --skk-overlay-register: #fed7aa;
    --skk-overlay-register-text: #7c2d12;
    --skk-overlay-preedit: #075985;
    --skk-overlay-candidate: #166534;
    --skk-overlay-candidate-text: #052e16;
    --skk-overlay-candidate-badge: #bbf7d0;
    --skk-overlay-backdrop: rgba(15, 23, 42, 0.42);
    --skk-overlay-shadow: rgba(15, 23, 42, 0.24);
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --skk-overlay-surface: #1e293b;
      --skk-overlay-text: #f8fafc;
      --skk-overlay-muted: #cbd5e1;
      --skk-overlay-border: #64748b;
      --skk-overlay-input: #0f172a;
      --skk-overlay-mode: #60a5fa;
      --skk-overlay-mode-text: #172554;
      --skk-overlay-register: #fdba74;
      --skk-overlay-register-text: #431407;
      --skk-overlay-preedit: #7dd3fc;
      --skk-overlay-candidate: #86efac;
      --skk-overlay-candidate-text: #052e16;
      --skk-overlay-candidate-badge: #86efac;
      --skk-overlay-backdrop: rgba(2, 6, 23, 0.62);
      --skk-overlay-shadow: rgba(0, 0, 0, 0.52);
    }
  }
`;

export const OVERLAY_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, "Noto Sans CJK JP", "Noto Sans JP", sans-serif';
