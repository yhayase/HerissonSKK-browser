import type { IEditorTarget, IEditorSelectionSnapshot } from "./IEditorTarget";

export class InputElementTarget implements IEditorTarget {
    constructor(private element: HTMLInputElement | HTMLTextAreaElement) {}

    public isValid(): boolean {
        return this.element.isConnected !== false && (typeof this.element.isConnected === "boolean" ? this.element.isConnected : true);
    }

    public getElement(): HTMLElement {
        return this.element;
    }

    private getSelectionStart(): number {
        try {
            const pos = this.element.selectionStart;
            if (typeof pos === "number" && !Number.isNaN(pos)) {
                return pos;
            }
            return this.element.value?.length ?? 0;
        } catch {
            return this.element.value?.length ?? 0;
        }
    }

    private getSelectionEnd(): number {
        try {
            const pos = this.element.selectionEnd;
            if (typeof pos === "number" && !Number.isNaN(pos)) {
                return pos;
            }
            return this.element.value?.length ?? 0;
        } catch {
            return this.element.value?.length ?? 0;
        }
    }

    public saveSelection(): IEditorSelectionSnapshot {
        const savedStart = this.getSelectionStart();
        const savedEnd = this.getSelectionEnd();
        return {
            isValid: () => this.isValid(),
            restore: () => {
                if (!this.isValid()) {
                    return false;
                }
                this.focus();
                try {
                    if (typeof this.element.setSelectionRange === "function") {
                        this.element.setSelectionRange(savedStart, savedEnd);
                    } else {
                        this.element.selectionStart = savedStart;
                        this.element.selectionEnd = savedEnd;
                    }
                } catch {
                    // safely catch and no-op on non-selection inputs
                }
                return true;
            }
        };
    }

    public focus(): boolean {
        try {
            this.element.focus();
            return true;
        } catch {
            return false;
        }
    }

    public insertText(text: string): { success: boolean; method: string } {
        const start = this.getSelectionStart();
        const end = this.getSelectionEnd();
        let method = "setRangeText";
        let inserted = false;

        if (typeof this.element.setRangeText === "function") {
            try {
                this.element.setRangeText(text, start, end, "end");
                inserted = true;
            } catch {
                // DOMException on non-selectable inputs (e.g. email, number, url)
                inserted = false;
            }
        }

        if (!inserted) {
            const val = this.element.value ?? "";
            this.element.value = val.slice(0, start) + text + val.slice(end);
            const newPos = start + text.length;
            try {
                if (typeof this.element.setSelectionRange === "function") {
                    this.element.setSelectionRange(newPos, newPos);
                } else {
                    this.element.selectionStart = newPos;
                    this.element.selectionEnd = newPos;
                }
            } catch {
                // safely catch on non-selection inputs
            }
            method = "value-fallback";
        }

        if (typeof this.element.dispatchEvent === "function") {
            try {
                this.element.dispatchEvent(new Event("input", { bubbles: true }));
            } catch {}
        }

        return { success: true, method };
    }

    public deleteLeft(): boolean {
        const start = this.getSelectionStart();
        const end = this.getSelectionEnd();

        if (start === 0 && end === 0) {
            return false;
        }

        const val = this.element.value ?? "";
        if (val.length === 0) {
            return false;
        }

        if (start !== end) {
            this.element.value = val.slice(0, start) + val.slice(end);
            try {
                if (typeof this.element.setSelectionRange === "function") {
                    this.element.setSelectionRange(start, start);
                } else {
                    this.element.selectionStart = start;
                    this.element.selectionEnd = start;
                }
            } catch {}
        } else {
            this.element.value = val.slice(0, start - 1) + val.slice(start);
            try {
                if (typeof this.element.setSelectionRange === "function") {
                    this.element.setSelectionRange(start - 1, start - 1);
                } else {
                    this.element.selectionStart = start - 1;
                    this.element.selectionEnd = start - 1;
                }
            } catch {}
        }

        if (typeof this.element.dispatchEvent === "function") {
            try {
                this.element.dispatchEvent(new Event("input", { bubbles: true }));
            } catch {}
        }

        return true;
    }

    public getText(): string {
        return this.element.value ?? "";
    }

    public getTextBeforeCaret(): string {
        const start = this.getSelectionStart();
        return (this.element.value ?? "").slice(0, start);
    }

    public getTextAfterCaret(): string {
        const end = this.getSelectionEnd();
        return (this.element.value ?? "").slice(end);
    }
}
