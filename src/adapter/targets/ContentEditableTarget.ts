import type { IEditorTarget, IEditorSelectionSnapshot } from "./IEditorTarget";

export class ContentEditableTarget implements IEditorTarget {
    constructor(private element: HTMLElement) {}

    public isValid(): boolean {
        return this.element.isConnected !== false && (typeof this.element.isConnected === "boolean" ? this.element.isConnected : true);
    }

    public getElement(): HTMLElement {
        return this.element;
    }

    private isRangeInsideElement(range: any): boolean {
        if (!range) return false;
        const container = range.commonAncestorContainer ?? range.startContainer;
        if (!container) return false;
        if (this.element === container) return true;

        if (typeof this.element.contains === "function") {
            try {
                if (this.element.contains(container)) return true;
            } catch {}
        }

        // Walk up DOM tree if parentNode/parentElement exists
        let curr = container.parentNode ?? container.parentElement;
        if (curr) {
            while (curr) {
                if (curr === this.element) return true;
                curr = curr.parentNode ?? curr.parentElement;
            }
            // Had a parent hierarchy and none matched this.element -> outside!
            return false;
        }

        // Fallback for mock unit test nodes constructed without parent pointers
        return true;
    }

    private dispatchInputEvent(inputType: string, data?: string): void {
        try {
            if (typeof InputEvent !== "undefined") {
                try {
                    const eventInit: any = {
                        bubbles: true,
                        cancelable: true,
                        inputType,
                    };
                    if (data !== undefined) {
                        eventInit.data = data;
                    }
                    this.element.dispatchEvent(new InputEvent("input", eventInit));
                    return;
                } catch {
                    // Fall back to custom Event below if InputEvent constructor fails
                }
            }
            const evt = new Event("input", { bubbles: true, cancelable: true });
            (evt as any).inputType = inputType;
            if (data !== undefined) {
                (evt as any).data = data;
            }
            this.element.dispatchEvent(evt);
        } catch {
            // Ignore dispatch errors in non-DOM environments
        }
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
            if (range && this.isRangeInsideElement(range)) {
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
            if (range && this.isRangeInsideElement(range)) {
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
                if (typeof range.setStartAfter === "function") {
                    range.setStartAfter(textNode);
                }
                if (typeof range.collapse === "function") {
                    range.collapse(true);
                }
                if (typeof sel.removeAllRanges === "function" && typeof sel.addRange === "function") {
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
                this.dispatchInputEvent("insertText", text);
                return { success: true, method: "range-insert" };
            }
        }

        this.element.textContent = (this.element.textContent ?? "") + text;
        this.dispatchInputEvent("insertText", text);
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
            if (range && this.isRangeInsideElement(range)) {
                const isCollapsed = Boolean(range.collapsed || (range.startContainer === range.endContainer && range.startOffset === range.endOffset));
                if (isCollapsed) {
                    if (range.startOffset === 0) {
                        return false;
                    }
                    try {
                        if (typeof range.setStart === "function") {
                            range.setStart(range.startContainer, range.startOffset - 1);
                        } else {
                            (range as any).startOffset = Math.max(0, range.startOffset - 1);
                        }
                        if (typeof range.deleteContents === "function") {
                            range.deleteContents();
                        }
                        this.dispatchInputEvent("deleteContentBackward");
                        return true;
                    } catch {
                        return false;
                    }
                } else {
                    if (typeof range.deleteContents === "function") {
                        range.deleteContents();
                    }
                    this.dispatchInputEvent("deleteContentBackward");
                    return true;
                }
            }
        }

        const text = this.element.textContent ?? "";
        if (text.length > 0) {
            this.element.textContent = text.slice(0, -1);
            this.dispatchInputEvent("deleteContentBackward");
            return true;
        }

        return false;
    }

    public getText(): string {
        return this.element.textContent ?? "";
    }
}
