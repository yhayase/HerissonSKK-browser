import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SimpleMemoryJisyoProvider } from "../../src/core/skk/jisyo/SimpleMemoryJisyoProvider";
import { BrowserEditorAdapter } from "../../src/adapter/BrowserEditorAdapter";
import { Candidate } from "../../src/core/skk/jisyo/candidate";
import { EditorFactory } from "../../src/core/skk/editor/EditorFactory";
import { HiraganaMode } from "../../src/core/skk/input-mode/HiraganaMode";
import { KatakanaMode } from "../../src/core/skk/input-mode/KatakanaMode";
import { AsciiMode } from "../../src/core/skk/input-mode/AsciiMode";
import { ZeneiMode } from "../../src/core/skk/input-mode/ZeneiMode";
import { DeleteLeftResult } from "../../src/core/skk/editor/IEditor";
import { FloatingHUD } from "../../src/hud/FloatingHUD";
import { getActiveCaretCoordinates } from "../../src/adapter/CaretPosition";
import { insertText, isInputElement, isTextAreaElement, isSelectableInput } from "../../src/adapter/TextInserter";

// --- Mock DOM Environment Setup for Unit Testing ---

class MockDOMElement {
    public tagName: string = "INPUT";
    public type: string = "text";
    public value: string = "";
    public selectionStart: number = 0;
    public selectionEnd: number = 0;
    public events: Event[] = [];

    setSelectionRange(start: number, end: number): void {
        this.selectionStart = start;
        this.selectionEnd = end;
    }

    dispatchEvent(event: Event): boolean {
        this.events.push(event);
        return true;
    }

    focus(): void {
        if (typeof document !== "undefined") {
            (document as any).activeElement = this;
        }
    }

    closest(selector: string): any {
        return null;
    }

    getBoundingClientRect() {
        return {
            left: 100,
            top: 200,
            right: 300,
            bottom: 230,
            width: 200,
            height: 30
        };
    }
}

class MockNonTextInputElement {
    public tagName: string = "INPUT";
    public type: string;
    public value: string = "";
    public events: Event[] = [];

    constructor(type: string = "number", initialValue: string = "") {
        this.type = type;
        this.value = initialValue;
    }

    get selectionStart(): number {
        throw new DOMException(
            `Failed to read the 'selectionStart' property from 'HTMLInputElement': The input element's type ('${this.type}') does not support selection.`,
            "InvalidStateError"
        );
    }

    set selectionStart(_val: number) {
        throw new DOMException(
            `Failed to set the 'selectionStart' property on 'HTMLInputElement': The input element's type ('${this.type}') does not support selection.`,
            "InvalidStateError"
        );
    }

    get selectionEnd(): number {
        throw new DOMException(
            `Failed to read the 'selectionEnd' property from 'HTMLInputElement': The input element's type ('${this.type}') does not support selection.`,
            "InvalidStateError"
        );
    }

    set selectionEnd(_val: number) {
        throw new DOMException(
            `Failed to set the 'selectionEnd' property on 'HTMLInputElement': The input element's type ('${this.type}') does not support selection.`,
            "InvalidStateError"
        );
    }

    setSelectionRange(_start: number, _end: number): void {
        throw new DOMException(
            `Failed to execute 'setSelectionRange' on 'HTMLInputElement': The input element's type ('${this.type}') does not support selection.`,
            "InvalidStateError"
        );
    }

    dispatchEvent(event: Event): boolean {
        this.events.push(event);
        return true;
    }

    focus(): void {
        if (typeof document !== "undefined") {
            (document as any).activeElement = this;
        }
    }

    closest(_selector: string): any {
        return null;
    }

    getBoundingClientRect() {
        return {
            left: 100,
            top: 200,
            right: 300,
            bottom: 230,
            width: 200,
            height: 30
        };
    }
}

describe("SimpleMemoryJisyoProvider", () => {
    let provider: SimpleMemoryJisyoProvider;

    beforeEach(() => {
        provider = new SimpleMemoryJisyoProvider();
    });

    describe("Seeded Vocabulary Lookup", () => {
        it("contains seeded Okuri-nasi entries", async () => {
            const okuriNasiKeys = [
                { key: "にほん", expected: "日本" },
                { key: "とうきょう", expected: "東京" },
                { key: "かんじ", expected: "漢字" },
                { key: "へんかん", expected: "変換" },
                { key: "がっこう", expected: "学校" },
                { key: "えでぃた", expected: "エディタ" },
                { key: "すっく", expected: "SKK" },
                { key: "こーど", expected: "コード" },
                { key: "てすと", expected: "テスト" }
            ];

            for (const { key, expected } of okuriNasiKeys) {
                const entry = await provider.lookupCandidates(key);
                expect(entry).toBeDefined();
                expect(entry?.getCandidateList()[0]?.word).toBe(expected);
            }
        });

        it("contains seeded Okuri-ari entries", async () => {
            const okuriAriKeys = [
                { key: "いk", expectedStem: "行" },
                { key: "あu", expectedStem: "合" },
                { key: "はしr", expectedStem: "走" },
                { key: "およg", expectedStem: "泳" },
                { key: "たべr", expectedStem: "食" }
            ];

            for (const { key, expectedStem } of okuriAriKeys) {
                const entry = await provider.lookupCandidates(key);
                expect(entry).toBeDefined();
                expect(entry?.getCandidateList()[0]?.word).toBe(expectedStem);
            }
        });

        it("contains seeded Prefix / Suffix entries", async () => {
            const prefixSuffixKeys = [
                { key: "だい>", expected: "大" },
                { key: "とうきょう>", expected: "東京都" },
                { key: "さま>", expected: "様" },
                { key: ">さま", expected: "様" },
                { key: "さん>", expected: "様" },
                { key: ">さん", expected: "様" }
            ];

            for (const { key, expected } of prefixSuffixKeys) {
                const entry = await provider.lookupCandidates(key);
                expect(entry).toBeDefined();
                expect(entry?.getCandidateList()[0]?.word).toBe(expected);
            }
        });

        it("returns undefined for unknown keys", async () => {
            const entry = await provider.lookupCandidates("そんざいしないきー");
            expect(entry).toBeUndefined();
        });
    });

    describe("Registration, Reordering, and Deletion", () => {
        it("registers new candidate for a key", async () => {
            await provider.registerCandidate("しんき", new Candidate("新規"));
            const entry = await provider.lookupCandidates("しんき");
            expect(entry).toBeDefined();
            expect(entry?.getCandidateList()[0]?.word).toBe("新規");
        });

        it("moves existing candidate to front when registered again", async () => {
            await provider.registerCandidate("てすと", new Candidate("テスト2"));
            await provider.registerCandidate("てすと", new Candidate("テスト"));

            const entry = await provider.lookupCandidates("てすと");
            expect(entry?.getCandidateList()[0]?.word).toBe("テスト");
            expect(entry?.getCandidateList()[1]?.word).toBe("テスト2");
        });

        it("reorders candidate by moving selected index to front", async () => {
            await provider.registerCandidate("てすと", new Candidate("候補3"));
            await provider.registerCandidate("てすと", new Candidate("候補2"));
            await provider.registerCandidate("てすと", new Candidate("候補1"));

            // Before: [候補1, 候補2, 候補3, テスト]
            let entry = await provider.lookupCandidates("てすと");
            expect(entry?.getCandidateList()[0]?.word).toBe("候補1");

            // Reorder index 2 (候補3) to front
            const success = await provider.reorderCandidate("てすと", 2);
            expect(success).toBe(true);

            entry = await provider.lookupCandidates("てすと");
            expect(entry?.getCandidateList()[0]?.word).toBe("候補3");
            expect(entry?.getCandidateList()[1]?.word).toBe("候補1");
        });

        it("returns false when reordering with invalid index", async () => {
            expect(await provider.reorderCandidate("てすと", 99)).toBe(false);
            expect(await provider.reorderCandidate("そんざいしない", 0)).toBe(false);
        });

        it("deletes a candidate and removes key when candidates list is empty", async () => {
            const cand = new Candidate("学校");
            const deleted = await provider.deleteCandidate("がっこう", cand);
            expect(deleted).toBe(true);

            const entry = await provider.lookupCandidates("がっこう");
            expect(entry).toBeUndefined();
        });

        it("returns false when deleting non-existent candidate", async () => {
            const deleted = await provider.deleteCandidate("とうきょう", new Candidate("京都"));
            expect(deleted).toBe(false);
        });

        it("resets dictionary back to default seed vocabulary", async () => {
            await provider.registerCandidate("しんき", new Candidate("新規"));
            expect(provider.hasKey("しんき")).toBe(true);

            provider.reset();
            expect(provider.hasKey("しんき")).toBe(false);
            expect(provider.hasKey("にほん")).toBe(true);
        });
    });
});

describe("BrowserEditorAdapter", () => {
    let originalDocument: any;
    let originalWindow: any;
    let originalHTMLInputElement: any;
    let originalHTMLTextAreaElement: any;
    let originalEvent: any;

    let mockElement: MockDOMElement;
    let hud: FloatingHUD;
    let jisyoProvider: SimpleMemoryJisyoProvider;
    let adapter: BrowserEditorAdapter;

    beforeEach(() => {
        originalDocument = (globalThis as any).document;
        originalWindow = (globalThis as any).window;
        originalHTMLInputElement = (globalThis as any).HTMLInputElement;
        originalHTMLTextAreaElement = (globalThis as any).HTMLTextAreaElement;
        originalEvent = (globalThis as any).Event;

        mockElement = new MockDOMElement();

        (globalThis as any).HTMLInputElement = MockDOMElement;
        (globalThis as any).HTMLTextAreaElement = MockDOMElement;

        (globalThis as any).Event = class MockEvent {
            type: string;
            bubbles: boolean;
            constructor(type: string, options?: { bubbles?: boolean }) {
                this.type = type;
                this.bubbles = options?.bubbles ?? false;
            }
        };

        (globalThis as any).document = {
            activeElement: mockElement,
            createElement: () => ({
                style: {},
                classList: { add: () => {}, remove: () => {} },
                appendChild: () => {},
                removeChild: () => {},
                attachShadow: () => ({ appendChild: () => {} }),
                addEventListener: () => {},
                removeEventListener: () => {}
            }),
            getElementById: () => null,
            querySelector: () => null,
            execCommand: () => false, // triggers fallback in TextInserter
            addEventListener: () => {},
            removeEventListener: () => {}
        };

        (globalThis as any).window = {
            innerWidth: 1200,
            innerHeight: 800,
            getComputedStyle: () => ({
                paddingLeft: "4px",
                borderLeftWidth: "1px",
                fontSize: "14px",
                fontFamily: "monospace",
                lineHeight: "20px"
            }),
            getSelection: () => null
        };

        hud = new FloatingHUD();
        jisyoProvider = new SimpleMemoryJisyoProvider();
        adapter = new BrowserEditorAdapter(hud, jisyoProvider, mockElement as unknown as Element);
        EditorFactory.setInstance(adapter);
    });

    afterEach(() => {
        EditorFactory.reset();
        (globalThis as any).document = originalDocument;
        (globalThis as any).window = originalWindow;
        (globalThis as any).HTMLInputElement = originalHTMLInputElement;
        (globalThis as any).HTMLTextAreaElement = originalHTMLTextAreaElement;
        (globalThis as any).Event = originalEvent;
    });

    describe("1. Architectural Design: In-Memory Preedit & Zero DOM Churn", () => {
        it("keeps midashigo in memory and DOES NOT insert into DOM text", async () => {
            adapter.setMidashigoStartToCurrentPosition();
            expect(adapter.isInMidashigo()).toBe(true);

            // Simulate typing '▽とうきょう' in midashigo mode
            await adapter.insertOrReplaceSelection("▽とうきょう");

            // DOM must remain completely empty!
            expect(mockElement.value).toBe("");

            // In-memory midashigo extracted without '▽'
            expect(adapter.extractMidashigo()).toBe("とうきょう");

            // FloatingHUD should display the preedit with '▽'
            const hudState = hud.getState();
            expect(hudState?.preedit).toBe("▽とうきょう");
            expect(hudState?.candidate).toBeUndefined();
        });

        it("updates HUD with candidate without touching DOM text", async () => {
            adapter.setMidashigoStartToCurrentPosition();
            await adapter.insertOrReplaceSelection("▽とうきょう");
            expect(mockElement.value).toBe("");

            // Show candidate in HUD
            await adapter.showCandidate(new Candidate("東京"), "", "");

            // DOM must still be completely empty!
            expect(mockElement.value).toBe("");

            const hudState = hud.getState();
            expect(hudState?.candidate).toBe("東京");
        });

        it("commits text to DOM ONLY upon fixateCandidate", async () => {
            adapter.setMidashigoStartToCurrentPosition();
            await adapter.insertOrReplaceSelection("▽とうきょう");
            await adapter.showCandidate(new Candidate("東京"), "", "");
            expect(mockElement.value).toBe("");

            // Fixate candidate commits to DOM
            const fixated = await adapter.fixateCandidate("東京");
            expect(fixated).toBe(true);
            expect(mockElement.value).toBe("東京");

            // State and HUD are reset
            expect(adapter.isInMidashigo()).toBe(false);
            expect(adapter.extractMidashigo()).toBeUndefined();
            expect(adapter.getCurrentCandidate()).toBeUndefined();

            const hudState = hud.getState();
            expect(hudState?.preedit).toBe("");
            expect(hudState?.candidate).toBeUndefined();
        });

        it("clears preedit and candidate on cancel without polluting DOM", async () => {
            adapter.setMidashigoStartToCurrentPosition();
            await adapter.insertOrReplaceSelection("▽とうきょう");
            await adapter.showCandidate(new Candidate("東京"), "", "");
            expect(mockElement.value).toBe("");

            // Clear candidate (e.g. back to midashigo)
            await adapter.clearCandidate();
            expect(adapter.getCurrentCandidate()).toBeUndefined();
            expect(mockElement.value).toBe("");

            // Clear midashigo (e.g. Ctrl+g)
            await adapter.clearMidashigo();
            expect(adapter.isInMidashigo()).toBe(false);
            expect(adapter.extractMidashigo()).toBeUndefined();
            expect(mockElement.value).toBe("");

            const hudState = hud.getState();
            expect(hudState?.preedit).toBe("");
            expect(hudState?.candidate).toBeUndefined();
        });
    });

    describe("2. KakuteiMode Direct Commit", () => {
        it("directly commits finalized characters in KakuteiMode via insertText", async () => {
            expect(adapter.isInMidashigo()).toBe(false);

            await adapter.insertOrReplaceSelection("あ");
            expect(mockElement.value).toBe("あ");

            await adapter.insertOrReplaceSelection("い");
            expect(mockElement.value).toBe("あい");
        });

        it("shows pending romaji in HUD and commits when completed", async () => {
            const hiraganaMode = HiraganaMode.getInstance();
            adapter.setInputMode(hiraganaMode);

            // User types 'k': pending romaji
            await hiraganaMode.lowerAlphabetInput("k");
            expect(mockElement.value).toBe("");
            expect(hud.getState()?.preedit).toBe("k");

            // User types 'a': completes 'か' -> committed to DOM
            await hiraganaMode.lowerAlphabetInput("a");
            expect(mockElement.value).toBe("か");
            expect(hud.getState()?.preedit).toBe("");
        });
    });

    describe("3. Input Mode Switching and Badges", () => {
        it("updates HUD badge for all modes ([かな], [カナ], [全英], [アスキー])", async () => {
            const hiraganaMode = HiraganaMode.getInstance();
            adapter.setInputMode(hiraganaMode);
            expect(adapter.getModeBadgeText()).toBe("かな");
            expect(hud.getState()?.mode).toBe("かな");

            // 'q' toggles to Katakana
            await hiraganaMode.lowerAlphabetInput("q");
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(KatakanaMode);
            expect(adapter.getModeBadgeText()).toBe("カナ");
            expect(hud.getState()?.mode).toBe("カナ");

            // 'L' switches to Zenei
            await adapter.getCurrentInputMode().upperAlphabetInput("L");
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(ZeneiMode);
            expect(adapter.getModeBadgeText()).toBe("全英");
            expect(hud.getState()?.mode).toBe("全英");

            // Ctrl+j switches back to Hiragana
            await adapter.getCurrentInputMode().ctrlJInput();
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
            expect(adapter.getModeBadgeText()).toBe("かな");

            // 'l' switches to Ascii
            await adapter.getCurrentInputMode().lowerAlphabetInput("l");
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(AsciiMode);
            expect(adapter.getModeBadgeText()).toBe("アスキー");
            expect(hud.getState()?.mode).toBe("アスキー");
        });
    });

    describe("4. End-to-End Okuri-nasi Conversion", () => {
        it("converts 'とうきょう' to '東京' using seeded vocabulary", async () => {
            const mode = HiraganaMode.getInstance();
            adapter.setInputMode(mode);

            // Type Toukyou with initial uppercase 'T'
            await mode.upperAlphabetInput("T");
            expect(adapter.isInMidashigo()).toBe(true);
            expect(mockElement.value).toBe("");

            await mode.lowerAlphabetInput("o");
            await mode.lowerAlphabetInput("u");
            await mode.lowerAlphabetInput("k");
            await mode.lowerAlphabetInput("y");
            await mode.lowerAlphabetInput("o");
            await mode.lowerAlphabetInput("u");

            expect(adapter.extractMidashigo()).toBe("とうきょう");
            expect(mockElement.value).toBe("");
            expect(hud.getState()?.preedit).toBe("▽とうきょう");

            // Space triggers conversion
            await mode.spaceInput();
            expect(mockElement.value).toBe(""); // DOM still untouched!
            expect(hud.getState()?.candidate).toBe("東京");

            // Ctrl+j fixates candidate
            await mode.ctrlJInput();
            expect(mockElement.value).toBe("東京");
            expect(adapter.isInMidashigo()).toBe(false);
            expect(hud.getState()?.candidate).toBeUndefined();
        });

        it("converts 'にほん' to '日本' and commits on Enter", async () => {
            const mode = HiraganaMode.getInstance();
            adapter.setInputMode(mode);

            await mode.upperAlphabetInput("N");
            await mode.lowerAlphabetInput("i");
            await mode.lowerAlphabetInput("h");
            await mode.lowerAlphabetInput("o");
            await mode.lowerAlphabetInput("n");

            // Space converts to '日本'
            await mode.spaceInput();
            expect(mockElement.value).toBe("");
            expect(hud.getState()?.candidate).toBe("日本");

            // Enter fixates and inserts newline
            await mode.enterInput();
            expect(mockElement.value).toBe("日本\n");
            expect(adapter.isInMidashigo()).toBe(false);
        });
    });

    describe("5. Candidate Cycling and Reverting with 'x'", () => {
        it("cycles forward with Space and backward with 'x'", async () => {
            const provider = adapter.getJisyoProvider();
            await provider.registerCandidate("てすと", new Candidate("テスト3"));
            await provider.registerCandidate("てすと", new Candidate("テスト2"));
            await provider.registerCandidate("てすと", new Candidate("テスト1"));

            const mode = HiraganaMode.getInstance();
            adapter.setInputMode(mode);

            await mode.upperAlphabetInput("T");
            await mode.lowerAlphabetInput("e");
            await mode.lowerAlphabetInput("s");
            await mode.lowerAlphabetInput("u");
            await mode.lowerAlphabetInput("t");
            await mode.lowerAlphabetInput("o");

            // 1st candidate
            await mode.spaceInput();
            expect(hud.getState()?.candidate).toBe("テスト1");
            expect(mockElement.value).toBe("");

            // 2nd candidate
            await mode.spaceInput();
            expect(hud.getState()?.candidate).toBe("テスト2");

            // 3rd candidate
            await mode.spaceInput();
            expect(hud.getState()?.candidate).toBe("テスト3");

            // Back-cycle with 'x' to 2nd candidate
            await mode.lowerAlphabetInput("x");
            expect(hud.getState()?.candidate).toBe("テスト2");

            // Back-cycle with 'x' to 1st candidate
            await mode.lowerAlphabetInput("x");
            expect(hud.getState()?.candidate).toBe("テスト1");

            // Back-cycle with 'x' returns to MidashigoMode
            await mode.lowerAlphabetInput("x");
            expect(adapter.isInMidashigo()).toBe(true);
            expect(adapter.extractMidashigo()).toBe("てすと");
            expect(hud.getState()?.preedit).toBe("▽てすと");
            expect(hud.getState()?.candidate).toBeUndefined();

            // Re-convert with Space and fixate with Ctrl+j
            await mode.spaceInput();
            expect(hud.getState()?.candidate).toBe("テスト1");

            await mode.ctrlJInput();
            expect(mockElement.value).toBe("テスト1");
        });
    });

    describe("6. End-to-End Okuri-ari Conversion", () => {
        it("converts 'I' -> 'K' -> 'u' to '行く' using seeded vocabulary", async () => {
            const mode = HiraganaMode.getInstance();
            adapter.setInputMode(mode);

            // 'I' starts midashigo
            await mode.upperAlphabetInput("I");
            expect(hud.getState()?.preedit).toBe("▽い");
            expect(mockElement.value).toBe("");

            // 'K' triggers okurigana mode
            await mode.upperAlphabetInput("K");
            expect(adapter.isOkuriStateActive()).toBe(true);
            expect(hud.getState()?.preedit).toBe("▽い*k");

            // 'u' completes okuri 'く' -> looks up 'いk' -> candidate '行' + okuri 'く'
            await mode.lowerAlphabetInput("u");
            expect(mockElement.value).toBe("");
            expect(hud.getState()?.candidate).toBe("行く");

            // Fixate with Ctrl+j
            await mode.ctrlJInput();
            expect(mockElement.value).toBe("行く");
            expect(adapter.isInMidashigo()).toBe(false);
        });

        it("converts 'A' -> 'U' to '合う' using direct vowel okuri", async () => {
            const mode = HiraganaMode.getInstance();
            adapter.setInputMode(mode);

            await mode.upperAlphabetInput("A");
            await mode.upperAlphabetInput("U");
            expect(hud.getState()?.candidate).toBe("合う");
            expect(mockElement.value).toBe("");

            await mode.ctrlJInput();
            expect(mockElement.value).toBe("合う");
        });

        it("converts 'H' 'a' 's' 'i' 'R' 'u' to '走る'", async () => {
            const mode = HiraganaMode.getInstance();
            adapter.setInputMode(mode);

            await mode.upperAlphabetInput("H");
            await mode.lowerAlphabetInput("a");
            await mode.lowerAlphabetInput("s");
            await mode.lowerAlphabetInput("i");
            await mode.upperAlphabetInput("R");
            await mode.lowerAlphabetInput("u");
            expect(hud.getState()?.candidate).toBe("走る");

            await mode.ctrlJInput();
            expect(mockElement.value).toBe("走る");
        });
    });

    describe("7. Prefix and Suffix Conversion ('>')", () => {
        it("converts prefix with '>' ('D' 'a' 'i' '>' -> '大')", async () => {
            const mode = HiraganaMode.getInstance();
            adapter.setInputMode(mode);

            await mode.upperAlphabetInput("D");
            await mode.lowerAlphabetInput("a");
            await mode.lowerAlphabetInput("i");
            await mode.symbolInput(">");

            expect(hud.getState()?.candidate).toBe("大");
            expect(mockElement.value).toBe("");

            await mode.ctrlJInput();
            expect(mockElement.value).toBe("大");
        });

        it("converts suffix with '>' after fixating prefix word", async () => {
            const provider = adapter.getJisyoProvider();
            await provider.registerCandidate("こばやし", new Candidate("小林"));

            const mode = HiraganaMode.getInstance();
            adapter.setInputMode(mode);

            // Convert Kobayashi -> 小林
            await mode.upperAlphabetInput("K");
            await mode.lowerAlphabetInput("o");
            await mode.lowerAlphabetInput("b");
            await mode.lowerAlphabetInput("a");
            await mode.lowerAlphabetInput("y");
            await mode.lowerAlphabetInput("a");
            await mode.lowerAlphabetInput("s");
            await mode.lowerAlphabetInput("i");
            await mode.spaceInput();
            expect(hud.getState()?.candidate).toBe("小林");

            // Press '>' during inline henkan: fixates '小林' to DOM and starts suffix midashigo '▽>'
            await mode.symbolInput(">");
            expect(mockElement.value).toBe("小林");
            expect(adapter.isInMidashigo()).toBe(true);

            // Type 'san'
            await mode.lowerAlphabetInput("s");
            await mode.lowerAlphabetInput("a");
            await mode.lowerAlphabetInput("n");

            // Convert suffix
            await mode.spaceInput();
            expect(hud.getState()?.candidate).toBe("様");

            // Fixate suffix
            await mode.ctrlJInput();
            expect(mockElement.value).toBe("小林様");
        });
    });

    describe("8. Toggle Character Type with 'q' in Midashigo", () => {
        it("toggles midashigo from Hiragana to Katakana and fixates to DOM", async () => {
            const mode = HiraganaMode.getInstance();
            adapter.setInputMode(mode);

            await mode.upperAlphabetInput("K");
            await mode.lowerAlphabetInput("a");
            expect(adapter.extractMidashigo()).toBe("か");
            expect(mockElement.value).toBe("");

            // 'q' toggles to katakana 'カ' and fixates
            await mode.lowerAlphabetInput("q");
            expect(mockElement.value).toBe("カ");
            expect(adapter.isInMidashigo()).toBe(false);
            expect(hud.getState()?.preedit).toBe("");
        });
    });

    describe("9. Cancel Operations with Ctrl+g", () => {
        it("cancels midashigo mode with Ctrl+g back to KakuteiMode without modifying DOM", async () => {
            const mode = HiraganaMode.getInstance();
            adapter.setInputMode(mode);

            await mode.upperAlphabetInput("K");
            await mode.lowerAlphabetInput("a");
            expect(mockElement.value).toBe("");
            expect(hud.getState()?.preedit).toBe("▽か");

            // Ctrl+g clears midashigo
            await mode.ctrlGInput();
            expect(mockElement.value).toBe("");
            expect(adapter.isInMidashigo()).toBe(false);
            expect(hud.getState()?.preedit).toBe("");
        });

        it("cancels candidate with Ctrl+g back to midashigo", async () => {
            const mode = HiraganaMode.getInstance();
            adapter.setInputMode(mode);

            await mode.upperAlphabetInput("K");
            await mode.lowerAlphabetInput("a");
            await mode.lowerAlphabetInput("n");
            await mode.lowerAlphabetInput("j");
            await mode.lowerAlphabetInput("i");
            await mode.spaceInput();
            expect(hud.getState()?.candidate).toBe("漢字");
            expect(mockElement.value).toBe("");

            // 1st Ctrl+g returns to midashigo
            await mode.ctrlGInput();
            expect(adapter.isInMidashigo()).toBe(true);
            expect(adapter.extractMidashigo()).toBe("かんじ");
            expect(hud.getState()?.candidate).toBeUndefined();
            expect(hud.getState()?.preedit).toBe("▽かんじ");
            expect(mockElement.value).toBe("");

            // 2nd Ctrl+g cancels midashigo
            await mode.ctrlGInput();
            expect(adapter.isInMidashigo()).toBe(false);
            expect(mockElement.value).toBe("");
        });
    });

    describe("10. DeleteLeft (Backspace) Handling", () => {
        it("deletes midashigo characters in memory and returns markerDeleted when empty", async () => {
            adapter.setMidashigoStartToCurrentPosition();
            await adapter.insertOrReplaceSelection("▽か");
            expect(adapter.extractMidashigo()).toBe("か");

            // 1st backspace deletes 'か' -> midashigo empty -> markerDeleted
            const res1 = await adapter.deleteLeft();
            expect(res1).toBe(DeleteLeftResult.markerDeleted);
            expect(adapter.isInMidashigo()).toBe(false);
            expect(mockElement.value).toBe("");
        });

        it("deletes multi-character midashigo character by character", async () => {
            adapter.setMidashigoStartToCurrentPosition();
            await adapter.insertOrReplaceSelection("▽かんじ");

            const res1 = await adapter.deleteLeft();
            expect(res1).toBe(DeleteLeftResult.otherCharacterDeleted);
            expect(adapter.extractMidashigo()).toBe("かん");

            const res2 = await adapter.deleteLeft();
            expect(res2).toBe(DeleteLeftResult.otherCharacterDeleted);
            expect(adapter.extractMidashigo()).toBe("か");

            const res3 = await adapter.deleteLeft();
            expect(res3).toBe(DeleteLeftResult.markerDeleted);
            expect(adapter.isInMidashigo()).toBe(false);
        });

        it("deletes character from DOM in KakuteiMode when not in midashigo", async () => {
            mockElement.value = "あいう";
            mockElement.selectionStart = 3;
            mockElement.selectionEnd = 3;

            expect(adapter.isInMidashigo()).toBe(false);
            const res = await adapter.deleteLeft();
            expect(res).toBe(DeleteLeftResult.otherCharacterDeleted);
            expect(mockElement.value).toBe("あい");
        });
    });

    describe("11. Non-Text Inputs and Cross-Realm Resilience (Task 3 Phase 2)", () => {
        it("isSelectableInput identifies selectable vs non-selectable inputs correctly", () => {
            expect(isSelectableInput({ type: "text" } as HTMLInputElement)).toBe(true);
            expect(isSelectableInput({ type: "TEXT" } as HTMLInputElement)).toBe(true);
            expect(isSelectableInput({ type: "search" } as HTMLInputElement)).toBe(true);
            expect(isSelectableInput({ type: "url" } as HTMLInputElement)).toBe(true);
            expect(isSelectableInput({ type: "tel" } as HTMLInputElement)).toBe(true);
            expect(isSelectableInput({ type: "password" } as HTMLInputElement)).toBe(true);
            expect(isSelectableInput({ type: "" } as HTMLInputElement)).toBe(true);
            expect(isSelectableInput({} as HTMLInputElement)).toBe(true);

            expect(isSelectableInput({ type: "email" } as HTMLInputElement)).toBe(false);
            expect(isSelectableInput({ type: "number" } as HTMLInputElement)).toBe(false);
            expect(isSelectableInput({ type: "date" } as HTMLInputElement)).toBe(false);
            expect(isSelectableInput({ type: "checkbox" } as HTMLInputElement)).toBe(false);
            expect(isSelectableInput({ type: "button" } as HTMLInputElement)).toBe(false);
        });

        it("isInputElement and isTextAreaElement support cross-realm tag checks", () => {
            const crossRealmInput = { tagName: "INPUT" };
            const crossRealmTextarea = { tagName: "TEXTAREA" };
            const otherElement = { tagName: "DIV" };

            expect(isInputElement(crossRealmInput)).toBe(true);
            expect(isInputElement(crossRealmTextarea)).toBe(false);
            expect(isInputElement(otherElement)).toBe(false);
            expect(isInputElement(null)).toBe(false);
            expect(isInputElement(undefined)).toBe(false);

            expect(isTextAreaElement(crossRealmTextarea)).toBe(true);
            expect(isTextAreaElement(crossRealmInput)).toBe(false);
            expect(isTextAreaElement(otherElement)).toBe(false);
        });

        it("cleans up caret measurement mirror in finally block for HTMLTextAreaElement", () => {
            let appendChildCalled = false;
            let removeChildCalled = false;
            let appendedChildNode: any = null;

            const originalCreateElement = (document as any).createElement;
            const originalBody = (document as any).body;

            const mockBody = {
                appendChild: (node: any) => {
                    appendChildCalled = true;
                    appendedChildNode = node;
                    node.parentNode = mockBody;
                },
                removeChild: (node: any) => {
                    removeChildCalled = true;
                    node.parentNode = null;
                }
            };
            (document as any).body = mockBody;

            const textarea = {
                tagName: "TEXTAREA",
                value: "hello world\nline 2",
                selectionEnd: 5,
                scrollTop: 0,
                scrollLeft: 0,
                getBoundingClientRect: () => ({ left: 10, top: 20, right: 200, bottom: 100 })
            };

            const coords = getActiveCaretCoordinates(textarea as unknown as Element);
            expect(appendChildCalled).toBe(true);
            expect(removeChildCalled).toBe(true);
            expect(coords).toBeDefined();

            (document as any).body = originalBody;
            (document as any).createElement = originalCreateElement;
        });

        it("calculates caret coordinates on <input type='number'> without throwing InvalidStateError", () => {
            const numberInput = new MockNonTextInputElement("number", "12345");
            expect(() => {
                const coords = getActiveCaretCoordinates(numberInput as unknown as Element);
                expect(coords).toBeDefined();
                expect(coords?.x).toBeGreaterThan(0);
                expect(coords?.y).toBe(230);
            }).not.toThrow();
        });

        it("calculates caret coordinates on <input type='email'> without throwing InvalidStateError", () => {
            const emailInput = new MockNonTextInputElement("email", "test@example.com");
            expect(() => {
                const coords = getActiveCaretCoordinates(emailInput as unknown as Element);
                expect(coords).toBeDefined();
                expect(coords?.x).toBeGreaterThan(0);
                expect(coords?.y).toBe(230);
            }).not.toThrow();
        });

        it("safely inserts text into <input type='number'> fallback without throwing DOMException", async () => {
            const numberInput = new MockNonTextInputElement("number", "");
            (document as any).activeElement = numberInput;

            const adapterForNumber = new BrowserEditorAdapter(hud, jisyoProvider, numberInput as unknown as Element);
            const mode = HiraganaMode.getInstance();
            adapterForNumber.setInputMode(mode);

            expect(() => {
                adapterForNumber.insertOrReplaceSelection("42");
            }).not.toThrow();

            expect(numberInput.value).toBe("42");
            expect(numberInput.events.length).toBeGreaterThan(0);
            expect(numberInput.events[0]?.type).toBe("input");
        });

        it("safely inserts text into <input type='email'> fallback without throwing DOMException", async () => {
            const emailInput = new MockNonTextInputElement("email", "");
            (document as any).activeElement = emailInput;

            const adapterForEmail = new BrowserEditorAdapter(hud, jisyoProvider, emailInput as unknown as Element);
            const mode = AsciiMode.getInstance();
            adapterForEmail.setInputMode(mode);

            expect(() => {
                adapterForEmail.insertOrReplaceSelection("user@domain.com");
            }).not.toThrow();

            expect(emailInput.value).toBe("user@domain.com");
            expect(emailInput.events.length).toBeGreaterThan(0);
            expect(emailInput.events[0]?.type).toBe("input");
        });

        it("safely deletes character from <input type='number'> without throwing InvalidStateError", async () => {
            const numberInput = new MockNonTextInputElement("number", "12345");
            (document as any).activeElement = numberInput;

            const adapterForNumber = new BrowserEditorAdapter(hud, jisyoProvider, numberInput as unknown as Element);

            const res1 = await adapterForNumber.deleteLeft();
            expect(res1).toBe(DeleteLeftResult.otherCharacterDeleted);
            expect(numberInput.value).toBe("1234");

            const res2 = await adapterForNumber.deleteLeft();
            expect(res2).toBe(DeleteLeftResult.otherCharacterDeleted);
            expect(numberInput.value).toBe("123");
        });

        it("safely deletes character from <input type='email'> without throwing InvalidStateError", async () => {
            const emailInput = new MockNonTextInputElement("email", "abc@xyz");
            (document as any).activeElement = emailInput;

            const adapterForEmail = new BrowserEditorAdapter(hud, jisyoProvider, emailInput as unknown as Element);

            await adapterForEmail.deleteLeft();
            expect(emailInput.value).toBe("abc@xy");
        });

        it("handles direct insertText on non-text input when execCommand fails", () => {
            const numberInput = new MockNonTextInputElement("number", "100");
            (document as any).activeElement = numberInput;

            const result = insertText("9");
            expect(result.success).toBe(true);
            expect(result.method).toBe("fallback-value-replace");
            expect(numberInput.value).toBe("1009");
        });
    });
});
