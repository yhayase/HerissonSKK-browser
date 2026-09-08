import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SimpleMemoryJisyoProvider } from "../../src/core/skk/jisyo/SimpleMemoryJisyoProvider";
import { BrowserEditorAdapter } from "../../src/adapter/BrowserEditorAdapter";
import { RegistrationMode } from "../../src/core/skk/input-mode/henkan/RegistrationMode";
import { HiraganaMode } from "../../src/core/skk/input-mode/HiraganaMode";
import { AsciiMode } from "../../src/core/skk/input-mode/AsciiMode";
import { InlineHenkanMode } from "../../src/core/skk/input-mode/henkan/InlineHenkanMode";
import { Candidate } from "../../src/core/skk/jisyo/candidate";
import { FloatingHUD } from "../../src/hud/FloatingHUD";
import { RegistrationModal } from "../../src/hud/RegistrationModal";
import { getDeepActiveElement } from "../../src/adapter/DOMUtils";
import type { IEditorTarget, IEditorSelectionSnapshot } from "../../src/adapter/targets/IEditorTarget";
import { InputElementTarget } from "../../src/adapter/targets/InputElementTarget";

// Mock Target implementing IEditorTarget for testing coordinator
class MockOriginalEditorTarget implements IEditorTarget {
    public value: string = "";
    public start: number = 0;
    public end: number = 0;
    public isConnected: boolean = true;
    public isFocused: boolean = false;
    public saveSelectionCalls: number = 0;
    public restoreSelectionCalls: number = 0;
    public insertedTexts: string[] = [];

    constructor(initialValue: string = "", start: number = 0, end: number = 0) {
        this.value = initialValue;
        this.start = start;
        this.end = end;
    }

    public isValid(): boolean {
        return this.isConnected;
    }

    public getElement(): HTMLElement {
        return {
            tagName: "INPUT",
            type: "text",
            value: this.value,
            selectionStart: this.start,
            selectionEnd: this.end,
            setSelectionRange: (s: number, e: number) => {
                this.start = s;
                this.end = e;
            },
            focus: () => this.focus(),
            isConnected: this.isConnected,
            closest: () => null,
            getBoundingClientRect: () => ({ left: 100, top: 200, right: 300, bottom: 230, width: 200, height: 30 })
        } as unknown as HTMLElement;
    }

    public saveSelection(): IEditorSelectionSnapshot {
        this.saveSelectionCalls++;
        const savedStart = this.start;
        const savedEnd = this.end;
        return {
            isValid: () => this.isConnected,
            restore: () => {
                if (!this.isConnected) return false;
                this.restoreSelectionCalls++;
                this.start = savedStart;
                this.end = savedEnd;
                return true;
            }
        };
    }

    public focus(): boolean {
        this.isFocused = true;
        return true;
    }

    public insertText(text: string): { success: boolean; method: string } {
        this.insertedTexts.push(text);
        this.value = this.value.slice(0, this.start) + text + this.value.slice(this.end);
        this.start += text.length;
        this.end = this.start;
        return { success: true, method: "mock-insert" };
    }

    public deleteLeft(): boolean {
        if (this.start === 0) return false;
        this.value = this.value.slice(0, this.start - 1) + this.value.slice(this.end);
        this.start--;
        this.end = this.start;
        return true;
    }

    public getText(): string {
        return this.value;
    }
}

// Mock ShadowRoot and Host
class MockShadowRoot {
    public activeElement: Element | null = null;
    public children: any[] = [];

    public appendChild(child: any): any {
        this.children.push(child);
        return child;
    }

    public removeChild(child: any): any {
        const idx = this.children.indexOf(child);
        if (idx >= 0) this.children.splice(idx, 1);
        return child;
    }

    public querySelector(_selector: string): any {
        return null;
    }
}

describe("RegistrationModal & Target Coordination (TC-MODAL-01 .. TC-MODAL-08)", () => {
    let jisyoProvider: SimpleMemoryJisyoProvider;
    let hud: FloatingHUD;
    let adapter: BrowserEditorAdapter;
    let mockTarget: MockOriginalEditorTarget;
    let mockShadow: MockShadowRoot;
    let originalDocument: any;
    let originalWindow: any;

    beforeEach(() => {
        originalDocument = (globalThis as any).document;
        originalWindow = (globalThis as any).window;

        mockShadow = new MockShadowRoot();
        mockTarget = new MockOriginalEditorTarget("初期テキスト", 2, 2);

        (globalThis as any).document = {
            activeElement: null,
            getElementById: () => null,
            querySelector: () => null,
            execCommand: vi.fn(),
            body: {
                appendChild: vi.fn(),
                removeChild: vi.fn()
            },
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            createElement: (tag: string) => {
                const el: any = {
                    tagName: tag.toUpperCase(),
                    type: "text",
                    value: "",
                    selectionStart: 0,
                    selectionEnd: 0,
                    style: {},
                    classList: { add: vi.fn(), remove: vi.fn() },
                    appendChild: vi.fn(),
                    removeChild: vi.fn(),
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                    setSelectionRange(s: number, e: number) {
                        this.selectionStart = s;
                        this.selectionEnd = e;
                    },
                    focus() {
                        (globalThis as any).document.activeElement = el;
                    },
                    closest: () => null,
                    getBoundingClientRect: () => ({ left: 100, top: 200, right: 300, bottom: 230, width: 200, height: 30 }),
                    attachShadow: () => mockShadow
                };
                return el;
            },
            attachShadow: () => mockShadow
        };

        (globalThis as any).window = {
            innerWidth: 1200,
            innerHeight: 800,
            getComputedStyle: () => ({
                paddingLeft: "4px",
                borderLeftWidth: "1px",
                fontSize: "14px",
                fontFamily: "monospace"
            })
        };

        jisyoProvider = new SimpleMemoryJisyoProvider();
        hud = new FloatingHUD();
        adapter = new BrowserEditorAdapter(hud, jisyoProvider, mockTarget.getElement());
    });

    afterEach(() => {
        (globalThis as any).document = originalDocument;
        (globalThis as any).window = originalWindow;
    });

    // -------------------------------------------------------------------------
    // TC-MODAL-01: モーダル起動時のフォーカス移行と元選択範囲の退避
    // -------------------------------------------------------------------------
    describe("TC-MODAL-01: Modal Activation and Selection Saving", () => {
        it("saves original IEditorTarget selection and focuses modal <input>", () => {
            const modal = new RegistrationModal(mockShadow as unknown as ShadowRoot);

            expect(mockTarget.saveSelectionCalls).toBe(0);
            expect(modal.isOpen()).toBe(false);

            const inputEl = modal.open("たんご", "", mockTarget);

            // 1. Original target's selection snapshot was saved
            expect(mockTarget.saveSelectionCalls).toBe(1);

            // 2. Modal is open and active
            expect(modal.isOpen()).toBe(true);
            expect(modal.getActiveInputElement()).toBe(inputEl);

            // 3. Modal input received focus
            expect(inputEl).toBeDefined();
            expect(inputEl.tagName).toBe("INPUT");
        });
    });

    // -------------------------------------------------------------------------
    // TC-MODAL-02: Shadow DOM を横断する getDeepActiveElement の検証
    // -------------------------------------------------------------------------
    describe("TC-MODAL-02: getDeepActiveElement across Shadow DOM Boundaries", () => {
        it("returns document.activeElement when no shadowRoot exists", () => {
            const standardInput = { tagName: "INPUT" };
            (globalThis as any).document.activeElement = standardInput;

            expect(getDeepActiveElement(document)).toBe(standardInput);
        });

        it("traverses shadowRoot boundary to find active <input> inside modal", () => {
            const innerInput = { tagName: "INPUT", id: "skk-registration-input" };
            const shadowRoot = { activeElement: innerInput };
            const hudHost = { tagName: "DIV", id: "skk-hud", shadowRoot };

            (globalThis as any).document.activeElement = hudHost;

            // Must pierce shadowRoot and return the inner <input>
            expect(getDeepActiveElement(document)).toBe(innerInput);
        });

        it("traverses nested shadowRoot levels", () => {
            const innermostInput = { tagName: "INPUT", id: "nested-input" };
            const innerShadow = { activeElement: innermostInput };
            const innerHost = { tagName: "DIV", shadowRoot: innerShadow };
            const outerShadow = { activeElement: innerHost };
            const outerHost = { tagName: "DIV", shadowRoot: outerShadow };

            (globalThis as any).document.activeElement = outerHost;

            expect(getDeepActiveElement(document)).toBe(innermostInput);
        });

        it("returns null when activeElement is null", () => {
            (globalThis as any).document.activeElement = null;
            expect(getDeepActiveElement(document)).toBeNull();
        });
    });

    // -------------------------------------------------------------------------
    // TC-MODAL-03: モーダル内ネイティブカーソル移動と任意位置編集
    // -------------------------------------------------------------------------
    describe("TC-MODAL-03: Native Caret Movement & In-Place Editing inside Modal", () => {
        it("operates at arbitrary caret position instead of appending at end", () => {
            const inputEl = (globalThis as any).document.createElement("input");
            inputEl.value = "abc";
            inputEl.selectionStart = 1;
            inputEl.selectionEnd = 1;

            const target = new InputElementTarget(inputEl as HTMLInputElement);

            // Insert "X" at index 1 -> "aXbc"
            target.insertText("X");
            expect(target.getText()).toBe("aXbc");
            expect(inputEl.selectionStart).toBe(2);

            // Move caret to index 2 and deleteLeft -> deletes "X" -> "abc"
            inputEl.selectionStart = 2;
            inputEl.selectionEnd = 2;
            target.deleteLeft();
            expect(target.getText()).toBe("abc");
            expect(inputEl.selectionStart).toBe(1);
        });
    });

    // -------------------------------------------------------------------------
    // TC-MODAL-04: 部分語編集 (熟語入力・変換後のカーソル移動・一部削除・辞書登録)
    // -------------------------------------------------------------------------
    describe("TC-MODAL-04: Partial Word Editing in Modal", () => {
        it("inputs 'とうきょう' -> converts to '東京' -> moves caret before '京' -> deletes '東' -> registers '京'", async () => {
            await jisyoProvider.registerCandidate("とうきょう", new Candidate("東京"));

            await adapter.openRegistrationEditor("しゅと", "");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;
            expect(regMode).toBeInstanceOf(RegistrationMode);

            // Type "とうきょう" with midashigo and convert to "東京"
            await regMode.upperAlphabetInput("T");
            await regMode.lowerAlphabetInput("o");
            await regMode.lowerAlphabetInput("u");
            await regMode.lowerAlphabetInput("k");
            await regMode.lowerAlphabetInput("y");
            await regMode.lowerAlphabetInput("o");
            await regMode.lowerAlphabetInput("u");
            await regMode.spaceInput();

            expect(regMode.getMiniBufferEditor().getCurrentCandidate()?.word).toBe("東京");

            // Fixate candidate into modal input (via Enter or Ctrl+j)
            await regMode.enterInput();
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("東京");

            // User moves caret between "東" and "京" (selectionStart = 1, selectionEnd = 1)
            const modalTarget = (regMode.getMiniBufferEditor() as any).getTarget?.() as IEditorTarget;
            expect(modalTarget).toBeDefined();
            const el = modalTarget.getElement() as HTMLInputElement;
            el.setSelectionRange(1, 1);
            // Backspace deletes "東"
            await regMode.backspaceInput();
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("京");

            // Confirm registration of "京" for "しゅと"
            await regMode.enterInput();

            // Registered candidate is "京"
            const entry = await jisyoProvider.lookupCandidates("しゅと");
            expect(entry).toBeDefined();
            expect(entry?.getCandidateList().some((c) => c.word === "京")).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // TC-MODAL-05: モーダル内での 'l' (AsciiMode) -> 'Ctrl+j' (かな復帰)
    // -------------------------------------------------------------------------
    describe("TC-MODAL-05: Ascii Mode Transition & Ctrl+j Restoration in Modal", () => {
        it("switches to AsciiMode on 'l' and restores HiraganaMode on Ctrl+j inside modal", async () => {
            await adapter.openRegistrationEditor("たんご", "");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;
            expect(regMode).toBeInstanceOf(RegistrationMode);

            // Initially internalMode is HiraganaMode
            expect(regMode.getInternalMode()).toBeInstanceOf(HiraganaMode);

            // User types 'l' to switch to AsciiMode
            await regMode.lowerAlphabetInput("l");
            expect(regMode.getInternalMode()).toBeInstanceOf(AsciiMode);

            // User types ascii letters
            await regMode.lowerAlphabetInput("a");
            await regMode.lowerAlphabetInput("b");
            await regMode.lowerAlphabetInput("c");

            // User presses Ctrl+j
            await regMode.ctrlJInput();

            // Specification (Section 2.3):
            // When internalMode is AsciiMode, Ctrl+j restores HiraganaMode!
            // Mode remains in RegistrationMode!
            expect(adapter.getCurrentInputMode()).toBe(regMode);
            expect(regMode.getInternalMode()).toBeInstanceOf(HiraganaMode);
        });
    });

    // -------------------------------------------------------------------------
    // TC-MODAL-06: 登録完了時の辞書保存・モーダル終了・元ターゲット復元 & 文字列挿入
    // -------------------------------------------------------------------------
    describe("TC-MODAL-06: Confirm Registration, Focus & Selection Restoration", () => {
        it("registers word, closes modal, restores original target focus/selection, and inserts text", async () => {
            const modal = new RegistrationModal(mockShadow as unknown as ShadowRoot);
            modal.open("とうろく", "", mockTarget);
            expect(modal.isOpen()).toBe(true);

            await adapter.openRegistrationEditor("とうろく", "");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;

            // Type "新規"
            await regMode.getMiniBufferEditor().insertOrReplaceSelection("新規");

            // Confirm registration on non-composing Enter
            await regMode.enterInput();

            // 1. Registered in jisyo
            const entry = await jisyoProvider.lookupCandidates("とうろく");
            expect(entry).toBeDefined();
            expect(entry?.getCandidateList().some((c) => c.word === "新規")).toBe(true);

            // 2. Original target restored and text inserted
            expect(mockTarget.restoreSelectionCalls).toBeGreaterThanOrEqual(1);
            expect(mockTarget.insertedTexts).toContain("新規");
            expect(mockTarget.getText()).toBe("初期新規テキスト");

            // 3. Modal closed
            expect(modal.isOpen()).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // TC-MODAL-07: 空文字 Enter 中断復帰 および Escape / Ctrl+g キャンセル
    // -------------------------------------------------------------------------
    describe("TC-MODAL-07: Modal Abort & Cancel Restoration", () => {
        it("aborts registration on empty Enter and restores previous InlineHenkan candidate", async () => {
            (jisyoProvider as any).dictionary.delete("てすと");
            await jisyoProvider.registerCandidate("てすと", new Candidate("候補2"));
            await jisyoProvider.registerCandidate("てすと", new Candidate("候補1"));

            const hMode = HiraganaMode.getInstance();
            adapter.setInputMode(hMode);

            // Midashigo "てすと"
            await hMode.upperAlphabetInput("T");
            await hMode.lowerAlphabetInput("e");
            await hMode.lowerAlphabetInput("s");
            await hMode.lowerAlphabetInput("u");
            await hMode.lowerAlphabetInput("t");
            await hMode.lowerAlphabetInput("o");

            // Convert to candidates and exhaust -> enters RegistrationMode
            await hMode.spaceInput(); // 候補1
            await hMode.spaceInput(); // 候補2 (last)
            await hMode.spaceInput(); // exhausts -> opens registration

            expect(adapter.getCurrentInputMode()).toBeInstanceOf(RegistrationMode);
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;

            // Empty Enter aborts registration
            await regMode.enterInput();

            // Restores InlineHenkanMode with last candidate
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
            const restoredHMode = adapter.getCurrentInputMode() as HiraganaMode;
            expect(restoredHMode.getHenkanMode()).toBeInstanceOf(InlineHenkanMode);
            expect(adapter.getCurrentCandidate()?.word).toBe("候補2");
        });

        it("cancels registration on Escape / Ctrl+g and restores original target without modifying dictionary", async () => {
            await adapter.openRegistrationEditor("きゃんせる", "");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;

            await regMode.escapeInput();

            // Not registered
            const entry = await jisyoProvider.lookupCandidates("きゃんせる");
            expect(entry).toBeUndefined();

            // Restored to HiraganaMode
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
        });
    });

    // -------------------------------------------------------------------------
    // TC-MODAL-08: 再帰登録 (depth 2) セッション別 <input> と親入力・Undo 保護
    // -------------------------------------------------------------------------
    describe("TC-MODAL-08: Recursive Registration Session Management", () => {
        it("creates new <input> for depth 2, hides parent <input>, and inserts child word into parent on confirm", () => {
            const modal = new RegistrationModal(mockShadow as unknown as ShadowRoot);

            // Depth 1: Parent session
            const parentInput = modal.open("ふくごうご", "", mockTarget);
            expect(modal.getDepth()).toBe(1);
            expect(modal.getActiveInputElement()).toBe(parentInput);
            parentInput.value = "複合";
            parentInput.setSelectionRange(2, 2);

            // Depth 2: Child session triggered
            const childInput = modal.pushSession("たんご", "");
            expect(modal.getDepth()).toBe(2);
            expect(childInput).not.toBeNull();
            expect(childInput).not.toBe(parentInput);
            expect(modal.getActiveInputElement()).toBe(childInput);

            // Parent input is hidden but intact in DOM
            expect(parentInput.style.display).toBe("none");
            expect(parentInput.value).toBe("複合");

            // Child inputs "単語"
            childInput!.value = "単語";

            // Child session finishes on confirm -> pops to parent
            const restoredParent = modal.popSession();
            expect(modal.getDepth()).toBe(1);
            expect(restoredParent).toBe(parentInput);
            expect(parentInput.style.display).toBe("");
            expect(modal.getActiveInputElement()).toBe(parentInput);
        });

        it("TC-MODAL-08b: rejects pushing sessions beyond MAX_REGISTRATION_DEPTH (depth 5)", () => {
            const modal = new RegistrationModal(mockShadow as unknown as ShadowRoot);
            modal.open("レベル1", "", mockTarget);
            expect(modal.getDepth()).toBe(1);

            expect(modal.pushSession("レベル2", "")).not.toBeNull();
            expect(modal.getDepth()).toBe(2);

            expect(modal.pushSession("レベル3", "")).not.toBeNull();
            expect(modal.getDepth()).toBe(3);

            expect(modal.pushSession("レベル4", "")).not.toBeNull();
            expect(modal.getDepth()).toBe(4);

            expect(modal.pushSession("レベル5", "")).not.toBeNull();
            expect(modal.getDepth()).toBe(5);

            // 6th session exceeds MAX_REGISTRATION_DEPTH (5) -> returns null
            const beyondMax = modal.pushSession("レベル6", "");
            expect(beyondMax).toBeNull();
            expect(modal.getDepth()).toBe(5);
        });
    });
});
