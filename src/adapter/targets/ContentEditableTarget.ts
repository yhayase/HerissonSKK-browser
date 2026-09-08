import type { IEditorTarget, IEditorSelectionSnapshot } from "./IEditorTarget";

export class ContentEditableTarget implements IEditorTarget {
    constructor(private element: HTMLElement) {}

    public isValid(): boolean {
        return this.element.isConnected !== false && (typeof this.element.isConnected === "boolean" ? this.element.isConnected : true);
    }

    public getElement(): HTMLElement {
        return this.element;
    }

    public saveSelection(): IEditorSelectionSnapshot {
        let clonedRange: any = null;
        const getSel =
            typeof document !== "undefined" && typeof document.getSelection === "function"
                ? document.getSelection.bind(document)
                : typeof window !== "undefined" && typeof window.getSelection === "function"
                ? window.getSelection.bind(window)
                : null;
        const sel = getSel ? getSel() : null;

        if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            if (range) {
                clonedRange = typeof range.cloneRange === "function" ? range.cloneRange() : range;
            }
        }

        return {
            isValid: () => {
                if (!this.isValid()) return false;
                if (clonedRange) {
                    const node = clonedRange.startContainer;
                    if (node && node.isConnected === false) return false;
                }
                return true;
            },
            restore: () => {
                if (!this.isValid()) return false;
                if (clonedRange) {
                    const node = clonedRange.startContainer;
                    if (node && node.isConnected === false) return false;
                    this.focus();
                    if (sel) {
                        sel.removeAllRanges();
                        sel.addRange(clonedRange);
                        return true;
                    }
                }
                return false;
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
        const getSel =
            typeof document !== "undefined" && typeof document.getSelection === "function"
                ? document.getSelection.bind(document)
                : typeof window !== "undefined" && typeof window.getSelection === "function"
                ? window.getSelection.bind(window)
                : null;
        const sel = getSel ? getSel() : null;

        if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            if (range) {
                if (typeof range.deleteContents === "function") {
                    range.deleteContents();
                }
                const textNode =
                    typeof document !== "undefined" && typeof document.createTextNode === "function"
                        ? document.createTextNode(text)
                        : (text as any);
                if (typeof range.insertNode === "function") {
                    range.insertNode(textNode);
                }
                if (
                    range.startContainer &&
                    range.startContainer !== this.element &&
                    typeof range.startContainer.textContent === "string"
                ) {
                    this.element.textContent = range.startContainer.textContent;
                }
                return { success: true, method: "range-insert" };
            }
        }

        this.element.textContent = (this.element.textContent ?? "") + text;
        return { success: true, method: "text-content-append" };
    }

    public deleteLeft(): boolean {
        const getSel =
            typeof document !== "undefined" && typeof document.getSelection === "function"
                ? document.getSelection.bind(document)
                : typeof window !== "undefined" && typeof window.getSelection === "function"
                ? window.getSelection.bind(window)
                : null;
        const sel = getSel ? getSel() : null;

        if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            if (range) {
                if (range.collapsed) {
                    if (range.startOffset > 0) {
                        try {
                            range.setStart(range.startContainer, range.startOffset - 1);
                            if (typeof range.deleteContents === "function") {
                                range.deleteContents();
                            }
                            return true;
                        } catch {}
                    }
                } else {
                    if (typeof range.deleteContents === "function") {
                        range.deleteContents();
                    }
                    return true;
                }
            }
        }

        const text = this.element.textContent ?? "";
        if (text.length > 0) {
            this.element.textContent = text.slice(0, -1);
            return true;
        }

        return false;
    }

    public getText(): string {
        return this.element.textContent ?? "";
    }
}
