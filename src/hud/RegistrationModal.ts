import type { IEditorTarget, IEditorSelectionSnapshot } from "../adapter/targets/IEditorTarget";

interface RegistrationSession {
    depth: number;
    yomi: string;
    okuri: string;
    inputElement: HTMLInputElement;
    savedSelectionStart?: number;
    savedSelectionEnd?: number;
}

export const MAX_REGISTRATION_DEPTH = 5;

export class RegistrationModal {
    private static activeModal: RegistrationModal | null = null;

    private sessions: RegistrationSession[] = [];
    private originalTarget: IEditorTarget | null = null;
    private selectionSnapshot: IEditorSelectionSnapshot | null = null;
    private overlayEl: HTMLElement | null = null;
    private dialogEl: HTMLElement | null = null;
    private badgeEl: HTMLElement | null = null;
    private promptEl: HTMLElement | null = null;
    private inputContainerEl: HTMLElement | null = null;
    private statusLineEl: HTMLElement | null = null;
    private modeBadgeEl: HTMLElement | null = null;
    private preeditEl: HTMLElement | null = null;
    private candidateEl: HTMLElement | null = null;
    private statusTextEl: HTMLElement | null = null;

    constructor(private shadowRoot: ShadowRoot) {}

    public static getActiveModal(): RegistrationModal | null {
        return RegistrationModal.activeModal;
    }

    public static resetActiveModal(): void {
        if (RegistrationModal.activeModal) {
            RegistrationModal.activeModal.close();
            RegistrationModal.activeModal = null;
        }
    }

    public open(yomi: string, okuri: string, originalTarget?: IEditorTarget | null): HTMLInputElement {
        this.originalTarget = originalTarget ?? null;
        this.selectionSnapshot = originalTarget ? originalTarget.saveSelection() : null;

        // Close any prior elements
        this.closeElements();

        RegistrationModal.activeModal = this;

        if (typeof document !== "undefined") {
            this.overlayEl = document.createElement("div");
            this.overlayEl.className = "skk-registration-modal-overlay";
            this.overlayEl.style.position = "fixed";
            this.overlayEl.style.inset = "0";
            this.overlayEl.style.background = "rgba(0, 0, 0, 0.4)";
            this.overlayEl.style.zIndex = "2147483647";
            this.overlayEl.style.display = "flex";
            this.overlayEl.style.alignItems = "center";
            this.overlayEl.style.justifyContent = "center";
            this.overlayEl.style.pointerEvents = "auto";

            this.dialogEl = document.createElement("div");
            this.dialogEl.className = "skk-registration-modal-dialog";
            this.dialogEl.style.background = "#1e1e2e";
            this.dialogEl.style.color = "#cdd6f4";
            this.dialogEl.style.padding = "16px 20px";
            this.dialogEl.style.borderRadius = "8px";
            this.dialogEl.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.5)";
            this.dialogEl.style.display = "flex";
            this.dialogEl.style.flexDirection = "column";
            this.dialogEl.style.gap = "8px";
            this.dialogEl.style.minWidth = "280px";

            const headerEl = document.createElement("div");
            headerEl.style.display = "flex";
            headerEl.style.alignItems = "center";
            headerEl.style.gap = "8px";

            this.badgeEl = document.createElement("span");
            this.badgeEl.className = "skk-modal-badge";
            this.badgeEl.textContent = "辞書登録";
            this.badgeEl.style.background = "#fab387";
            this.badgeEl.style.color = "#11111b";
            this.badgeEl.style.padding = "2px 6px";
            this.badgeEl.style.borderRadius = "4px";
            this.badgeEl.style.fontSize = "12px";
            this.badgeEl.style.fontWeight = "bold";

            this.promptEl = document.createElement("span");
            this.promptEl.className = "skk-modal-prompt";
            const stem = okuri ? yomi.replace(/[a-z]+$/, "") : yomi;
            this.promptEl.textContent = okuri ? `[${stem}*${okuri}] ` : `[${yomi}] `;
            this.promptEl.style.fontSize = "14px";
            this.promptEl.style.fontWeight = "bold";

            headerEl.appendChild(this.badgeEl);
            headerEl.appendChild(this.promptEl);

            this.inputContainerEl = document.createElement("div");
            this.inputContainerEl.className = "skk-modal-input-container";

            this.statusLineEl = document.createElement("div");
            this.statusLineEl.className = "skk-modal-status-line";
            this.statusLineEl.style.display = "flex";
            this.statusLineEl.style.alignItems = "center";
            this.statusLineEl.style.gap = "8px";
            this.statusLineEl.style.fontSize = "13px";
            this.statusLineEl.style.minHeight = "22px";
            this.statusLineEl.style.marginTop = "2px";

            this.modeBadgeEl = document.createElement("span");
            this.modeBadgeEl.className = "skk-modal-status-mode";
            this.modeBadgeEl.style.background = "#45475a";
            this.modeBadgeEl.style.color = "#cdd6f4";
            this.modeBadgeEl.style.padding = "1px 6px";
            this.modeBadgeEl.style.borderRadius = "3px";
            this.modeBadgeEl.style.fontSize = "11px";
            this.modeBadgeEl.style.fontWeight = "bold";
            this.modeBadgeEl.textContent = "かな";

            this.preeditEl = document.createElement("span");
            this.preeditEl.className = "skk-modal-status-preedit";
            this.preeditEl.style.color = "#89b4fa";
            this.preeditEl.style.fontWeight = "bold";
            this.preeditEl.style.display = "none";

            this.candidateEl = document.createElement("span");
            this.candidateEl.className = "skk-modal-status-candidate";
            this.candidateEl.style.color = "#a6e3a1";
            this.candidateEl.style.fontWeight = "bold";
            this.candidateEl.style.display = "none";

            this.statusTextEl = document.createElement("span");
            this.statusTextEl.className = "skk-modal-status-text";
            this.statusTextEl.style.color = "#bac2de";
            this.statusTextEl.style.fontSize = "12px";
            this.statusTextEl.style.display = "none";

            this.statusLineEl.appendChild(this.modeBadgeEl);
            this.statusLineEl.appendChild(this.preeditEl);
            this.statusLineEl.appendChild(this.candidateEl);
            this.statusLineEl.appendChild(this.statusTextEl);

            this.dialogEl.appendChild(headerEl);
            this.dialogEl.appendChild(this.inputContainerEl);
            this.dialogEl.appendChild(this.statusLineEl);
            this.overlayEl.appendChild(this.dialogEl);

            if (this.shadowRoot && typeof this.shadowRoot.appendChild === "function") {
                this.shadowRoot.appendChild(this.overlayEl);
            }
        }

        const inputEl = this.createInputElement();
        if (this.inputContainerEl && typeof this.inputContainerEl.appendChild === "function") {
            this.inputContainerEl.appendChild(inputEl);
        }
        this.sessions = [{ depth: 1, yomi, okuri, inputElement: inputEl }];
        if (typeof inputEl.focus === "function") {
            try {
                inputEl.focus();
            } catch {}
        }

        return inputEl;
    }

    private createInputElement(): HTMLInputElement {
        const input = (typeof document !== "undefined" ? document.createElement("input") : ({} as any)) as HTMLInputElement;
        input.type = "text";
        input.className = "skk-modal-input";
        if (input.value === undefined) {
            input.value = "";
        }
        if (input.style) {
            input.style.width = "100%";
            input.style.padding = "6px 8px";
            input.style.background = "#181825";
            input.style.color = "#cdd6f4";
            input.style.border = "1px solid #45475a";
            input.style.borderRadius = "4px";
            input.style.fontSize = "14px";
            input.style.outline = "none";
            input.style.boxSizing = "border-box";
        }
        return input;
    }

    public pushSession(yomi: string, okuri: string): HTMLInputElement | null {
        if (this.sessions.length >= MAX_REGISTRATION_DEPTH) {
            return null;
        }

        const currentSession = this.sessions[this.sessions.length - 1];
        if (currentSession) {
            try {
                currentSession.savedSelectionStart = currentSession.inputElement.selectionStart ?? undefined;
                currentSession.savedSelectionEnd = currentSession.inputElement.selectionEnd ?? undefined;
            } catch {}
            if (currentSession.inputElement.style) {
                currentSession.inputElement.style.display = "none";
            }
        }

        const depth = this.sessions.length + 1;
        const childInput = this.createInputElement();
        if (this.inputContainerEl && typeof this.inputContainerEl.appendChild === "function") {
            this.inputContainerEl.appendChild(childInput);
        }

        this.sessions.push({ depth, yomi, okuri, inputElement: childInput });

        if (this.badgeEl) {
            this.badgeEl.textContent = `再帰登録 (${depth})`;
        }
        if (this.promptEl) {
            const stem = okuri ? yomi.replace(/[a-z]+$/, "") : yomi;
            this.promptEl.textContent = okuri ? `[${stem}*${okuri}] ` : `[${yomi}] `;
        }
        this.updateStatus({ mode: "かな", preedit: "", candidate: "", statusText: "" });

        if (typeof childInput.focus === "function") {
            try {
                childInput.focus();
            } catch {}
        }
        return childInput;
    }

    public popSession(): HTMLInputElement | null {
        if (this.sessions.length === 0) {
            return null;
        }

        const popped = this.sessions.pop()!;
        try {
            if (typeof popped.inputElement.remove === "function") {
                popped.inputElement.remove();
            } else if (popped.inputElement.parentNode) {
                popped.inputElement.parentNode.removeChild(popped.inputElement);
            }
        } catch {}

        const parentSession = this.sessions[this.sessions.length - 1];
        if (parentSession) {
            if (parentSession.inputElement.style) {
                parentSession.inputElement.style.display = "";
            }
            if (typeof parentSession.inputElement.focus === "function") {
                try {
                    parentSession.inputElement.focus();
                } catch {}
            }
            if (
                typeof parentSession.savedSelectionStart === "number" &&
                typeof parentSession.savedSelectionEnd === "number" &&
                typeof parentSession.inputElement.setSelectionRange === "function"
            ) {
                try {
                    parentSession.inputElement.setSelectionRange(
                        parentSession.savedSelectionStart,
                        parentSession.savedSelectionEnd
                    );
                } catch {}
            }
            if (this.badgeEl) {
                this.badgeEl.textContent = parentSession.depth > 1 ? `再帰登録 (${parentSession.depth})` : "辞書登録";
            }
            if (this.promptEl) {
                const stem = parentSession.okuri ? parentSession.yomi.replace(/[a-z]+$/, "") : parentSession.yomi;
                this.promptEl.textContent = parentSession.okuri ? `[${stem}*${parentSession.okuri}] ` : `[${parentSession.yomi}] `;
            }
            return parentSession.inputElement;
        }

        return null;
    }

    public updateStatus(status: {
        mode?: string;
        preedit?: string;
        candidate?: string;
        statusText?: string;
    }): void {
        if (this.modeBadgeEl && status.mode !== undefined) {
            this.modeBadgeEl.textContent = status.mode;
        }
        if (this.preeditEl) {
            this.preeditEl.textContent = status.preedit ?? "";
            this.preeditEl.style.display = status.preedit ? "" : "none";
        }
        if (this.candidateEl) {
            this.candidateEl.textContent = status.candidate ? `▼${status.candidate}` : "";
            this.candidateEl.style.display = status.candidate ? "" : "none";
        }
        if (this.statusTextEl) {
            this.statusTextEl.textContent = status.statusText ?? "";
            this.statusTextEl.style.display = status.statusText ? "" : "none";
        }
    }

    public getStatusText(): { mode: string; preedit: string; candidate: string; statusText: string } {
        return {
            mode: this.modeBadgeEl?.textContent ?? "",
            preedit: this.preeditEl?.textContent ?? "",
            candidate: this.candidateEl?.textContent ?? "",
            statusText: this.statusTextEl?.textContent ?? ""
        };
    }

    public close(): void {
        this.closeElements();
        this.sessions = [];
        this.originalTarget = null;
        this.selectionSnapshot = null;
        if (RegistrationModal.activeModal === this) {
            RegistrationModal.activeModal = null;
        }
    }

    private closeElements(): void {
        if (this.overlayEl) {
            try {
                if (typeof this.overlayEl.remove === "function") {
                    this.overlayEl.remove();
                } else if (this.overlayEl.parentNode) {
                    this.overlayEl.parentNode.removeChild(this.overlayEl);
                }
            } catch {}
            this.overlayEl = null;
        }
        this.dialogEl = null;
        this.badgeEl = null;
        this.promptEl = null;
        this.inputContainerEl = null;
        this.statusLineEl = null;
        this.modeBadgeEl = null;
        this.preeditEl = null;
        this.candidateEl = null;
        this.statusTextEl = null;
    }

    public isOpen(): boolean {
        return this.sessions.length > 0;
    }

    public getActiveInputElement(): HTMLInputElement | null {
        return this.sessions[this.sessions.length - 1]?.inputElement ?? null;
    }

    public getShadowRoot(): ShadowRoot {
        return this.shadowRoot;
    }

    public getDepth(): number {
        return this.sessions.length;
    }

    public getOriginalTarget(): IEditorTarget | null {
        return this.originalTarget;
    }

    public getSelectionSnapshot(): IEditorSelectionSnapshot | null {
        return this.selectionSnapshot;
    }

    public getContainer(): HTMLElement | null {
        return this.dialogEl;
    }
}
