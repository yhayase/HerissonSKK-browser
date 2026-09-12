import { OVERLAY_FONT_FAMILY, OVERLAY_THEME_CSS } from './overlayTheme';

export interface HUDState {
  x: number;
  y: number;
  mode: string;
  preedit?: string;
  candidate?: string;
  status?: string;
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
        align-items: center;
        gap: 6px;
        background: var(--skk-overlay-surface);
        color: var(--skk-overlay-text);
        font-family: ${OVERLAY_FONT_FAMILY};
        font-size: 18px;
        line-height: 1.4;
        padding: 4px 10px;
        border-radius: 6px;
        box-shadow: 0 4px 16px var(--skk-overlay-shadow), 0 0 0 1px var(--skk-overlay-border);
        pointer-events: none;
        user-select: none;
        max-width: calc(100vw - 16px);
        white-space: normal;
        overflow-wrap: anywhere;
        transform: translateY(4px);
        transition: opacity 0.12s ease-out, transform 0.12s ease-out;
        z-index: 2147483647;
      }
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

    this.badgeEl = document.createElement('span');
    this.badgeEl.className = 'skk-mode-badge';
    this.badgeEl.textContent = 'かな';

    this.preeditEl = document.createElement('span');
    this.preeditEl.className = 'skk-preedit';

    this.candidateEl = document.createElement('span');
    this.candidateEl.className = 'skk-candidate';

    this.statusEl = document.createElement('span');
    this.statusEl.className = 'skk-status';

    this.container.appendChild(this.badgeEl);
    this.container.appendChild(this.preeditEl);
    this.container.appendChild(this.candidateEl);
    this.container.appendChild(this.statusEl);

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

    // Adjust position to stay inside viewport
    const hudWidth = Math.max(180, this.container.offsetWidth || 180);
    const hudHeight = Math.max(32, this.container.offsetHeight || 32);
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const x = isNaN(state.x) ? 20 : state.x;
    const y = isNaN(state.y) ? viewportHeight - 50 : state.y;

    let posX = Math.max(8, Math.min(x, viewportWidth - hudWidth - 16));
    let posY = Math.max(8, Math.min(y, viewportHeight - hudHeight - 16));

    this.container.style.left = `${posX}px`;
    this.container.style.top = `${posY}px`;
    this.container.classList.remove('skk-hidden');
    this.isVisible = true;
  }

  public hide() {
    if (this.container) {
      this.container.classList.add('skk-hidden');
    }
    this.isVisible = false;
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
