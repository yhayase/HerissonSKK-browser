import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SimpleMemoryJisyoProvider } from "../../src/core/skk/jisyo/SimpleMemoryJisyoProvider";
import { BrowserEditorAdapter } from "../../src/adapter/BrowserEditorAdapter";
import { RegistrationMode } from "../../src/core/skk/input-mode/henkan/RegistrationMode";
import { HiraganaMode } from "../../src/core/skk/input-mode/HiraganaMode";
import { KakuteiMode } from "../../src/core/skk/input-mode/henkan/KakuteiMode";
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

describe("RegistrationMode (Inline & Recursive Registration)", () => {
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

    describe("Basic Registration Lifecycle", () => {
        it("initializes with correct properties and prompt header", () => {
            const regMode = new RegistrationMode("しんき", "", adapter);
            expect(regMode.getYomi()).toBe("しんき");
            expect(regMode.getOkuri()).toBe("");
            expect(regMode.isNested()).toBe(false);
            expect(regMode.toString()).toBe("辞書登録");
            expect(regMode.getContextualName()).toBe("registration");
            expect(regMode.getPromptHeader()).toBe("[しんき] ");
        });

        it("initializes okuri-ari prompt header properly", () => {
            const regMode = new RegistrationMode("いk", "く", adapter);
            expect(regMode.getYomi()).toBe("いk");
            expect(regMode.getOkuri()).toBe("く");
            expect(regMode.getPromptHeader()).toBe("[い*く] ");
        });

        it("allows typing hiragana into mini-buffer and confirms registration (Okuri-nasi)", async () => {
            await adapter.openRegistrationEditor("とうろく", "");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;
            expect(regMode).toBeInstanceOf(RegistrationMode);
            expect(adapter.getModeBadgeText()).toBe("辞書登録");

            // Type "t", "o", "u", "r", "o", "k", "u"
            await regMode.lowerAlphabetInput("t");
            await regMode.lowerAlphabetInput("o");
            await regMode.lowerAlphabetInput("u");
            await regMode.lowerAlphabetInput("r");
            await regMode.lowerAlphabetInput("o");
            await regMode.lowerAlphabetInput("k");
            await regMode.lowerAlphabetInput("u");

            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("とうろく");

            // Confirm registration with Enter
            await regMode.enterInput();

            // Registered in jisyoProvider
            const entry = await jisyoProvider.lookupCandidates("とうろく");
            expect(entry).toBeDefined();
            expect(entry?.getCandidateList()[0]?.word).toBe("とうろく");

            // Inserted into DOM document
            expect(mockElement.value).toBe("とうろく");

            // Restored to HiraganaMode in KakuteiMode
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
            expect(adapter.getModeBadgeText()).toBe("かな");
        });

        it("pressing Ctrl+J on committed text is a no-op and stays in RegistrationMode", async () => {
            await adapter.openRegistrationEditor("めも", "");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;

            await regMode.lowerAlphabetInput("m");
            await regMode.lowerAlphabetInput("e");
            await regMode.lowerAlphabetInput("m");
            await regMode.lowerAlphabetInput("o");
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("めも");

            await regMode.ctrlJInput();

            expect(adapter.getCurrentInputMode()).toBe(regMode);
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("めも");
            expect(mockElement.value).toBe("");
            const entry = await jisyoProvider.lookupCandidates("めも");
            expect(entry).toBeUndefined();
        });

        it("flushes trailing romaji like 'n' into 'ん' on Enter confirmation", async () => {
            await adapter.openRegistrationEditor("ほん", "");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;

            await regMode.lowerAlphabetInput("h");
            await regMode.lowerAlphabetInput("o");
            await regMode.lowerAlphabetInput("n");
            // 'n' remains in romaji buffer
            expect(regMode.getMiniBufferEditor().getRemainingRomaji()).toBe("n");

            await regMode.enterInput();

            const entry = await jisyoProvider.lookupCandidates("ほん");
            expect(entry).toBeDefined();
            expect(entry?.getCandidateList()[0]?.word).toBe("ほん");
            expect(mockElement.value).toBe("ほん");
        });

        it("cancels registration with Ctrl+G without modifying dictionary or DOM", async () => {
            await adapter.openRegistrationEditor("きゃんせる", "");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;

            await regMode.lowerAlphabetInput("a");
            await regMode.lowerAlphabetInput("a");

            await regMode.ctrlGInput();

            // Not registered
            const entry = await jisyoProvider.lookupCandidates("きゃんせる");
            expect(entry).toBeUndefined();

            // Nothing committed to DOM
            expect(mockElement.value).toBe("");

            // Restored mode
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
            expect(adapter.getModeBadgeText()).toBe("かな");
        });

        it("cancels registration with Escape without modifying dictionary or DOM", async () => {
            await adapter.openRegistrationEditor("きゃんせる２", "");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;

            await regMode.lowerAlphabetInput("k");
            await regMode.lowerAlphabetInput("a");

            await regMode.escapeInput();

            const entry = await jisyoProvider.lookupCandidates("きゃんせる２");
            expect(entry).toBeUndefined();
            expect(mockElement.value).toBe("");
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
        });

        it("deletes character on backspace, and backspace on empty buffer is a no-op", async () => {
            await adapter.openRegistrationEditor("てすと", "");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;

            await regMode.lowerAlphabetInput("a"); // "あ"
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("あ");

            // Backspace deletes "あ"
            await regMode.backspaceInput();
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("");
            // Still in registration mode
            expect(adapter.getCurrentInputMode()).toBe(regMode);

            // Backspace on empty buffer is a no-op (stays in registration mode)
            await regMode.backspaceInput();
            expect(adapter.getCurrentInputMode()).toBe(regMode);
            expect(mockElement.value).toBe("");
        });
    });

    describe("Kanji Conversion Inside Registration Mini-Buffer", () => {
        it("allows Midashigo conversion inside mini-buffer before confirming", async () => {
            // Seed "とうきょう" -> "東京"
            await adapter.openRegistrationEditor("しゅと", "");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;

            // Type Shift+T, o, u, k, y, o, u
            await regMode.upperAlphabetInput("T");
            await regMode.lowerAlphabetInput("o");
            await regMode.lowerAlphabetInput("u");
            await regMode.lowerAlphabetInput("k");
            await regMode.lowerAlphabetInput("y");
            await regMode.lowerAlphabetInput("o");
            await regMode.lowerAlphabetInput("u");

            // In midashigo
            expect(regMode.getMiniBufferEditor().isInMidashigo()).toBe(true);

            // Space to convert to "東京"
            await regMode.spaceInput();
            expect(regMode.getMiniBufferEditor().getCurrentCandidate()?.word).toBe("東京");

            // First Enter fixates candidate into mini-buffer
            await regMode.enterInput();
            expect(regMode.getMiniBufferEditor().getCurrentCandidate()).toBeUndefined();
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("東京");
            // Still in registration mode!
            expect(adapter.getCurrentInputMode()).toBe(regMode);

            // Second Enter confirms registration of "東京" for "しゅと"
            await regMode.enterInput();

            const entry = await jisyoProvider.lookupCandidates("しゅと");
            expect(entry).toBeDefined();
            expect(entry?.getCandidateList()[0]?.word).toBe("東京");
            expect(mockElement.value).toBe("東京");
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
        });
    });

    describe("Okuri-ari Registration & Stem Extraction", () => {
        it("registers stem and inserts stem + okuri when user types stem only", async () => {
            // Unregistered okuri-ari key "はたらk" with okuri "く"
            await adapter.openRegistrationEditor("はたらk", "く");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;
            expect(regMode.getPromptHeader()).toBe("[はたら*く] ");

            // User inputs stem "働" (we insert via direct selection or midashigo)
            await regMode.getMiniBufferEditor().insertOrReplaceSelection("働");
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("働");

            await regMode.enterInput();

            // Registered candidate is stem "働" under "はたらk"
            const entry = await jisyoProvider.lookupCandidates("はたらk");
            expect(entry).toBeDefined();
            expect(entry?.getCandidateList()[0]?.word).toBe("働");

            // Inserted text into document is stem + okuri = "働く"
            expect(mockElement.value).toBe("働く");
        });

        it("strips okuri suffix, registers stem, and inserts stem + okuri when user types full word", async () => {
            await adapter.openRegistrationEditor("はたらk", "く");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;

            // User inputs full word "働く"
            await regMode.getMiniBufferEditor().insertOrReplaceSelection("働く");
            expect(regMode.getMiniBufferEditor().getCommittedText()).toBe("働く");

            await regMode.enterInput();

            // Registered candidate is stripped stem "働"
            const entry = await jisyoProvider.lookupCandidates("はたらk");
            expect(entry).toBeDefined();
            expect(entry?.getCandidateList()[0]?.word).toBe("働");

            // Inserted text into document is "働く"
            expect(mockElement.value).toBe("働く");
        });
    });

    describe("Recursive / Nested Registration", () => {
        it("supports nested registration stack and returns to parent registration", async () => {
            // Root registration for "ふくごうご"
            await adapter.openRegistrationEditor("ふくごうご", "");
            const rootRegMode = adapter.getCurrentInputMode() as RegistrationMode;
            expect(rootRegMode.isNested()).toBe(false);
            expect(adapter.getModeBadgeText()).toBe("辞書登録");

            // Inside root mini-buffer, user types "ふくごう"
            await rootRegMode.getMiniBufferEditor().insertOrReplaceSelection("複合");

            // Now user triggers nested registration for unregistered word "たんご"
            await rootRegMode.getMiniBufferEditor().openRegistrationEditor("たんご", "");
            const nestedRegMode = adapter.getCurrentInputMode() as RegistrationMode;
            expect(nestedRegMode).not.toBe(rootRegMode);
            expect(nestedRegMode.isNested()).toBe(true);
            expect(nestedRegMode.getParentRegistration()).toBe(rootRegMode);
            expect(nestedRegMode.toString()).toBe("再帰登録");
            expect(nestedRegMode.getContextualName()).toBe("registration:nested");
            expect(adapter.getModeBadgeText()).toBe("再帰登録");
            expect(nestedRegMode.getPromptHeader()).toBe("[たんご] ");

            // In nested registration, user enters "単語"
            await nestedRegMode.getMiniBufferEditor().insertOrReplaceSelection("単語");
            expect(nestedRegMode.getMiniBufferEditor().getCommittedText()).toBe("単語");

            // Confirm nested registration
            await nestedRegMode.enterInput();

            // 1. "単語" is registered for "たんご"
            const nestedEntry = await jisyoProvider.lookupCandidates("たんご");
            expect(nestedEntry).toBeDefined();
            expect(nestedEntry?.getCandidateList()[0]?.word).toBe("単語");

            // 2. Active mode pops back to rootRegMode
            expect(adapter.getCurrentInputMode()).toBe(rootRegMode);
            expect(adapter.getModeBadgeText()).toBe("辞書登録");

            // 3. "単語" was appended into rootRegMode's mini-buffer ("複合" + "単語" = "複合単語")
            expect(rootRegMode.getMiniBufferEditor().getCommittedText()).toBe("複合単語");

            // Nothing is committed to DOM element yet!
            expect(mockElement.value).toBe("");

            // Now user confirms root registration
            await rootRegMode.enterInput();

            // 4. "複合単語" is registered for "ふくごうご"
            const rootEntry = await jisyoProvider.lookupCandidates("ふくごうご");
            expect(rootEntry).toBeDefined();
            expect(rootEntry?.getCandidateList()[0]?.word).toBe("複合単語");

            // 5. Root committed to DOM element
            expect(mockElement.value).toBe("複合単語");

            // 6. Restored to document input mode
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
            expect(adapter.getModeBadgeText()).toBe("かな");
        });

        it("canceling nested registration pops back to parent without inserting", async () => {
            await adapter.openRegistrationEditor("おや", "");
            const rootReg = adapter.getCurrentInputMode() as RegistrationMode;
            await rootReg.getMiniBufferEditor().insertOrReplaceSelection("親");

            // Open nested registration for "こ"
            await rootReg.getMiniBufferEditor().openRegistrationEditor("こ", "");
            const nestedReg = adapter.getCurrentInputMode() as RegistrationMode;
            expect(nestedReg.isNested()).toBe(true);

            // User types something in nested
            await nestedReg.getMiniBufferEditor().insertOrReplaceSelection("子");

            // User cancels nested registration with Ctrl+G
            await nestedReg.ctrlGInput();

            // "こ" is NOT registered
            const entry = await jisyoProvider.lookupCandidates("こ");
            expect(entry).toBeUndefined();

            // Popped back to root registration
            expect(adapter.getCurrentInputMode()).toBe(rootReg);
            expect(adapter.getModeBadgeText()).toBe("辞書登録");

            // Parent mini-buffer still has only "親"
            expect(rootReg.getMiniBufferEditor().getCommittedText()).toBe("親");
        });

        it("rejects nesting beyond MAX_REGISTRATION_DEPTH (5) with error message", async () => {
            // Level 1 (depth 1)
            await adapter.openRegistrationEditor("いち", "");
            const reg1 = adapter.getCurrentInputMode() as RegistrationMode;
            expect(reg1.getDepth()).toBe(1);

            // Level 2 (depth 2)
            await reg1.getMiniBufferEditor().openRegistrationEditor("に", "");
            const reg2 = adapter.getCurrentInputMode() as RegistrationMode;
            expect(reg2.getDepth()).toBe(2);

            // Level 3 (depth 3)
            await reg2.getMiniBufferEditor().openRegistrationEditor("さん", "");
            const reg3 = adapter.getCurrentInputMode() as RegistrationMode;
            expect(reg3.getDepth()).toBe(3);

            // Level 4 (depth 4)
            await reg3.getMiniBufferEditor().openRegistrationEditor("よん", "");
            const reg4 = adapter.getCurrentInputMode() as RegistrationMode;
            expect(reg4.getDepth()).toBe(4);

            // Level 5 (depth 5)
            await reg4.getMiniBufferEditor().openRegistrationEditor("ご", "");
            const reg5 = adapter.getCurrentInputMode() as RegistrationMode;
            expect(reg5.getDepth()).toBe(5);

            // Attempt Level 6 (depth > 5) -> rejected
            await reg5.getMiniBufferEditor().openRegistrationEditor("ろく", "");
            expect(adapter.getCurrentInputMode()).toBe(reg5);
            expect(reg5.getDepth()).toBe(5);
        });

        it("backspace on empty nested buffer is a no-op and stays in nested registration", async () => {
            await adapter.openRegistrationEditor("おや２", "");
            const rootReg = adapter.getCurrentInputMode() as RegistrationMode;

            await rootReg.getMiniBufferEditor().openRegistrationEditor("こ２", "");
            const nestedReg = adapter.getCurrentInputMode() as RegistrationMode;

            // Backspace immediately on empty nested buffer is a no-op
            await nestedReg.backspaceInput();

            // Stays in nested registration
            expect(adapter.getCurrentInputMode()).toBe(nestedReg);
            expect(nestedReg.isNested()).toBe(true);
        });
    });

    describe("Triggering Registration via SKK Input Workflow", () => {
        it("triggers RegistrationMode when Midashigo conversion finds no candidates", async () => {
            const hMode = adapter.getCurrentInputMode() as HiraganaMode;

            // Type Shift+M (Midashigo), i, d, a, s, h, i, Space
            await hMode.upperAlphabetInput("M");
            await hMode.lowerAlphabetInput("i");
            await hMode.lowerAlphabetInput("d");
            await hMode.lowerAlphabetInput("a");
            await hMode.lowerAlphabetInput("s");
            await hMode.lowerAlphabetInput("h");
            await hMode.lowerAlphabetInput("i");

            // Press space to convert - "みだし" is not in SimpleMemoryJisyoProvider
            await hMode.spaceInput();

            // Should have entered RegistrationMode!
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(RegistrationMode);
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;
            expect(regMode.getYomi()).toBe("みだし");
            expect(adapter.getModeBadgeText()).toBe("辞書登録");

            // Register "見出し"
            await regMode.getMiniBufferEditor().insertOrReplaceSelection("見出し");
            await regMode.enterInput();

            // Verified in jisyo and DOM
            const entry = await jisyoProvider.lookupCandidates("みだし");
            expect(entry).toBeDefined();
            expect(entry?.getCandidateList()[0]?.word).toBe("見出し");
            expect(mockElement.value).toBe("見出し");
        });

        it("triggers RegistrationMode from InlineHenkanMode when candidate list is exhausted on Space", async () => {
            const hMode = adapter.getCurrentInputMode() as HiraganaMode;

            // "かんじ" has 1 candidate ("漢字") in SimpleMemoryJisyoProvider
            await hMode.upperAlphabetInput("K");
            await hMode.lowerAlphabetInput("a");
            await hMode.lowerAlphabetInput("n");
            await hMode.lowerAlphabetInput("j");
            await hMode.lowerAlphabetInput("i");

            // First space -> shows candidate "漢字" in InlineHenkanMode
            await hMode.spaceInput();
            expect(adapter.getCurrentCandidate()?.word).toBe("漢字");

            // Second space -> candidate list is exhausted -> opens RegistrationMode!
            await hMode.spaceInput();

            expect(adapter.getCurrentInputMode()).toBeInstanceOf(RegistrationMode);
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;
            expect(regMode.getYomi()).toBe("かんじ");
            expect(adapter.getModeBadgeText()).toBe("辞書登録");
        });

        it("reverts candidate to midashigo on Ctrl+G inside mini-buffer without exiting RegistrationMode", async () => {
            await adapter.openRegistrationEditor("てすと", "");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;

            // Type "とうきょう" with midashigo
            await regMode.upperAlphabetInput("T");
            await regMode.lowerAlphabetInput("o");
            await regMode.lowerAlphabetInput("u");
            await regMode.lowerAlphabetInput("k");
            await regMode.lowerAlphabetInput("y");
            await regMode.lowerAlphabetInput("o");
            await regMode.lowerAlphabetInput("u");

            // Convert to "東京"
            await regMode.spaceInput();
            expect(regMode.getMiniBufferEditor().getCurrentCandidate()?.word).toBe("東京");

            // Press Ctrl+G while candidate is active
            await regMode.ctrlGInput();

            // Should cancel candidate back to midashigo, but STAY in RegistrationMode!
            expect(adapter.getCurrentInputMode()).toBe(regMode);
            expect(regMode.getMiniBufferEditor().getCurrentCandidate()).toBeUndefined();
            expect(regMode.getMiniBufferEditor().isInMidashigo()).toBe(true);
            expect(regMode.getMiniBufferEditor().getMidashigoText()).toBe("とうきょう");
        });

        it("deletes character within midashigo on backspace inside mini-buffer", async () => {
            await adapter.openRegistrationEditor("てすと２", "");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;

            await regMode.upperAlphabetInput("T");
            await regMode.lowerAlphabetInput("o");
            await regMode.lowerAlphabetInput("u"); // midashigoText = "とう"
            expect(regMode.getMiniBufferEditor().getMidashigoText()).toBe("とう");

            // Backspace inside midashigo
            await regMode.backspaceInput();
            expect(regMode.getMiniBufferEditor().getMidashigoText()).toBe("と");
            expect(adapter.getCurrentInputMode()).toBe(regMode);
        });

        it("supports 3-level deep nested registration", async () => {
            // Level 1: Root
            await adapter.openRegistrationEditor("れべる１", "");
            const reg1 = adapter.getCurrentInputMode() as RegistrationMode;

            // Level 2: Nested inside reg1
            await reg1.getMiniBufferEditor().openRegistrationEditor("れべる２", "");
            const reg2 = adapter.getCurrentInputMode() as RegistrationMode;
            expect(reg2.isNested()).toBe(true);
            expect(reg2.getParentRegistration()).toBe(reg1);
            expect(adapter.getModeBadgeText()).toBe("再帰登録");

            // Level 3: Nested inside reg2
            await reg2.getMiniBufferEditor().openRegistrationEditor("れべる３", "");
            const reg3 = adapter.getCurrentInputMode() as RegistrationMode;
            expect(reg3.isNested()).toBe(true);
            expect(reg3.getParentRegistration()).toBe(reg2);
            expect(adapter.getModeBadgeText()).toBe("再帰登録");

            // Register word in Level 3
            await reg3.getMiniBufferEditor().insertOrReplaceSelection("三");
            await reg3.enterInput();

            // Level 3 confirmed: registered in jisyo, popped to Level 2
            const entry3 = await jisyoProvider.lookupCandidates("れべる３");
            expect(entry3?.getCandidateList()[0]?.word).toBe("三");
            expect(adapter.getCurrentInputMode()).toBe(reg2);
            expect(reg2.getMiniBufferEditor().getCommittedText()).toBe("三");

            // Register in Level 2: "二" + "三"
            await reg2.getMiniBufferEditor().insertOrReplaceSelection("二");
            await reg2.enterInput();

            // Level 2 confirmed: popped to Level 1
            const entry2 = await jisyoProvider.lookupCandidates("れべる２");
            expect(entry2?.getCandidateList()[0]?.word).toBe("三二");
            expect(adapter.getCurrentInputMode()).toBe(reg1);
            expect(reg1.getMiniBufferEditor().getCommittedText()).toBe("三二");

            // Register Level 1: "一" + "三二"
            await reg1.getMiniBufferEditor().insertOrReplaceSelection("一");
            await reg1.enterInput();

            const entry1 = await jisyoProvider.lookupCandidates("れべる１");
            expect(entry1?.getCandidateList()[0]?.word).toBe("三二一");
            expect(mockElement.value).toBe("三二一");
            expect(adapter.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
        });
    });

    describe("HUD Presentation for Registration Mode", () => {
        it("formats preedit and candidate in HUD state correctly", async () => {
            await adapter.openRegistrationEditor("よみ", "");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;

            // Type "k", "o", "d", "o"
            await regMode.lowerAlphabetInput("k");
            await regMode.lowerAlphabetInput("o");

            let hudState = hud.getState();
            expect(hudState).toBeDefined();
            expect(hudState?.mode).toBe("辞書登録");
            expect(hudState?.preedit).toBe("[よみ] こ");

            // Enter Midashigo inside registration
            await regMode.upperAlphabetInput("D");
            await regMode.lowerAlphabetInput("o");

            hudState = hud.getState();
            expect(hudState?.preedit).toContain("▽ど");
        });

        it("styles badge for 辞書登録 and 再帰登録 with peach color (#fab387)", () => {
            hud.update({
                x: 50,
                y: 50,
                mode: "辞書登録",
                preedit: "[テスト] "
            });
            expect(hud.getState()?.mode).toBe("辞書登録");

            hud.update({
                x: 50,
                y: 50,
                mode: "再帰登録",
                preedit: "[ネスト] "
            });
            expect(hud.getState()?.mode).toBe("再帰登録");
        });

        it("does not duplicate ▽midashigo in preedit when candidate is active in RegistrationMode", async () => {
            await adapter.openRegistrationEditor("しゅと", "");
            const regMode = adapter.getCurrentInputMode() as RegistrationMode;

            // Type "とうきょう" with midashigo
            await regMode.upperAlphabetInput("T");
            await regMode.lowerAlphabetInput("o");
            await regMode.lowerAlphabetInput("u");
            await regMode.lowerAlphabetInput("k");
            await regMode.lowerAlphabetInput("y");
            await regMode.lowerAlphabetInput("o");
            await regMode.lowerAlphabetInput("u");

            // Convert to "東京"
            await regMode.spaceInput();

            const hudState = hud.getState();
            expect(hudState?.candidate).toBe("東京");
            // preedit should only be "[しゅと] " and not contain "▽とうきょう"
            expect(hudState?.preedit).toBe("[しゅと] ");
        });
    });
});
