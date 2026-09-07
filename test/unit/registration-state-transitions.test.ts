import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SimpleMemoryJisyoProvider } from "../../src/core/skk/jisyo/SimpleMemoryJisyoProvider";
import { BrowserEditorAdapter } from "../../src/adapter/BrowserEditorAdapter";
import { RegistrationMode } from "../../src/core/skk/input-mode/henkan/RegistrationMode";
import { HiraganaMode } from "../../src/core/skk/input-mode/HiraganaMode";
import { KakuteiMode } from "../../src/core/skk/input-mode/henkan/KakuteiMode";
import { InlineHenkanMode } from "../../src/core/skk/input-mode/henkan/InlineHenkanMode";
import { MenuHenkanMode } from "../../src/core/skk/input-mode/henkan/MenuHenkanMode";
import { MidashigoMode } from "../../src/core/skk/input-mode/henkan/MidashigoMode";
import { Candidate } from "../../src/core/skk/jisyo/candidate";
import { FloatingHUD } from "../../src/hud/FloatingHUD";

// Mock DOM element for BrowserEditorAdapter tests
class MockInputElement {
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

    closest(_selector: string): any {
        return null;
    }

    getBoundingClientRect() {
        return { left: 100, top: 200, right: 300, bottom: 230, width: 200, height: 30 };
    }
}

describe("SKK Registration & State Transitions Specification (docs/specs/registration-state-transitions.md)", () => {
    let jisyoProvider: SimpleMemoryJisyoProvider;
    let mockElement: MockInputElement;
    let hud: FloatingHUD;
    let adapter: BrowserEditorAdapter;
    let originalDocument: any;
    let originalWindow: any;

    beforeEach(() => {
        originalDocument = (globalThis as any).document;
        originalWindow = (globalThis as any).window;

        mockElement = new MockInputElement();

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
            execCommand: () => false,
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
                fontFamily: "monospace"
            })
        };

        jisyoProvider = new SimpleMemoryJisyoProvider();
        hud = new FloatingHUD();
        adapter = new BrowserEditorAdapter(hud, jisyoProvider, mockElement as unknown as Element);
        mockElement.focus();
    });

    afterEach(() => {
        (globalThis as any).document = originalDocument;
        (globalThis as any).window = originalWindow;
    });

    // -------------------------------------------------------------------------
    // 2. 送りあり見出し語の生成規則 (SPEC-OKURI-01)
    // -------------------------------------------------------------------------
    describe("2. 送りあり見出し語の生成規則 (SPEC-OKURI-01)", () => {
        it("TC-OKURI-01: okuri-ari conversion with input 'USi' (う*し) displays prompt header '[う*し] ' without 's'", async () => {
            // SPEC-OKURI-01 requirement:
            // Input 'USi' -> Stem 'う', okuri alphabet 's', okurigana 'し' -> UI prompt header must be '[う*し] '
            // Must NOT contain okuri alphabet 's' (e.g. '[うs*し] ' is a bug).

            // 1. Direct RegistrationMode instance check
            const regModeDirect = new RegistrationMode("うs", "し", adapter);
            expect(regModeDirect.getPromptHeader()).toBe("[う*し] ");
            expect(regModeDirect.getPromptHeader()).not.toContain("s");

            // 2. Full typing workflow: HiraganaMode -> Shift+U, Shift+S, i -> unregistered -> enters RegistrationMode
            const hiraganaMode = HiraganaMode.getInstance();
            adapter.setInputMode(hiraganaMode);

            await hiraganaMode.upperAlphabetInput("U");
            await hiraganaMode.upperAlphabetInput("S");
            await hiraganaMode.lowerAlphabetInput("i");

            expect(adapter.getCurrentInputMode()).toBeInstanceOf(RegistrationMode);
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;
            expect(regMode.getPromptHeader()).toBe("[う*し] ");
            expect(regMode.getPromptHeader()).not.toContain("s");
            expect(hud.getState()?.preedit).toMatch(/^\[う\*し\]\s*/);
        });

        it("TC-OKURI-02: okuri-ari conversion with input 'Kat' (か*つ) displays prompt header '[か*つ] ' without 't'", async () => {
            // SPEC-OKURI-01 requirement:
            // Input 'Kat' -> Stem 'か', okuri alphabet 't', okurigana 'つ' -> UI prompt header must be '[か*つ] '
            // Must NOT contain okuri alphabet 't' (e.g. '[かt*つ] ' is a bug).

            // 1. Direct RegistrationMode instance check
            const regModeDirect = new RegistrationMode("かt", "つ", adapter);
            expect(regModeDirect.getPromptHeader()).toBe("[か*つ] ");
            expect(regModeDirect.getPromptHeader()).not.toContain("t");

            // 2. Full typing workflow: 'K', 'a' -> 'か', Shift+T, 'u' -> okuri 'つ' -> lookup 'かt'
            const hiraganaMode = HiraganaMode.getInstance();
            adapter.setInputMode(hiraganaMode);

            await hiraganaMode.upperAlphabetInput("K");
            await hiraganaMode.lowerAlphabetInput("a");
            await hiraganaMode.upperAlphabetInput("T");
            await hiraganaMode.lowerAlphabetInput("u");

            expect(adapter.getCurrentInputMode()).toBeInstanceOf(RegistrationMode);
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;
            expect(regMode.getPromptHeader()).toBe("[か*つ] ");
            expect(regMode.getPromptHeader()).not.toContain("t");
            expect(hud.getState()?.preedit).toMatch(/^\[か\*つ\]\s*/);
        });
    });

    // -------------------------------------------------------------------------
    // 3.1. Enter による確定と中断復帰 (SPEC-KEY-ENTER)
    // -------------------------------------------------------------------------
    describe("3.1. Enter (RET) による確定と中断復帰 (SPEC-KEY-ENTER)", () => {
        it("TC-ENTER-01: typing a word in RegistrationMode and pressing Enter registers to JisyoProvider and commits to editor", async () => {
            // SPEC-KEY-ENTER.1 requirement:
            // Non-empty committed text confirmed on Enter registers candidate and commits to editor.
            await adapter.openRegistrationEditor("とうろく", "");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;
            expect(regMode).toBeInstanceOf(RegistrationMode);

            // Type "しんき"
            await regMode.lowerAlphabetInput("s");
            await regMode.lowerAlphabetInput("i");
            await regMode.lowerAlphabetInput("n");
            await regMode.lowerAlphabetInput("k");
            await regMode.lowerAlphabetInput("i");
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("しんき");

            // Press Enter to confirm registration
            await regMode.enterInput();

            // Registered in JisyoProvider
            const entry = await jisyoProvider.lookupCandidates("とうろく");
            expect(entry).toBeDefined();
            expect(entry?.getCandidateList().some((c) => c.word === "しんき")).toBe(true);

            // Committed into editor DOM element
            expect(mockElement.value).toBe("しんき");

            // Restored to KakuteiMode
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
            const hMode = adapter.getCurrentInputMode() as HiraganaMode;
            expect(hMode.getHenkanMode()).toBeInstanceOf(KakuteiMode);
            expect(adapter.getModeBadgeText()).toBe("かな");
        });

        it("TC-ENTER-02: empty Enter in RegistrationMode aborts registration and restores InlineHenkanMode displaying last candidate", async () => {
            // SPEC-KEY-ENTER.2 requirement:
            // When entered from InlineHenkanMode (candidate selection ran out past last candidate),
            // pressing Enter with an empty mini-buffer MUST abort registration and restore
            // InlineHenkanMode displaying the last candidate!
            (jisyoProvider as any).dictionary.delete("てすと");
            await jisyoProvider.registerCandidate("てすと", new Candidate("候補1"));
            await jisyoProvider.registerCandidate("てすと", new Candidate("候補2"));

            const hiraganaMode = HiraganaMode.getInstance();
            adapter.setInputMode(hiraganaMode);

            // Midashigo "てすと"
            await hiraganaMode.upperAlphabetInput("T");
            await hiraganaMode.lowerAlphabetInput("e");
            await hiraganaMode.lowerAlphabetInput("s");
            await hiraganaMode.lowerAlphabetInput("u");
            await hiraganaMode.lowerAlphabetInput("t");
            await hiraganaMode.lowerAlphabetInput("o");

            // 1st Space -> candidate 1
            await hiraganaMode.spaceInput();
            expect(hiraganaMode.getHenkanMode()).toBeInstanceOf(InlineHenkanMode);
            const cand1 = adapter.getCurrentCandidate()?.word;

            // 2nd Space -> candidate 2 (last candidate)
            await hiraganaMode.spaceInput();
            expect(hiraganaMode.getHenkanMode()).toBeInstanceOf(InlineHenkanMode);
            const lastCand = adapter.getCurrentCandidate()?.word;
            expect(lastCand).toBeDefined();
            expect(lastCand).not.toBe(cand1);

            // 3rd Space -> candidate list exhausted -> opens RegistrationMode
            await hiraganaMode.spaceInput();
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(RegistrationMode);
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("");

            // Press Enter with empty mini-buffer
            await regMode.enterInput();

            // Specification: Aborts registration and restores InlineHenkanMode with the last candidate displayed!
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
            const restoredHMode = adapter.getCurrentInputMode() as HiraganaMode;
            expect(restoredHMode.getHenkanMode()).toBeInstanceOf(InlineHenkanMode);
            expect(adapter.getCurrentCandidate()?.word).toBe(lastCand);
            expect(mockElement.value).toBe("");
        });

        it("TC-ENTER-03: empty Enter in RegistrationMode aborts registration and restores MenuHenkanMode displaying last candidate page", async () => {
            // SPEC-KEY-ENTER.2 requirement:
            // When entered from MenuHenkanMode (advancing past last candidate page),
            // pressing Enter with an empty mini-buffer MUST abort registration and restore
            // MenuHenkanMode displaying the last candidate list page!

            // Register 5 candidates (1..3 inline, 4..5 in menu)
            for (let i = 1; i <= 5; i++) {
                await jisyoProvider.registerCandidate("てすと", new Candidate(`候補${i}`));
            }

            const hiraganaMode = HiraganaMode.getInstance();
            adapter.setInputMode(hiraganaMode);

            await hiraganaMode.upperAlphabetInput("T");
            await hiraganaMode.lowerAlphabetInput("e");
            await hiraganaMode.lowerAlphabetInput("s");
            await hiraganaMode.lowerAlphabetInput("u");
            await hiraganaMode.lowerAlphabetInput("t");
            await hiraganaMode.lowerAlphabetInput("o");

            // 1st, 2nd, 3rd Space (InlineHenkanMode)
            await hiraganaMode.spaceInput();
            await hiraganaMode.spaceInput();
            await hiraganaMode.spaceInput();

            // 4th Space enters MenuHenkanMode (displaying candidates 4 and 5)
            await hiraganaMode.spaceInput();
            expect(hiraganaMode.getHenkanMode()).toBeInstanceOf(MenuHenkanMode);
            expect(adapter.getCandidateList().candidates.length).toBeGreaterThan(0);

            // 5th Space advances past last page into RegistrationMode
            await hiraganaMode.spaceInput();
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(RegistrationMode);
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("");

            // Press Enter with empty mini-buffer
            await regMode.enterInput();

            // Specification: Aborts registration and restores MenuHenkanMode displaying the last page!
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
            const restoredHMode = adapter.getCurrentInputMode() as HiraganaMode;
            expect(restoredHMode.getHenkanMode()).toBeInstanceOf(MenuHenkanMode);
            expect(adapter.getCandidateList().candidates.length).toBeGreaterThan(0);
            expect(mockElement.value).toBe("");
        });

        it("TC-ENTER-04: empty Enter in RegistrationMode aborts registration and restores MidashigoMode (▽) when entered with 0 candidates", async () => {
            // SPEC-KEY-ENTER.2 (復帰先 C) requirement:
            // When entered from MidashigoMode directly because 0 candidates were found,
            // pressing Enter with an empty mini-buffer MUST abort registration and restore
            // the previous MidashigoMode (▽) with midashigo text preserved!
            const hiraganaMode = HiraganaMode.getInstance();
            adapter.setInputMode(hiraganaMode);

            // Midashigo "みだし" (0 candidates in SimpleMemoryJisyoProvider)
            await hiraganaMode.upperAlphabetInput("M");
            await hiraganaMode.lowerAlphabetInput("i");
            await hiraganaMode.lowerAlphabetInput("d");
            await hiraganaMode.lowerAlphabetInput("a");
            await hiraganaMode.lowerAlphabetInput("s");
            await hiraganaMode.lowerAlphabetInput("h");
            await hiraganaMode.lowerAlphabetInput("i");
            expect(adapter.isInMidashigo()).toBe(true);
            expect(adapter.extractMidashigo()).toBe("みだし");

            // Space triggers search -> 0 candidates -> opens RegistrationMode
            await hiraganaMode.spaceInput();
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(RegistrationMode);
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;
            expect(regMode.getYomi()).toBe("みだし");
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("");

            // Press Enter with empty mini-buffer
            await regMode.enterInput();

            // Specification: Aborts registration and restores MidashigoMode with midashigo text preserved!
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
            const restoredHMode = adapter.getCurrentInputMode() as HiraganaMode;
            expect(restoredHMode.getHenkanMode()).toBeInstanceOf(MidashigoMode);
            expect(adapter.isInMidashigo()).toBe(true);
            expect(adapter.extractMidashigo()).toBe("みだし");
            expect(mockElement.value).toBe("");
        });
    });

    // -------------------------------------------------------------------------
    // 3.2. Ctrl+j によるバッファ内確定 (SPEC-KEY-CTRLJ)
    // -------------------------------------------------------------------------
    describe("3.2. Ctrl+j (skk-kakutei) によるバッファ内確定 (SPEC-KEY-CTRLJ)", () => {
        it("TC-CTRLJ-01: pressing Ctrl+j inside mini-buffer in midashigo (▽) or candidate (▼) fixes composition into committed text", async () => {
            // SPEC-KEY-CTRLJ.1 requirement:
            // Inside RegistrationMode mini-buffer:
            // - When in candidate (▼): fixates candidate into mini-buffer committed text.
            // - When in midashigo (▽): fixates midashigo into mini-buffer committed text.
            // - When trailing romaji exists: flushes romaji into kana.
            // MUST remain in RegistrationMode!
            await adapter.openRegistrationEditor("とうろく", "");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;

            // 1. Midashigo (▽)
            await regMode.upperAlphabetInput("T");
            await regMode.lowerAlphabetInput("o");
            await regMode.lowerAlphabetInput("u");
            expect(regMode.getMiniBufferEditor().isInMidashigo()).toBe(true);
            expect(regMode.getMiniBufferEditor().getMidashigoText()).toBe("とう");

            // Press Ctrl+j
            await regMode.ctrlJInput();

            // Midashigo is committed into miniBufferEditor committed text
            expect(regMode.getMiniBufferEditor().isInMidashigo()).toBe(false);
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("とう");
            expect(adapter.getCurrentInputMode()).toBe(regMode);
            expect(mockElement.value).toBe("");

            // Clear buffer for next case
            await regMode.getMiniBufferEditor().deleteLeft();
            await regMode.getMiniBufferEditor().deleteLeft();
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("");

            // 2. Candidate (▼)
            await jisyoProvider.registerCandidate("とうきょう", new Candidate("東京"));

            await regMode.upperAlphabetInput("T");
            await regMode.lowerAlphabetInput("o");
            await regMode.lowerAlphabetInput("u");
            await regMode.lowerAlphabetInput("k");
            await regMode.lowerAlphabetInput("y");
            await regMode.lowerAlphabetInput("o");
            await regMode.lowerAlphabetInput("u");
            await regMode.spaceInput(); // converts to "東京"
            expect(regMode.getMiniBufferEditor().getCurrentCandidate()?.word).toBe("東京");

            // Press Ctrl+j
            await regMode.ctrlJInput();

            // Candidate "東京" is fixed into miniBuffer committed text
            expect(regMode.getMiniBufferEditor().getCurrentCandidate()).toBeUndefined();
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("東京");
            expect(adapter.getCurrentInputMode()).toBe(regMode);
            expect(mockElement.value).toBe("");

            // 3. Trailing romaji (e.g. 'n' -> 'ん')
            await regMode.lowerAlphabetInput("n");
            expect(regMode.getMiniBufferEditor().getRemainingRomaji()).toBe("n");
            await regMode.ctrlJInput();
            expect(regMode.getMiniBufferEditor().getRemainingRomaji()).toBe("");
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("東京ん");
            expect(adapter.getCurrentInputMode()).toBe(regMode);
        });

        it("TC-CTRLJ-02: pressing Ctrl+j when mini-buffer is empty or contains committed text is a no-op and does not exit RegistrationMode", async () => {
            // SPEC-KEY-CTRLJ.2 requirement:
            // When there is no unconfirmed composition (mini-buffer is empty or already committed),
            // Ctrl+j MUST BE A NO-OP!
            // It must NOT exit RegistrationMode and must NOT confirm registration!
            await adapter.openRegistrationEditor("とうろく", "");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;

            // Case A: Empty mini-buffer
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("");
            await regMode.ctrlJInput();

            // Must stay in RegistrationMode
            expect(adapter.getCurrentInputMode()).toBe(regMode);
            expect(mockElement.value).toBe("");
            const entry1 = await jisyoProvider.lookupCandidates("とうろく");
            expect(entry1).toBeUndefined();

            // Case B: Mini-buffer contains committed text
            await regMode.lowerAlphabetInput("a");
            await regMode.lowerAlphabetInput("i");
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("あい");
            expect(regMode.getMiniBufferEditor().isInMidashigo()).toBe(false);
            expect(regMode.getMiniBufferEditor().getCurrentCandidate()).toBeUndefined();

            // Press Ctrl+j on committed text
            await regMode.ctrlJInput();

            // Must be a NO-OP: MUST NOT confirm or exit RegistrationMode!
            expect(adapter.getCurrentInputMode()).toBe(regMode);
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("あい");
            expect(mockElement.value).toBe("");
            const entry2 = await jisyoProvider.lookupCandidates("とうろく");
            expect(entry2).toBeUndefined();
        });
    });

    // -------------------------------------------------------------------------
    // 3.3. Backspace によるバッファ内文字削除 (SPEC-KEY-BS)
    // -------------------------------------------------------------------------
    describe("3.3. Backspace (DEL) によるバッファ内文字削除 (SPEC-KEY-BS)", () => {
        it("TC-BS-01: Backspace in RegistrationMode deletes 1 character from mini-buffer text", async () => {
            // SPEC-KEY-BS.1 requirement:
            // When characters exist in mini-buffer, Backspace deletes the last character.
            await adapter.openRegistrationEditor("たんご", "");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;

            await regMode.lowerAlphabetInput("a");
            await regMode.lowerAlphabetInput("k");
            await regMode.lowerAlphabetInput("a"); // "あか"
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("あか");

            await regMode.backspaceInput();
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("あ");
            expect(adapter.getCurrentInputMode()).toBe(regMode);

            await regMode.backspaceInput();
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("");
            expect(adapter.getCurrentInputMode()).toBe(regMode);
        });

        it("TC-BS-02: Backspace on empty mini-buffer is a no-op and does not pop recursive registration stack or exit", async () => {
            // SPEC-KEY-BS.2 requirement:
            // When mini-buffer is empty, Backspace MUST BE A NO-OP!
            // It must NOT pop the recursive registration stack and must NOT exit registration mode!

            // 1. Root registration (depth 1) with empty mini-buffer
            await adapter.openRegistrationEditor("おや", "");
            const rootReg = adapter.getCurrentInputMode() as RegistrationMode;
            expect(rootReg.getMiniBufferEditor().getCommittedText()).toBe("");

            // Backspace on empty buffer
            await rootReg.backspaceInput();
            // MUST NOT exit registration!
            expect(adapter.getCurrentInputMode()).toBe(rootReg);
            expect(mockElement.value).toBe("");

            // 2. Recursive registration (depth 2) with empty mini-buffer
            await rootReg.getMiniBufferEditor().openRegistrationEditor("こ", "");
            const nestedReg = adapter.getCurrentInputMode() as RegistrationMode;
            expect(nestedReg.isNested()).toBe(true);
            expect(nestedReg.getMiniBufferEditor().getCommittedText()).toBe("");

            // Backspace on empty buffer in depth 2
            await nestedReg.backspaceInput();
            // MUST NOT pop stack to parent! Must remain in nested RegistrationMode!
            expect(adapter.getCurrentInputMode()).toBe(nestedReg);
            expect(nestedReg.isNested()).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // 3.4. Ctrl+g による段階的キャンセルと 1 段脱出 (SPEC-KEY-CTRLG)
    // -------------------------------------------------------------------------
    describe("3.4. Ctrl+g (keyboard-quit) による段階的キャンセルと 1 段脱出 (SPEC-KEY-CTRLG)", () => {
        it("TC-CTRLG-01: inside RegistrationMode, Ctrl+g cancels ▼ to ▽, and second Ctrl+g deletes ▽", async () => {
            // SPEC-KEY-CTRLG.1 requirement:
            // Inside RegistrationMode:
            // - First Ctrl+g when candidate (▼) is active: reverts to midashigo (▽).
            // - Second Ctrl+g when midashigo (▽) is active: clears midashigo.
            // Mode remains in RegistrationMode!
            await jisyoProvider.registerCandidate("とうきょう", new Candidate("東京"));

            await adapter.openRegistrationEditor("てすと", "");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;

            // Start midashigo and convert to candidate
            await regMode.upperAlphabetInput("T");
            await regMode.lowerAlphabetInput("o");
            await regMode.lowerAlphabetInput("u");
            await regMode.lowerAlphabetInput("k");
            await regMode.lowerAlphabetInput("y");
            await regMode.lowerAlphabetInput("o");
            await regMode.lowerAlphabetInput("u");
            await regMode.spaceInput();

            expect(regMode.getMiniBufferEditor().getCurrentCandidate()?.word).toBe("東京");

            // 1st Ctrl+g: cancels ▼ to ▽
            await regMode.ctrlGInput();
            expect(regMode.getMiniBufferEditor().getCurrentCandidate()).toBeUndefined();
            expect(regMode.getMiniBufferEditor().isInMidashigo()).toBe(true);
            expect(regMode.getMiniBufferEditor().getMidashigoText()).toBe("とうきょう");
            expect(adapter.getCurrentInputMode()).toBe(regMode);

            // 2nd Ctrl+g: deletes ▽ (clears midashigo)
            await regMode.ctrlGInput();
            expect(regMode.getMiniBufferEditor().isInMidashigo()).toBe(false);
            expect(regMode.getMiniBufferEditor().getMidashigoText()).toBe("");
            expect(adapter.getCurrentInputMode()).toBe(regMode);
        });

        it("TC-CTRLG-02: Ctrl+g in recursive registration (depth 2) with no unconfirmed composition pops 1 level to parent RegistrationMode", async () => {
            // SPEC-KEY-CTRLG.2 requirement:
            // In recursive registration (depth 2), when there is NO unconfirmed composition
            // (empty buffer or plain committed text):
            // Ctrl+g pops ONE level to parent RegistrationMode (depth 1), NOT resetting everything to KakuteiMode!

            // Root registration (depth 1)
            await adapter.openRegistrationEditor("おや", "");
            const rootReg = adapter.getCurrentInputMode() as RegistrationMode;
            await rootReg.getMiniBufferEditor().insertOrReplaceSelection("親");

            // Recursive registration (depth 2)
            await rootReg.getMiniBufferEditor().openRegistrationEditor("こ", "");
            const nestedReg = adapter.getCurrentInputMode() as RegistrationMode;
            expect(nestedReg.isNested()).toBe(true);
            expect(adapter.getCurrentInputMode()).toBe(nestedReg);

            // Case 1: Empty mini-buffer in depth 2 -> Ctrl+g pops to depth 1
            await nestedReg.ctrlGInput();
            expect(adapter.getCurrentInputMode()).toBe(rootReg);
            expect(rootReg.getMiniBufferEditor().getCommittedText()).toBe("親");
            expect(mockElement.value).toBe("");

            // Case 2: Plain committed text in depth 2 -> Ctrl+g pops to depth 1 without committing child word
            await rootReg.getMiniBufferEditor().openRegistrationEditor("こ2", "");
            const nestedReg2 = adapter.getCurrentInputMode() as RegistrationMode;
            await nestedReg2.lowerAlphabetInput("k");
            await nestedReg2.lowerAlphabetInput("o");
            expect(nestedReg2.getMiniBufferEditor().getCommittedText()).toBe("こ");
            expect(nestedReg2.getMiniBufferEditor().isInMidashigo()).toBe(false);
            expect(nestedReg2.getMiniBufferEditor().getCurrentCandidate()).toBeUndefined();

            // Ctrl+g pops to parent
            await nestedReg2.ctrlGInput();
            expect(adapter.getCurrentInputMode()).toBe(rootReg);
            expect(rootReg.getMiniBufferEditor().getCommittedText()).toBe("親");
            const entry = await jisyoProvider.lookupCandidates("こ2");
            expect(entry).toBeUndefined();

            // Root registration (depth 1) Ctrl+g cancels and restores normal input mode
            await rootReg.ctrlGInput();
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
            expect(mockElement.value).toBe("");
        });
    });

    // -------------------------------------------------------------------------
    // TC-RECURSIVE-01: 全体再帰辞書登録フロー
    // -------------------------------------------------------------------------
    describe("再帰辞書登録 End-to-End フロー", () => {
        it("TC-RECURSIVE-01: full recursive registration flow from parent to nested and back to editor insertion", async () => {
            // Full recursive registration flow:
            // 1. Parent registration (depth 1) for "ふくごうご"
            // 2. Midashigo conversion inside parent mini-buffer for unregistered word "たんご"
            // 3. Nested registration (depth 2) opens
            // 4. Confirm nested word "単語" -> registered in dictionary, inserted into parent mini-buffer
            // 5. Confirm parent registration "複合単語" -> registered in dictionary, inserted into outer editor

            // 1. Trigger parent registration for "ふくごうご"
            await adapter.openRegistrationEditor("ふくごうご", "");
            const parentReg = adapter.getCurrentInputMode() as RegistrationMode;
            expect(parentReg.isNested()).toBe(false);
            expect(parentReg.getYomi()).toBe("ふくごうご");
            expect(adapter.getModeBadgeText()).toBe("辞書登録");

            // Parent enters first part "複合"
            await parentReg.getMiniBufferEditor().insertOrReplaceSelection("複合");
            expect(parentReg.getMiniBufferEditor().getCommittedText()).toBe("複合");

            // 2. User types unregistered word "たんご" via midashigo inside parent mini-buffer
            await parentReg.upperAlphabetInput("T");
            await parentReg.lowerAlphabetInput("a");
            await parentReg.lowerAlphabetInput("n");
            await parentReg.lowerAlphabetInput("g");
            await parentReg.lowerAlphabetInput("o");
            expect(parentReg.getMiniBufferEditor().isInMidashigo()).toBe(true);

            // Space to convert -> "たんご" is not in jisyo -> opens nested registration (depth 2)
            await parentReg.spaceInput();
            expect(adapter.getCurrentInputMode()).not.toBe(parentReg);
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(RegistrationMode);
            const nestedReg = adapter.getCurrentInputMode() as RegistrationMode;
            expect(nestedReg.isNested()).toBe(true);
            expect(nestedReg.getParentRegistration()).toBe(parentReg);
            expect(nestedReg.getYomi()).toBe("たんご");
            expect(adapter.getModeBadgeText()).toBe("再帰登録");

            // 3. User registers "単語" in nested registration
            await nestedReg.getMiniBufferEditor().insertOrReplaceSelection("単語");
            expect(nestedReg.getMiniBufferEditor().getCommittedText()).toBe("単語");

            // Confirm nested registration with Enter
            await nestedReg.enterInput();

            // Nested word registered in JisyoProvider
            const nestedEntry = await jisyoProvider.lookupCandidates("たんご");
            expect(nestedEntry).toBeDefined();
            expect(nestedEntry?.getCandidateList().some((c) => c.word === "単語")).toBe(true);

            // 4. Popped back to parent registration
            expect(adapter.getCurrentInputMode()).toBe(parentReg);
            expect(parentReg.isNested()).toBe(false);
            expect(adapter.getModeBadgeText()).toBe("辞書登録");

            // Nested word "単語" inserted into parent mini-buffer ("複合" + "単語" = "複合単語")
            expect(parentReg.getMiniBufferEditor().getCommittedText()).toBe("複合単語");
            // Outer editor is still untouched
            expect(mockElement.value).toBe("");

            // 5. Confirm parent registration with Enter
            await parentReg.enterInput();

            // Parent word registered in JisyoProvider
            const parentEntry = await jisyoProvider.lookupCandidates("ふくごうご");
            expect(parentEntry).toBeDefined();
            expect(parentEntry?.getCandidateList().some((c) => c.word === "複合単語")).toBe(true);

            // Parent word committed to outer DOM editor
            expect(mockElement.value).toBe("複合単語");

            // Restored to normal input mode in KakuteiMode
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
            const restoredHMode = adapter.getCurrentInputMode() as HiraganaMode;
            expect(restoredHMode.getHenkanMode()).toBeInstanceOf(KakuteiMode);
            expect(adapter.getModeBadgeText()).toBe("かな");
        });
    });
});
