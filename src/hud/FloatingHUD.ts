import { CandidateListView, type CandidateListState } from './CandidateListView';
import { computeOverlayLayout, type OverlayLayout, type OverlayViewport } from './OverlayLayout';
import type { CandidateListOptions, DeletionConfirmation } from '../core/skk/editor/IEditor';
import { DeletionConfirmationView } from './DeletionConfirmationView';
import { OVERLAY_FONT_FAMILY, OVERLAY_THEME_CSS } from './overlayTheme';

export interface HUDState {
  x: number;
  y: number;
  mode: string;
  caretTop?: number;
  candidateList?: CandidateListState;
  candidateOptions?: CandidateListOptions;
  preedit?: string;
  candidate?: string;
  status?: string;
  deletionConfirmation?: DeletionConfirmation;
}

export class FloatingHUD {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private container: HTMLDivElement | null = null;
  private badgeEl: HTMLSpanElement | null = null;
  private preeditEl: HTMLSpanElement | null = null;
  private candidateEl: HTMLSpanElement | null = null;
  private statusEl: HTMLSpanElement | null = null;
  private isVisible: boolean = false;
  private lastState: HUDState | null = null;
  private candidateListView: CandidateListView | null = null;
  private previousLayout?: OverlayLayout;
  private deletionView: DeletionConfirmationView | null = null;

  constructor() {
    this.init();
  }

  private init() {
    if (typeof document === 'undefined') {
      return;
    }
    if (document.getElementById('skk-browser-ext-hud-root')) {
      return;
    }

    this.host = document.createElement('div');
    this.host.id = 'skk-browser-ext-hud-root';
    this.host.lang = 'ja';
    this.host.style.position = 'absolute';
    this.host.style.top = '0';
    this.host.style.left = '0';
    this.host.style.width = '0';
    this.host.style.height = '0';
    this.host.style.zIndex = '2147483647';
    this.host.style.pointerEvents = 'none';

    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
      }
      ${OVERLAY_THEME_CSS}
      .skk-hud-box {
        position: fixed;
        display: inline-flex;
        flex-direction: column;
        align-items: stretch;
        box-sizing: border-box;
        overflow: auto;
        gap: 4px;
        background: var(--skk-overlay-surface);
        color: var(--skk-overlay-text);
        font-family: ${OVERLAY_FONT_FAMILY};
        font-size: 18px;
        line-height: 1.4;
        padding: 4px 10px;
        border-radius: 6px;
        box-shadow: 0 4px 16px var(--skk-overlay-shadow), 0 0 0 1px var(--skk-overlay-border);
        pointer-events: auto;
        user-select: none;
        max-width: calc(100vw - 16px);
        white-space: normal;
        overflow-wrap: anywhere;

        transition: opacity 0.12s ease-out;
        z-index: 2147483647;
      }
      .skk-hud-header { display: flex; align-items: baseline; gap: 6px; min-width: 0; flex-wrap: wrap; flex-shrink: 0; }
      .skk-mode-badge {
        background: var(--skk-overlay-mode);
        color: var(--skk-overlay-mode-text);
        font-weight: 700;
        font-size: 14px;
        padding: 1px 6px;
        border-radius: 4px;
        letter-spacing: 0.5px;
      }
      .skk-preedit {
        min-width: 0;
        max-width: 100%;
        white-space: nowrap;
        overflow-x: auto;
        color: var(--skk-overlay-preedit);
        font-weight: 500;
      }
      .skk-candidate {
        color: var(--skk-overlay-candidate);
        font-weight: 700;
      }
      .skk-status {
        color: var(--skk-overlay-muted);
        font-size: 14px;
        margin-left: 4px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .skk-hidden {
        opacity: 0;
        transform: translateY(0);
        pointer-events: none;
        display: none !important;
      }
    `;

    this.container = document.createElement('div');
    this.container.className = 'skk-hud-box skk-hidden';
    this.container.addEventListener('pointerdown', event => event.preventDefault());

    this.badgeEl = document.createElement('span');
    this.badgeEl.className = 'skk-mode-badge';
    this.badgeEl.textContent = 'かな';

    this.preeditEl = document.createElement('span');
    this.preeditEl.className = 'skk-preedit';

    this.candidateEl = document.createElement('span');
    this.candidateEl.className = 'skk-candidate';

    this.statusEl = document.createElement('span');
    this.statusEl.className = 'skk-status';

    const header = document.createElement('div');
    header.className = 'skk-hud-header';
    header.appendChild(this.badgeEl);
    header.appendChild(this.preeditEl);
    header.appendChild(this.candidateEl);
    header.appendChild(this.statusEl);
    this.container.appendChild(header);
    this.deletionView = new DeletionConfirmationView();
    this.container.appendChild(this.deletionView.element);

    this.shadow.appendChild(style);
    this.shadow.appendChild(this.container);

    const append = () => {
      this.ensureMount();
    };

    if (document.body) {
      append();
    } else {
      document.addEventListener('DOMContentLoaded', append, { once: true });
    }

    document.addEventListener('fullscreenchange', () => this.ensureMount());
    document.addEventListener('webkitfullscreenchange', () => this.ensureMount());
  }

  private ensureMount() {
    if (!this.host) return;
    const targetParent = document.fullscreenElement || document.body || document.documentElement;
    if (targetParent && this.host.parentElement !== targetParent) {
      targetParent.appendChild(this.host);
    }
  }

  public update(state: HUDState) {
    if (!!this.lastState?.candidateList !== !!state.candidateList || (!state.candidate && !state.candidateList && !state.preedit)) {
      this.previousLayout = undefined;
    }
    this.lastState = { ...state };
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      this.isVisible = true;
      return;
    }
    if (!this.container || !this.badgeEl || !this.preeditEl || !this.candidateEl || !this.statusEl) {
      this.init();
    }
    if (!this.container) return;

    this.ensureMount();

    this.badgeEl!.textContent = state.mode;
    if (state.mode === '辞書登録' || state.mode === '再帰登録') {
      this.badgeEl!.style.background = 'var(--skk-overlay-register)';
      this.badgeEl!.style.color = 'var(--skk-overlay-register-text)';
    } else if (state.mode === 'カナ') {
      this.badgeEl!.style.background = 'var(--skk-overlay-candidate-badge)';
      this.badgeEl!.style.color = 'var(--skk-overlay-candidate-text)';
    } else if (state.mode === '全英') {
      this.badgeEl!.style.background = 'var(--skk-overlay-register)';
      this.badgeEl!.style.color = 'var(--skk-overlay-register-text)';
    } else {
      this.badgeEl!.style.background = 'var(--skk-overlay-mode)';
      this.badgeEl!.style.color = 'var(--skk-overlay-mode-text)';
    }

    this.preeditEl!.textContent = state.preedit || '';
    this.candidateEl!.textContent = state.candidate ? `▼${state.candidate}` : '';
    this.statusEl!.textContent = state.status || '';
    this.deletionView?.update(state.deletionConfirmation);

    const viewport = getOverlayViewport();
    const initial = computeOverlayLayout({
      viewport, caret: { x: state.x, top: state.caretTop ?? state.y - 18, bottom: state.y },
      desiredWidth: state.candidateList ? 520 : 360, rowHeight: 1, annotationHeight: 0,
      chromeHeight: 0, candidateCount: 0,
    });
    // 候補一覧は表示中ページの実寸を使い、上限を超えたときだけ制限します。
    this.container.style.width = 'max-content';
    this.container.style.maxWidth = `${initial.width}px`;
    this.container.style.padding = `4px ${Math.min(10, initial.width / 4)}px`;
    this.container.style.height = 'auto';
    this.container.style.maxHeight = 'none';
    this.container.classList.remove('skk-hidden');
    if (state.candidateList && !this.candidateListView) {
      this.candidateListView = new CandidateListView();
      this.candidateListView.element.style.flexShrink = '0';
      this.container.appendChild(this.candidateListView.element);
    }
    if (this.candidateListView) {
      this.candidateListView.element.hidden = !state.candidateList;
      this.candidateListView.render(state.candidateList ?? { rows: [] });
    }
    // 通常表示は内容に必要な幅だけ使い、制限後の実寸で位置と高さを計算します。
    const measuredContainerWidth = this.container.offsetWidth;
    let measuredWidth = Math.min(initial.width,
      Number.isFinite(measuredContainerWidth) && measuredContainerWidth > 0 ? measuredContainerWidth : initial.width);
    if (this.candidateListView && state.candidateList) {
      const contentWidth = Math.max(0, (this.container.clientWidth || measuredWidth) - 2 * Math.min(10, initial.width / 4));
      this.candidateListView.setWidth(contentWidth);
      measuredWidth = Math.min(initial.width, this.container.offsetWidth || measuredWidth);
    }
    this.container.style.width = `${measuredWidth}px`;
    const detail = state.candidateList?.annotationMode === 'detail';
    const measurement = this.candidateListView && state.candidateList && !detail
      ? measureCandidateRows(this.candidateListView) : { rowHeight: 0, annotationHeight: 0 };
    const listHeight = this.candidateListView?.element.offsetHeight || 0;
    const guidanceHeight = state.candidateList?.annotationMode === 'choose' ? 28 : 0;
    const chromeHeight = Math.max(36, (this.container.offsetHeight || 36) - (state.candidateList && !detail ? listHeight : 0)) + guidanceHeight;
    const layout = computeOverlayLayout({
      viewport, caret: { x: state.x, top: state.caretTop ?? state.y - 18, bottom: state.y },
      desiredWidth: measuredWidth, ...measurement, chromeHeight,
      candidateCount: state.candidateList && !detail ? state.candidateOptions?.pageCapacity ?? state.candidateList.rows.length : 0,
      previous: this.previousLayout,
    });
    if (!detail) this.previousLayout = layout;
    this.candidateListView?.setCompact(layout.annotation === 'compact');
    this.container.style.left = `${layout.x}px`;
    this.container.style.top = `${layout.y}px`;
    this.container.style.maxHeight = `${layout.maxHeight}px`;
    this.container.style.padding = `${Math.min(4, layout.maxHeight / 4)}px ${Math.min(10, layout.width / 4)}px`;
    if (detail && this.candidateListView) {
      const detailElement = this.candidateListView.element.querySelector<HTMLElement>('.skk-candidate-detail');
      if (detailElement) detailElement.style.maxHeight = `${Math.max(0, layout.maxHeight - 44)}px`;
    }
    this.preeditEl!.scrollLeft = this.preeditEl!.scrollWidth;
    this.isVisible = true;
    if (state.candidateList && !detail && state.candidateOptions && layout.capacity !== state.candidateOptions.pageCapacity) {
      state.candidateOptions.onCapacityChange(layout.capacity);
    }
  }

  public scrollCandidateAnnotation(delta: number): void {
    this.candidateListView?.scrollDetail(delta);
  }

  public hide(state?: HUDState) {
    if (state) this.lastState = { ...state };
    if (this.container) {
      this.container.classList.add('skk-hidden');
    }
    this.isVisible = false;
    this.previousLayout = undefined;
  }

  public getVisible(): boolean {
    return this.isVisible;
  }

  public getState(): HUDState | null {
    return this.lastState;
  }

  public getShadowRoot(): ShadowRoot | null {
    return this.shadow;
  }
}

/** visualViewport のスクロール位置を含む CSS ピクセル領域です。 */
export function getOverlayViewport(): OverlayViewport {
  const viewport = window.visualViewport;
  return { x: viewport?.offsetLeft ?? 0, y: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight };
}

/** 幅を確定してから全行を測り、長い候補も行高の計算に含めます。 */
export function measureCandidateRows(view: CandidateListView): { rowHeight: number; annotationHeight: number } {
  const maximum = () => Math.max(30, ...Array.from(view.element.querySelectorAll<HTMLElement>('.skk-candidate-row'), row => row.offsetHeight + 2));
  view.setCompact(true);
  const compact = maximum();
  view.setCompact(false);
  const full = maximum();
  return { rowHeight: compact, annotationHeight: Math.max(0, full - compact) };
}
