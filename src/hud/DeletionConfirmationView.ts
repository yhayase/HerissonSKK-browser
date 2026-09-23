import type { DeletionConfirmation } from '../core/skk/editor/IEditor';

/** HUD と辞書登録画面で共通の、フォーカスを奪わない削除確認表示です。 */
export class DeletionConfirmationView {
  public readonly element: HTMLDivElement;
  private readonly details: HTMLDivElement;
  private readonly warning: HTMLDivElement;
  private readonly error: HTMLDivElement;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'skk-deletion-confirmation';
    this.element.style.cssText = 'display:none;flex-direction:column;gap:3px;font-size:14px;line-height:1.4;white-space:normal;overflow-wrap:anywhere;';
    const title = document.createElement('strong');
    title.textContent = '候補の削除';
    this.details = document.createElement('div');
    const explanation = document.createElement('div');
    explanation.textContent = '個人辞書の登録・学習を削除します。システム辞書の候補は残ります。';
    const guidance = document.createElement('div');
    guidance.textContent = 'Y：削除　N：戻る';
    this.warning = document.createElement('div');
    this.warning.className = 'skk-deletion-warning';
    this.error = document.createElement('div');
    this.error.className = 'skk-deletion-error';
    this.error.style.fontWeight = '700';
    for (const child of [title, this.details, explanation, guidance, this.warning, this.error]) {
      this.element.appendChild(child);
    }
  }

  public update(confirmation?: DeletionConfirmation): void {
    this.element.style.display = confirmation ? 'flex' : 'none';
    this.details.textContent = confirmation
      ? `読み：${confirmation.reading}　候補：${confirmation.candidate}${confirmation.okuri ? `　送り仮名：${confirmation.okuri}` : ''}`
      : '';
    this.warning.textContent = confirmation?.warning ?? '';
    this.warning.style.display = confirmation?.warning ? '' : 'none';
    this.error.textContent = confirmation?.error ?? '';
    this.error.style.display = confirmation?.error ? '' : 'none';
  }
}
