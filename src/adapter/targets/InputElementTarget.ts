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
            return this.element.selectionStart ?? (this.element.value?.length ?? 0);
        } catch {
            return this.element.value?.length ?? 0;
        }
    }

    private getSelectionEnd(): number {
        try {
            return this.element.selectionEnd ?? (this.element.value?.length ?? 0);
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
                if (typeof this.element.setSelectionRange === "function") {
                    try {
                        this.element.setSelectionRange(savedStart, savedEnd);
                    } catch {}
                } else {
                    try {
                        this.element.selectionStart = savedStart;
                        this.element.selectionEnd = savedEnd;
                    } catch {}
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
        let method = "execCommand";
        let inserted = false;

        if (typeof this.element.setRangeText === "function") {
            this.element.setRangeText(text, start, end, "end");
            if (typeof this.element.dispatchEvent === "function") {
                try {
                    this.element.dispatchEvent(new Event("input", { bubbles: true }));
                } catch {}
            }
        } else {
            const val = this.element.value ?? "";
            this.element.value = val.slice(0, start) + text + val.slice(end);
            const newPos = start + text.length;
            if (typeof this.element.setSelectionRange === "function") {
                try {
                    this.element.setSelectionRange(newPos, newPos);
                } catch {}
            } else {
                try {
                    this.element.selectionStart = newPos;
                    this.element.selectionEnd = newPos;
                } catch {}
            }
            if (typeof this.element.dispatchEvent === "function") {
                try {
                    this.element.dispatchEvent(new Event("input", { bubbles: true }));
                } catch {}
            }
        }

        return { success: true, method };
    }

    public deleteLeft(): boolean {
        const start = this.getSelectionStart();
        const end = this.getSelectionEnd();

        if (start === 0 && end === 0) {
            return false;
        }

        if (start !== end) {
            const val = this.element.value ?? "";
            this.element.value = val.slice(0, start) + val.slice(end);
            if (typeof this.element.setSelectionRange === "function") {
                try {
                    this.element.setSelectionRange(start, start);
                } catch {}
            } else {
                try {
                    this.element.selectionStart = start;
                    this.element.selectionEnd = start;
                } catch {}
            }
        } else {
            const val = this.element.value ?? "";
            this.element.value = val.slice(0, start - 1) + val.slice(start);
            if (typeof this.element.setSelectionRange === "function") {
                try {
                    this.element.setSelectionRange(start - 1, start - 1);
                } catch {}
            } else {
                try {
                    this.element.selectionStart = start - 1;
                    this.element.selectionEnd = start - 1;
                } catch {}
            }
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
}
