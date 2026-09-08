import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { IEditorTarget, IEditorSelectionSnapshot } from "../../src/adapter/targets/IEditorTarget";
import { InputElementTarget } from "../../src/adapter/targets/InputElementTarget";
import { ContentEditableTarget } from "../../src/adapter/targets/ContentEditableTarget";
import { createEditorTarget } from "../../src/adapter/targets/EditorTargetFactory";

// Mock Input / TextArea Element
class MockInputElement {
    public tagName: string;
    public type: string;
    public value: string = "";
    public selectionStart: number = 0;
    public selectionEnd: number = 0;
    public isConnected: boolean = true;
    public isFocused: boolean = false;
    public events: Event[] = [];

    constructor(tagName: "INPUT" | "TEXTAREA" = "INPUT", type: string = "text") {
        this.tagName = tagName;
        this.type = type;
    }

    public setSelectionRange(start: number, end: number): void {
        this.selectionStart = start;
        this.selectionEnd = end;
    }

    public focus(): void {
        this.isFocused = true;
        if (typeof document !== "undefined") {
            (document as any).activeElement = this;
        }
    }

    public dispatchEvent(event: Event): boolean {
        this.events.push(event);
        return true;
    }
}

// Mock Range and Selection for ContentEditable testing
class MockDOMRange {
    public startContainer: any;
    public startOffset: number;
    public endContainer: any;
    public endOffset: number;

    constructor(startContainer: any, startOffset: number, endContainer: any, endOffset: number) {
        this.startContainer = startContainer;
        this.startOffset = startOffset;
        this.endContainer = endContainer;
        this.endOffset = endOffset;
    }

    public collapsed: boolean = false;
    public setStartAfterCalledWith: any = null;
    public collapseCalledWith: boolean | null = null;

    public setStartAfter(node: any): void {
        this.setStartAfterCalledWith = node;
    }

    public collapse(toStart?: boolean): void {
        this.collapseCalledWith = toStart ?? false;
        this.collapsed = true;
    }

    public get commonAncestorContainer(): any {
        return this.startContainer;
    }

    public cloneRange(): MockDOMRange {
        return new MockDOMRange(
            this.startContainer,
            this.startOffset,
            this.endContainer,
            this.endOffset
        );
    }

    public deleteContents(): void {
        if (this.startContainer && typeof this.startContainer.textContent === "string") {
            const text = this.startContainer.textContent;
            this.startContainer.textContent =
                text.slice(0, this.startOffset) + text.slice(this.endOffset);
            this.endOffset = this.startOffset;
            if (this.startContainer.parentElement) {
                this.startContainer.parentElement.textContent = this.startContainer.textContent;
            }
        }
    }

    public insertNode(node: any): void {
        if (this.startContainer && typeof this.startContainer.textContent === "string") {
            const text = this.startContainer.textContent;
            const insertStr = typeof node === "string" ? node : (node.textContent ?? "");
            this.startContainer.textContent =
                text.slice(0, this.startOffset) + insertStr + text.slice(this.startOffset);
            this.startOffset += insertStr.length;
            this.endOffset = this.startOffset;
            if (this.startContainer.parentElement) {
                this.startContainer.parentElement.textContent = this.startContainer.textContent;
            }
        }
    }
}

class MockDOMSelection {
    private ranges: MockDOMRange[] = [];

    public get rangeCount(): number {
        return this.ranges.length;
    }

    public getRangeAt(index: number): MockDOMRange | null {
        return this.ranges[index] ?? null;
    }

    public removeAllRanges(): void {
        this.ranges = [];
    }

    public addRange(range: MockDOMRange): void {
        this.ranges.push(range);
    }
}

// Mock ContentEditable Element
class MockContentEditableElement {
    public tagName: string = "DIV";
    public isContentEditable: boolean = true;
    public textContent: string = "";
    public isConnected: boolean = true;
    public isFocused: boolean = false;
    public events: Event[] = [];

    public contains(other: any): boolean {
        let curr = other;
        while (curr) {
            if (curr === this) return true;
            curr = curr.parentElement ?? curr.parentNode;
        }
        return false;
    }

    public focus(): void {
        this.isFocused = true;
        if (typeof document !== "undefined") {
            (document as any).activeElement = this;
        }
    }

    public dispatchEvent(event: Event): boolean {
        this.events.push(event);
        return true;
    }
}

describe("Editor Targets Specification (TC-TARGET-01, TC-TARGET-02)", () => {
    let originalDocument: any;
    let mockSelection: MockDOMSelection;

    beforeEach(() => {
        originalDocument = (globalThis as any).document;
        mockSelection = new MockDOMSelection();

        (globalThis as any).document = {
            activeElement: null,
            getSelection: () => mockSelection,
            execCommand: vi.fn(),
            createElement: (tag: string) => ({
                tagName: tag.toUpperCase(),
                style: {},
                isConnected: true
            })
        };
    });

    afterEach(() => {
        (globalThis as any).document = originalDocument;
    });

    describe("TC-TARGET-01: IEditorTarget Contract Implementation", () => {
        describe("InputElementTarget (<input type='text'> and <textarea>)", () => {
            it("TC-TARGET-01a: saves and restores selectionStart and selectionEnd in <input>", () => {
                const el = new MockInputElement("INPUT", "text");
                el.value = "東京特許許可局";
                el.setSelectionRange(2, 4); // "特許" selected
                const target: IEditorTarget = new InputElementTarget(el as unknown as HTMLInputElement);

                // Save selection snapshot
                const snapshot = target.saveSelection();
                expect(snapshot.isValid()).toBe(true);

                // Move caret or change selection
                el.setSelectionRange(0, 0);
                expect(el.selectionStart).toBe(0);
                expect(el.selectionEnd).toBe(0);

                // Restore selection snapshot
                const restored = snapshot.restore();
                expect(restored).toBe(true);
                expect(el.selectionStart).toBe(2);
                expect(el.selectionEnd).toBe(4);
            });

            it("TC-TARGET-01b: saves and restores selection in <textarea>", () => {
                const el = new MockInputElement("TEXTAREA");
                el.value = "Line 1\nLine 2\nLine 3";
                el.setSelectionRange(7, 13); // "Line 2"
                const target: IEditorTarget = new InputElementTarget(el as unknown as HTMLTextAreaElement);

                const snapshot = target.saveSelection();
                el.setSelectionRange(0, 0);

                const restored = snapshot.restore();
                expect(restored).toBe(true);
                expect(el.selectionStart).toBe(7);
                expect(el.selectionEnd).toBe(13);
            });

            it("TC-TARGET-01c: insertText(text) replaces selected range and advances caret", () => {
                const el = new MockInputElement("INPUT", "text");
                el.value = "東京都";
                el.setSelectionRange(2, 3); // "都" selected
                const target: IEditorTarget = new InputElementTarget(el as unknown as HTMLInputElement);

                const result = target.insertText("特別区");
                expect(result.success).toBe(true);
                expect(target.getText()).toBe("東京特別区");
                expect(el.selectionStart).toBe(5); // caret placed right after inserted text
                expect(el.selectionEnd).toBe(5);
            });

            it("TC-TARGET-01d: deleteLeft() deletes 1 character immediately preceding caret", () => {
                const el = new MockInputElement("INPUT", "text");
                el.value = "とうきょう";
                el.setSelectionRange(3, 3); // Caret between "き" and "ょ" (after "とうき")
                const target: IEditorTarget = new InputElementTarget(el as unknown as HTMLInputElement);

                const deleted = target.deleteLeft();
                expect(deleted).toBe(true);
                expect(target.getText()).toBe("とうょう"); // "き" deleted
                expect(el.selectionStart).toBe(2);
                expect(el.selectionEnd).toBe(2);
            });

            it("TC-TARGET-01e: deleteLeft() returns false when caret is at index 0", () => {
                const el = new MockInputElement("INPUT", "text");
                el.value = "あ";
                el.setSelectionRange(0, 0);
                const target: IEditorTarget = new InputElementTarget(el as unknown as HTMLInputElement);

                const deleted = target.deleteLeft();
                expect(deleted).toBe(false);
                expect(target.getText()).toBe("あ");
            });

            it("TC-TARGET-01f: focus() focuses the element and returns true", () => {
                const el = new MockInputElement("INPUT", "text");
                const target: IEditorTarget = new InputElementTarget(el as unknown as HTMLInputElement);

                expect(el.isFocused).toBe(false);
                const focused = target.focus();
                expect(focused).toBe(true);
                expect(el.isFocused).toBe(true);
            });

            it("TC-TARGET-01f2: handles non-selectable input types (e.g. number) where selectionStart throws InvalidStateError", () => {
                const el = new MockInputElement("INPUT", "number");
                el.value = "123";
                Object.defineProperty(el, "selectionStart", {
                    get() {
                        throw new Error("Failed to read 'selectionStart': The input element's type ('number') does not support selection.");
                    }
                });
                Object.defineProperty(el, "selectionEnd", {
                    get() {
                        throw new Error("Failed to read 'selectionEnd': The input element's type ('number') does not support selection.");
                    }
                });
                const target: IEditorTarget = new InputElementTarget(el as unknown as HTMLInputElement);

                // saveSelection should not throw
                const snapshot = target.saveSelection();
                expect(snapshot.isValid()).toBe(true);

                // insertText should not throw
                const result = target.insertText("4");
                expect(result.success).toBe(true);
                expect(target.getText()).toBe("1234");

                // deleteLeft should not throw
                const deleted = target.deleteLeft();
                expect(deleted).toBe(true);
                expect(target.getText()).toBe("123");
            });
        });

        describe("ContentEditableTarget (<div contenteditable='true'>)", () => {
            it("TC-TARGET-01g: saves and restores DOM Range / Selection", () => {
                const el = new MockContentEditableElement();
                el.textContent = "コンテンツエディタ";
                const textNode = { textContent: el.textContent, isConnected: true };
                const range = new MockDOMRange(textNode, 4, textNode, 8); // "エディタ"
                mockSelection.addRange(range);

                const target: IEditorTarget = new ContentEditableTarget(el as unknown as HTMLElement);
                const snapshot = target.saveSelection();
                expect(snapshot.isValid()).toBe(true);

                // Clear selection
                mockSelection.removeAllRanges();
                expect(mockSelection.rangeCount).toBe(0);

                // Restore snapshot
                const restored = snapshot.restore();
                expect(restored).toBe(true);
                expect(mockSelection.rangeCount).toBe(1);
                const restoredRange = mockSelection.getRangeAt(0);
                expect(restoredRange?.startOffset).toBe(4);
                expect(restoredRange?.endOffset).toBe(8);
            });

            it("TC-TARGET-01h: insertText(text) replaces selected range in contenteditable", () => {
                const el = new MockContentEditableElement();
                el.textContent = "コンテンツエディタ";
                const textNode = { textContent: el.textContent, isConnected: true, parentElement: el };
                const range = new MockDOMRange(textNode, 0, textNode, 5); // "コンテンツ" (5 chars)
                mockSelection.addRange(range);

                const target: IEditorTarget = new ContentEditableTarget(el as unknown as HTMLElement);
                const result = target.insertText("リッチテキスト");
                expect(result.success).toBe(true);
                expect(target.getText()).toContain("リッチテキストエディタ");
            });

            it("TC-TARGET-01i: getText() returns textContent of the element", () => {
                const el = new MockContentEditableElement();
                el.textContent = "サンプル文章";
                const target: IEditorTarget = new ContentEditableTarget(el as unknown as HTMLElement);
                expect(target.getText()).toBe("サンプル文章");
            });

            it("TC-TARGET-01j: insertText positions caret after inserted node and dispatches input event", () => {
                const el = new MockContentEditableElement();
                el.textContent = "初期テキスト";
                const textNode = { textContent: el.textContent, isConnected: true, parentElement: el };
                const range = new MockDOMRange(textNode, 2, textNode, 2);
                mockSelection.addRange(range);

                const target: IEditorTarget = new ContentEditableTarget(el as unknown as HTMLElement);
                const result = target.insertText("挿入");

                expect(result.success).toBe(true);
                // Verify range was moved after the inserted node and collapsed
                expect(range.setStartAfterCalledWith).toBeDefined();
                expect(range.collapseCalledWith).toBe(true);
                expect(mockSelection.rangeCount).toBe(1);
                // Verify input event was dispatched on the element with inputType insertText
                const inputEvents = el.events.filter((e) => e.type === "input");
                expect(inputEvents.length).toBeGreaterThan(0);
                expect(inputEvents[0]?.bubbles).toBe(true);
                expect((inputEvents[0] as any).inputType).toBe("insertText");
                expect((inputEvents[0] as any).data).toBe("挿入");
            });

            it("TC-TARGET-01k: deleteLeft dispatches input event with inputType deleteContentBackward", () => {
                const el = new MockContentEditableElement();
                el.textContent = "テスト文章";
                const textNode = { textContent: el.textContent, isConnected: true, parentElement: el };
                const range = new MockDOMRange(textNode, 3, textNode, 3);
                mockSelection.addRange(range);

                const target: IEditorTarget = new ContentEditableTarget(el as unknown as HTMLElement);
                const result = target.deleteLeft();

                expect(result).toBe(true);
                const inputEvents = el.events.filter((e) => e.type === "input");
                expect(inputEvents.length).toBeGreaterThan(0);
                expect(inputEvents[0]?.bubbles).toBe(true);
                expect((inputEvents[0] as any).inputType).toBe("deleteContentBackward");
            });

            it("TC-TARGET-01l: does not mutate or operate on selection outside this.element", () => {
                const outsideEl = new MockContentEditableElement();
                outsideEl.textContent = "外部要素のテキスト";
                const outsideTextNode = { textContent: outsideEl.textContent, isConnected: true, parentElement: outsideEl };
                const outsideRange = new MockDOMRange(outsideTextNode, 2, outsideTextNode, 5);
                mockSelection.addRange(outsideRange);

                const myEl = new MockContentEditableElement();
                myEl.textContent = "自要素";
                const target: IEditorTarget = new ContentEditableTarget(myEl as unknown as HTMLElement);

                // 1. insertText should not touch outsideRange
                const insertRes = target.insertText("追加");
                expect(insertRes.success).toBe(true);
                expect(insertRes.method).toBe("text-content-append");
                // Outside element text unchanged
                expect(outsideEl.textContent).toBe("外部要素のテキスト");
                // Inside element text updated safely
                expect(myEl.textContent).toBe("自要素追加");

                // 2. deleteLeft should not delete from outsideRange
                const deleteRes = target.deleteLeft();
                expect(deleteRes).toBe(true);
                expect(outsideEl.textContent).toBe("外部要素のテキスト");
                expect(myEl.textContent).toBe("自要素追");

                // 3. saveSelection should not capture outsideRange
                const snapshot = target.saveSelection();
                mockSelection.removeAllRanges();
                snapshot.restore();
                // Should not restore outsideRange into my target
                expect(mockSelection.rangeCount).toBe(0);
            });
        });
    });

    describe("TC-TARGET-02: Element & Snapshot Validity (isConnected & detaching)", () => {
        it("TC-TARGET-02a: isValid() returns false when target element is disconnected (!isConnected)", () => {
            const el = new MockInputElement("INPUT", "text");
            el.isConnected = true;
            const target: IEditorTarget = new InputElementTarget(el as unknown as HTMLInputElement);
            expect(target.isValid()).toBe(true);

            // Element removed from DOM
            el.isConnected = false;
            expect(target.isValid()).toBe(false);
        });

        it("TC-TARGET-02b: restore() returns false if snapshot node was detached or deleted", () => {
            const el = new MockContentEditableElement();
            const textNode = { textContent: "消えるテキスト", isConnected: true };
            const range = new MockDOMRange(textNode, 0, textNode, 3);
            mockSelection.addRange(range);

            const target: IEditorTarget = new ContentEditableTarget(el as unknown as HTMLElement);
            const snapshot = target.saveSelection();
            expect(snapshot.isValid()).toBe(true);

            // Node is detached / removed from DOM
            textNode.isConnected = false;
            expect(snapshot.isValid()).toBe(false);

            // Attempting to restore returns false safely without throwing
            const restored = snapshot.restore();
            expect(restored).toBe(false);
        });
    });

    describe("EditorTargetFactory: createEditorTarget", () => {
        it("creates InputElementTarget for input and textarea", () => {
            const inputEl = new MockInputElement("INPUT", "text");
            const targetInput = createEditorTarget(inputEl as unknown as HTMLElement);
            expect(targetInput).toBeInstanceOf(InputElementTarget);

            const textareaEl = new MockInputElement("TEXTAREA");
            const targetTextarea = createEditorTarget(textareaEl as unknown as HTMLElement);
            expect(targetTextarea).toBeInstanceOf(InputElementTarget);
        });

        it("creates ContentEditableTarget for contenteditable element", () => {
            const ceEl = new MockContentEditableElement();
            const targetCe = createEditorTarget(ceEl as unknown as HTMLElement);
            expect(targetCe).toBeInstanceOf(ContentEditableTarget);
        });

        it("returns null for non-editable element or null", () => {
            expect(createEditorTarget(null)).toBeNull();

            const nonEditable = {
                tagName: "DIV",
                isContentEditable: false,
                isConnected: true
            };
            expect(createEditorTarget(nonEditable as unknown as HTMLElement)).toBeNull();
        });
    });
});
