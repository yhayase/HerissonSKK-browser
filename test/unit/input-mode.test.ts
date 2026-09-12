import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockEditor, MockJisyoProvider } from "./mocks/MockEditor";
import { EditorFactory } from "../../src/core/skk/editor/EditorFactory";
import { HiraganaMode } from "../../src/core/skk/input-mode/HiraganaMode";
import { KatakanaMode } from "../../src/core/skk/input-mode/KatakanaMode";
import { AsciiMode } from "../../src/core/skk/input-mode/AsciiMode";
import { ZeneiMode } from "../../src/core/skk/input-mode/ZeneiMode";
import { Candidate } from "../../src/core/skk/jisyo/candidate";

describe("SKK Input Modes", () => {
    let mockEditor: MockEditor;
    let hiraganaMode: HiraganaMode;

    beforeEach(() => {
        mockEditor = new MockEditor();
        EditorFactory.setInstance(mockEditor);
        hiraganaMode = HiraganaMode.getInstance();
        mockEditor.setInputMode(hiraganaMode);
    });

    afterEach(() => {
        EditorFactory.reset();
    });

    describe("1. Input mode switching", () => {
        it("switches Hiragana <-> Katakana with 'q'", async () => {
            expect(mockEditor.getCurrentInputMode().toString()).toBe("かな");
            expect(mockEditor.getCurrentInputMode().getContextualName()).toBe("hiragana:kakutei");

            // Hiragana -> Katakana with 'q'
            await mockEditor.getCurrentInputMode().lowerAlphabetInput("q");
            expect(mockEditor.getCurrentInputMode()).toBeInstanceOf(KatakanaMode);
            expect(mockEditor.getCurrentInputMode().toString()).toBe("カナ");
            expect(mockEditor.getCurrentInputMode().getContextualName()).toBe("katakana:kakutei");

            // Katakana -> Hiragana with 'q'
            await mockEditor.getCurrentInputMode().lowerAlphabetInput("q");
            expect(mockEditor.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
            expect(mockEditor.getCurrentInputMode().toString()).toBe("かな");
        });

        it("switches to ZeneiMode with 'L' and back with Ctrl+j", async () => {
            // Hiragana -> Zenei with 'L'
            await mockEditor.getCurrentInputMode().upperAlphabetInput("L");
            expect(mockEditor.getCurrentInputMode()).toBeInstanceOf(ZeneiMode);
            expect(mockEditor.getCurrentInputMode().getContextualName()).toBe("zenei");

            // Input in Zenei converts to full-width
            await mockEditor.getCurrentInputMode().lowerAlphabetInput("a");
            await mockEditor.getCurrentInputMode().upperAlphabetInput("B");
            await mockEditor.getCurrentInputMode().numberInput("1");
            await mockEditor.getCurrentInputMode().symbolInput("!");
            expect(mockEditor.getCurrentText()).toBe("ａＢ１！");

            // Zenei -> Hiragana with Ctrl+j
            await mockEditor.getCurrentInputMode().ctrlJInput();
            expect(mockEditor.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
            expect(mockEditor.getCurrentInputMode().toString()).toBe("かな");
        });

        it("switches to AsciiMode with 'l' and back with Ctrl+j", async () => {
            // Hiragana -> Ascii with 'l'
            await mockEditor.getCurrentInputMode().lowerAlphabetInput("l");
            expect(mockEditor.getCurrentInputMode()).toBeInstanceOf(AsciiMode);
            expect(mockEditor.getCurrentInputMode().getContextualName()).toBe("ascii");

            // Input in Ascii inserts verbatim
            await mockEditor.getCurrentInputMode().lowerAlphabetInput("a");
            await mockEditor.getCurrentInputMode().upperAlphabetInput("B");
            await mockEditor.getCurrentInputMode().numberInput("1");
            expect(mockEditor.getCurrentText()).toBe("aB1");

            // Ascii -> Hiragana with Ctrl+j
            await mockEditor.getCurrentInputMode().ctrlJInput();
            expect(mockEditor.getCurrentInputMode()).toBeInstanceOf(HiraganaMode);
            expect(mockEditor.getCurrentInputMode().toString()).toBe("かな");
        });

        it("verifies getActiveKeys in different modes", () => {
            const hKeys = hiraganaMode.getActiveKeys();
            expect(hKeys.has("q")).toBe(true);
            expect(hKeys.has("ctrl+j")).toBe(true);
            expect(hKeys.has("ctrl+g")).toBe(true);

            const asciiMode = AsciiMode.getInstance();
            expect(asciiMode.getActiveKeys()).toEqual(new Set(["ctrl+j"]));

            const zeneiMode = ZeneiMode.getInstance();
            expect(zeneiMode.getActiveKeys().has("ctrl+j")).toBe(true);
            expect(zeneiMode.getActiveKeys().has("a")).toBe(true);
        });
    });

    describe("2. Midashigo mode entry with uppercase letter", () => {
        it("enters MidashigoMode with 'K' in HiraganaMode", async () => {
            await hiraganaMode.upperAlphabetInput("K");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:midashigo:gokan");
            expect(mockEditor.getCurrentText()).toBe("▽");

            await hiraganaMode.lowerAlphabetInput("a");
            expect(mockEditor.getCurrentText()).toBe("▽か");
            expect(mockEditor.getMidashigo()).toBe("か");
        });

        it("enters MidashigoMode with 'A' in HiraganaMode", async () => {
            await hiraganaMode.upperAlphabetInput("A");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:midashigo:gokan");
            expect(mockEditor.getCurrentText()).toBe("▽あ");
            expect(mockEditor.getMidashigo()).toBe("あ");
        });

        it("enters MidashigoMode with 'K' in KatakanaMode", async () => {
            const katakanaMode = KatakanaMode.getInstance();
            mockEditor.setInputMode(katakanaMode);

            await katakanaMode.upperAlphabetInput("K");
            expect(katakanaMode.getContextualName()).toBe("katakana:midashigo:gokan");
            expect(mockEditor.getCurrentText()).toBe("▽");

            await katakanaMode.lowerAlphabetInput("a");
            expect(mockEditor.getCurrentText()).toBe("▽カ");
            expect(mockEditor.getMidashigo()).toBe("カ");
        });
    });

    describe("3. Okuri-ari conversion", () => {
        it.each([
            ["TsukaTt", "e", "つかt", "使", "って"],
            ["IKk", "u", "いk", "行", "っく"],
            ["TsukaTT", "e", "つかt", "使", "って"],
        ])("%s は送り仮名が完成するまで変換しません", async (prefix, last, key, word, okuri) => {
            await mockEditor.getJisyoProvider().registerCandidate(key, new Candidate(word));
            await mockEditor.getJisyoProvider().registerCandidate("つか", new Candidate("塚"));
            for (const char of prefix) {
                if (char === char.toUpperCase()) await hiraganaMode.upperAlphabetInput(char);
                else await hiraganaMode.lowerAlphabetInput(char);
            }
            expect(hiraganaMode.getContextualName()).toBe("hiragana:midashigo:okurigana");
            expect(mockEditor.getCurrentCandidate()).toBeUndefined();
            await hiraganaMode.lowerAlphabetInput(last);
            expect(hiraganaMode.getContextualName()).toBe("hiragana:inlineHenkan");
            expect(mockEditor.getCurrentCandidate()?.word).toBe(word);
            expect(mockEditor.getAppendedSuffix()).toBe(okuri);
            await hiraganaMode.ctrlJInput();
            expect(mockEditor.getCurrentText()).toBe(word + okuri);
        });

        it("促音の入力中も削除して送り仮名を入力し直せます", async () => {
            await mockEditor.getJisyoProvider().registerCandidate("つかt", new Candidate("使"));
            for (const char of "TsukaTt") {
                if (char === char.toUpperCase()) await hiraganaMode.upperAlphabetInput(char);
                else await hiraganaMode.lowerAlphabetInput(char);
            }
            await hiraganaMode.backspaceInput();
            await hiraganaMode.backspaceInput();
            expect(hiraganaMode.getContextualName()).toBe("hiragana:midashigo:gokan");
            await hiraganaMode.upperAlphabetInput("T");
            await hiraganaMode.lowerAlphabetInput("t");
            await hiraganaMode.lowerAlphabetInput("e");
            expect(mockEditor.getAppendedSuffix()).toBe("って");
            await hiraganaMode.ctrlGInput();
            expect(mockEditor.getCurrentText()).toBe("▽つかって");
        });

        it("促音の入力中に確定しても生成済みのかなを失いません", async () => {
            for (const char of "TsukaTt") {
                if (char === char.toUpperCase()) await hiraganaMode.upperAlphabetInput(char);
                else await hiraganaMode.lowerAlphabetInput(char);
            }
            await hiraganaMode.ctrlJInput();
            expect(mockEditor.getCurrentText()).toBe("つかっ");
        });

        it("converts with uppercase okuri trigger (I -> K -> u -> 行く)", async () => {
            // Register 'いk' with candidate '行' (okuri 'く' cooks to '行く')
            await mockEditor.getJisyoProvider().registerCandidate("いk", new Candidate("行"));

            // 'I' starts midashigo with 'い'
            await hiraganaMode.upperAlphabetInput("I");
            expect(mockEditor.getCurrentText()).toBe("▽い");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:midashigo:gokan");

            // 'K' starts okurigana mode
            await hiraganaMode.upperAlphabetInput("K");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:midashigo:okurigana");
            expect(mockEditor.isOkuriStateActive()).toBe(true);

            // 'u' completes okuri 'く' -> triggers conversion
            await hiraganaMode.lowerAlphabetInput("u");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:inlineHenkan");
            expect(mockEditor.getCurrentText()).toBe("▼行");
            expect(mockEditor.getAppendedSuffix()).toBe("く");
            expect(mockEditor.getCurrentCandidate()?.word).toBe("行");

            // Fixate with Ctrl+j
            await hiraganaMode.ctrlJInput();
            expect(mockEditor.getCurrentText()).toBe("行く");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:kakutei");
        });

        it("handles okuri-ari conversion with direct vowel okuri (A -> U -> 合う)", async () => {
            await mockEditor.getJisyoProvider().registerCandidate("あu", new Candidate("合"));

            await hiraganaMode.upperAlphabetInput("A"); // ▽あ
            await hiraganaMode.upperAlphabetInput("U"); // okuri 'う' immediately completes -> ▼合 with suffix 'う'
            expect(mockEditor.getCurrentText()).toBe("▼合");
            expect(mockEditor.getAppendedSuffix()).toBe("う");

            await hiraganaMode.ctrlJInput();
            expect(mockEditor.getCurrentText()).toBe("合う");
        });
    });

    describe("4. Okuri-nasi conversion", () => {
        it("converts Toukyou with Space (T -> o -> u -> k -> y -> o -> u -> Space -> 東京)", async () => {
            await mockEditor.getJisyoProvider().registerCandidate("とうきょう", new Candidate("東京"));

            // Type Toukyou
            await hiraganaMode.upperAlphabetInput("T");
            await hiraganaMode.lowerAlphabetInput("o");
            await hiraganaMode.lowerAlphabetInput("u");
            await hiraganaMode.lowerAlphabetInput("k");
            await hiraganaMode.lowerAlphabetInput("y");
            await hiraganaMode.lowerAlphabetInput("o");
            await hiraganaMode.lowerAlphabetInput("u");
            expect(mockEditor.getCurrentText()).toBe("▽とうきょう");
            expect(mockEditor.getMidashigo()).toBe("とうきょう");

            // Press Space to convert
            await hiraganaMode.spaceInput();
            expect(hiraganaMode.getContextualName()).toBe("hiragana:inlineHenkan");
            expect(mockEditor.getCurrentText()).toBe("▼東京");

            // Fixate with Ctrl+j
            await hiraganaMode.ctrlJInput();
            expect(mockEditor.getCurrentText()).toBe("東京");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:kakutei");
        });
    });

    describe("5. Candidate cycling with Space and x", () => {
        it("cycles forward with Space and backward with x", async () => {
            const provider = mockEditor.getJisyoProvider();
            // Candidate order when registered with unshift: 4, 3, 2, 1
            // Let's register in reverse so they are ordered: 候補1, 候補2, 候補3, 候補4
            await provider.registerCandidate("てすと", new Candidate("候補4"));
            await provider.registerCandidate("てすと", new Candidate("候補3"));
            await provider.registerCandidate("てすと", new Candidate("候補2"));
            await provider.registerCandidate("てすと", new Candidate("候補1"));

            await hiraganaMode.upperAlphabetInput("T");
            await hiraganaMode.lowerAlphabetInput("e");
            await hiraganaMode.lowerAlphabetInput("s");
            await hiraganaMode.lowerAlphabetInput("u");
            await hiraganaMode.lowerAlphabetInput("t");
            await hiraganaMode.lowerAlphabetInput("o");
            expect(mockEditor.getCurrentText()).toBe("▽てすと");

            // 1st candidate
            await hiraganaMode.spaceInput();
            expect(mockEditor.getCurrentText()).toBe("▼候補1");

            // 2nd candidate
            await hiraganaMode.spaceInput();
            expect(mockEditor.getCurrentText()).toBe("▼候補2");

            // 3rd candidate
            await hiraganaMode.spaceInput();
            expect(mockEditor.getCurrentText()).toBe("▼候補3");

            // Cycle backward with 'x' to 2nd candidate
            await hiraganaMode.lowerAlphabetInput("x");
            expect(mockEditor.getCurrentText()).toBe("▼候補2");

            // Cycle backward with 'x' to 1st candidate
            await hiraganaMode.lowerAlphabetInput("x");
            expect(mockEditor.getCurrentText()).toBe("▼候補1");

            // Cycle backward with 'x' returns to MidashigoMode
            await hiraganaMode.lowerAlphabetInput("x");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:midashigo:gokan");
            expect(mockEditor.getCurrentText()).toBe("▽てすと");

            // Re-convert with Space after returning to MidashigoMode with 'x'
            await hiraganaMode.spaceInput();
            expect(hiraganaMode.getContextualName()).toBe("hiragana:inlineHenkan");
            expect(mockEditor.getCurrentText()).toBe("▼候補1");

            await hiraganaMode.ctrlJInput();
            expect(mockEditor.getCurrentText()).toBe("候補1");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:kakutei");
        });

        it("transitions to MenuHenkanMode when exceeding MAX_INLINE_CANDIDATES (3)", async () => {
            const provider = mockEditor.getJisyoProvider();
            await provider.registerCandidate("てすと", new Candidate("候補4"));
            await provider.registerCandidate("てすと", new Candidate("候補3"));
            await provider.registerCandidate("てすと", new Candidate("候補2"));
            await provider.registerCandidate("てすと", new Candidate("候補1"));

            await hiraganaMode.upperAlphabetInput("T");
            await hiraganaMode.lowerAlphabetInput("e");
            await hiraganaMode.lowerAlphabetInput("s");
            await hiraganaMode.lowerAlphabetInput("u");
            await hiraganaMode.lowerAlphabetInput("t");
            await hiraganaMode.lowerAlphabetInput("o");

            // 1st candidate
            await hiraganaMode.spaceInput();
            // 2nd candidate
            await hiraganaMode.spaceInput();
            // 3rd candidate
            await hiraganaMode.spaceInput();
            // 4th candidate triggers MenuHenkanMode
            await hiraganaMode.spaceInput();
            expect(hiraganaMode.getContextualName()).toBe("hiragana:menuHenkan");
            expect(mockEditor.getCandidateList().candidates.length).toBeGreaterThan(0);
            expect(mockEditor.getCandidateList().selectionKeys).toEqual(["A", "S", "D", "F", "J", "K", "L"]);

            // Select candidate with selection key 'a'
            await hiraganaMode.lowerAlphabetInput("a");
            expect(mockEditor.getCurrentText()).toBe("候補4");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:kakutei");
        });

        it("handles invalid keys in MenuHenkanMode without throwing exceptions", async () => {
            const provider = mockEditor.getJisyoProvider();
            await provider.registerCandidate("てすと", new Candidate("候補4"));
            await provider.registerCandidate("てすと", new Candidate("候補3"));
            await provider.registerCandidate("てすと", new Candidate("候補2"));
            await provider.registerCandidate("てすと", new Candidate("候補1"));

            await hiraganaMode.upperAlphabetInput("T");
            await hiraganaMode.lowerAlphabetInput("e");
            await hiraganaMode.lowerAlphabetInput("s");
            await hiraganaMode.lowerAlphabetInput("u");
            await hiraganaMode.lowerAlphabetInput("t");
            await hiraganaMode.lowerAlphabetInput("o");

            await hiraganaMode.spaceInput();
            await hiraganaMode.spaceInput();
            await hiraganaMode.spaceInput();
            await hiraganaMode.spaceInput();
            expect(hiraganaMode.getContextualName()).toBe("hiragana:menuHenkan");

            // Invalid symbol key (e.g. '@')
            await hiraganaMode.symbolInput("@");
            expect(mockEditor.getLastErrorMessage()).toBe("'@' is not valid here!");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:menuHenkan");

            // Invalid number key
            await hiraganaMode.numberInput("1");
            expect(mockEditor.getLastErrorMessage()).toBe("'1' is not valid here!");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:menuHenkan");

            // Invalid lower alphabet key (non-selection key like 'z')
            await hiraganaMode.lowerAlphabetInput("z");
            expect(mockEditor.getLastErrorMessage()).toBe("'z' is not valid here!");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:menuHenkan");

            // Invalid upper alphabet key (non-selection key like 'Z')
            await hiraganaMode.upperAlphabetInput("Z");
            expect(mockEditor.getLastErrorMessage()).toBe("'Z' is not valid here!");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:menuHenkan");

            // Enter key
            await hiraganaMode.enterInput();
            expect(mockEditor.getLastErrorMessage()).toBe("Enter is not valid here!");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:menuHenkan");

            // Ctrl+j key
            await hiraganaMode.ctrlJInput();
            expect(mockEditor.getLastErrorMessage()).toBe("C-j is not valid here!");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:menuHenkan");
        });
    });

    describe("6. Cancel with Ctrl+g / Escape", () => {
        it("cancels MidashigoMode with Ctrl+g", async () => {
            await hiraganaMode.upperAlphabetInput("K");
            await hiraganaMode.lowerAlphabetInput("a");
            expect(mockEditor.getCurrentText()).toBe("▽か");

            // Ctrl+g clears midashigo and returns to KakuteiMode
            await hiraganaMode.ctrlGInput();
            expect(mockEditor.getCurrentText()).toBe("");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:kakutei");
        });

        it("cancels InlineHenkanMode with Ctrl+g back to MidashigoMode", async () => {
            await mockEditor.getJisyoProvider().registerCandidate("かんじ", new Candidate("漢字"));

            await hiraganaMode.upperAlphabetInput("K");
            await hiraganaMode.lowerAlphabetInput("a");
            await hiraganaMode.lowerAlphabetInput("n");
            await hiraganaMode.lowerAlphabetInput("j");
            await hiraganaMode.lowerAlphabetInput("i");
            await hiraganaMode.spaceInput();
            expect(mockEditor.getCurrentText()).toBe("▼漢字");

            // Ctrl+g returns to MidashigoMode with '▽かんじ'
            await hiraganaMode.ctrlGInput();
            expect(hiraganaMode.getContextualName()).toBe("hiragana:midashigo:gokan");
            expect(mockEditor.getCurrentText()).toBe("▽かんじ");

            // Re-convert with Space and fixate
            await hiraganaMode.spaceInput();
            expect(hiraganaMode.getContextualName()).toBe("hiragana:inlineHenkan");
            expect(mockEditor.getCurrentText()).toBe("▼漢字");

            await hiraganaMode.ctrlJInput();
            expect(mockEditor.getCurrentText()).toBe("漢字");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:kakutei");
        });

        it("cancels MenuHenkanMode with Ctrl+g back to MidashigoMode and re-converts", async () => {
            const provider = mockEditor.getJisyoProvider();
            await provider.registerCandidate("てすと", new Candidate("4"));
            await provider.registerCandidate("てすと", new Candidate("3"));
            await provider.registerCandidate("てすと", new Candidate("2"));
            await provider.registerCandidate("てすと", new Candidate("1"));

            await hiraganaMode.upperAlphabetInput("T");
            await hiraganaMode.lowerAlphabetInput("e");
            await hiraganaMode.lowerAlphabetInput("s");
            await hiraganaMode.lowerAlphabetInput("u");
            await hiraganaMode.lowerAlphabetInput("t");
            await hiraganaMode.lowerAlphabetInput("o");
            await hiraganaMode.spaceInput();
            await hiraganaMode.spaceInput();
            await hiraganaMode.spaceInput();
            await hiraganaMode.spaceInput(); // MenuHenkanMode
            expect(hiraganaMode.getContextualName()).toBe("hiragana:menuHenkan");

            await hiraganaMode.ctrlGInput();
            expect(hiraganaMode.getContextualName()).toBe("hiragana:midashigo:gokan");
            expect(mockEditor.getCurrentText()).toBe("▽てすと");

            // Re-convert with Space
            await hiraganaMode.spaceInput();
            expect(hiraganaMode.getContextualName()).toBe("hiragana:inlineHenkan");
            expect(mockEditor.getCurrentText()).toBe("▼1");
        });
    });

    describe("7. Prefix and Suffix conversion ('>')", () => {
        it("performs prefix conversion with '>' (dai> -> 大)", async () => {
            await mockEditor.getJisyoProvider().registerCandidate("だい>", new Candidate("大"));

            await hiraganaMode.upperAlphabetInput("D");
            await hiraganaMode.lowerAlphabetInput("a");
            await hiraganaMode.lowerAlphabetInput("i");
            await hiraganaMode.symbolInput(">");

            expect(hiraganaMode.getContextualName()).toBe("hiragana:inlineHenkan");
            expect(mockEditor.getCurrentText()).toBe("▼大");

            await hiraganaMode.ctrlJInput();
            expect(mockEditor.getCurrentText()).toBe("大");
        });

        it("performs suffix conversion with '>' (>san -> 様)", async () => {
            await mockEditor.getJisyoProvider().registerCandidate("こばやし", new Candidate("小林"));
            await mockEditor.getJisyoProvider().registerCandidate(">さん", new Candidate("様"));

            // Type Kobayashi -> 小林
            await hiraganaMode.upperAlphabetInput("K");
            await hiraganaMode.lowerAlphabetInput("o");
            await hiraganaMode.lowerAlphabetInput("b");
            await hiraganaMode.lowerAlphabetInput("a");
            await hiraganaMode.lowerAlphabetInput("y");
            await hiraganaMode.lowerAlphabetInput("a");
            await hiraganaMode.lowerAlphabetInput("s");
            await hiraganaMode.lowerAlphabetInput("i");
            await hiraganaMode.spaceInput();
            expect(mockEditor.getCurrentText()).toBe("▼小林");

            // Press '>' during inline henkan: fixates '小林' and starts suffix midashigo '▽>'
            await hiraganaMode.symbolInput(">");
            expect(mockEditor.getFixatedCandidate()).toBe("小林");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:midashigo:gokan");
            expect(mockEditor.getCurrentText()).toBe("小林▽>");

            // Type 'san'
            await hiraganaMode.lowerAlphabetInput("s");
            await hiraganaMode.lowerAlphabetInput("a");
            await hiraganaMode.lowerAlphabetInput("n");
            expect(mockEditor.getCurrentText()).toBe("小林▽>さ");
            expect(mockEditor.getRemainingRomaji()).toBe("n");

            // Convert suffix (Space flushes 'n' -> 'ん', looking up '>さん')
            await hiraganaMode.spaceInput();
            expect(hiraganaMode.getContextualName()).toBe("hiragana:inlineHenkan");
            expect(mockEditor.getCurrentText()).toBe("小林▼様");

            // Fixate suffix
            await hiraganaMode.ctrlJInput();
            expect(mockEditor.getCurrentText()).toBe("小林様");
        });
    });

    describe("8. AbbrevMode", () => {
        it("enters AbbrevMode with '/' and converts ascii keyword", async () => {
            await mockEditor.getJisyoProvider().registerCandidate("wp", new Candidate("Wikipedia"));

            await hiraganaMode.symbolInput("/");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:abbrev");
            expect(mockEditor.getCurrentText()).toBe("▽");

            await hiraganaMode.lowerAlphabetInput("w");
            await hiraganaMode.lowerAlphabetInput("p");
            expect(mockEditor.getCurrentText()).toBe("▽wp");

            await hiraganaMode.spaceInput();
            expect(hiraganaMode.getContextualName()).toBe("hiragana:inlineHenkan");
            expect(mockEditor.getCurrentText()).toBe("▼Wikipedia");

            await hiraganaMode.ctrlJInput();
            expect(mockEditor.getCurrentText()).toBe("Wikipedia");
        });

        it("includes printable ASCII characters in AbbrevMode.getActiveKeys()", async () => {
            await hiraganaMode.symbolInput("/");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:abbrev");

            const activeKeys = hiraganaMode.getActiveKeys();
            expect(activeKeys.has("a")).toBe(true);
            expect(activeKeys.has("shift+a")).toBe(true);
            expect(activeKeys.has("z")).toBe(true);
            expect(activeKeys.has("1")).toBe(true);
            expect(activeKeys.has(";")).toBe(true);
            expect(activeKeys.has("=")).toBe(true);
            expect(activeKeys.has("space")).toBe(true);
            expect(activeKeys.has("enter")).toBe(true);
            expect(activeKeys.has("ctrl+j")).toBe(true);
            expect(activeKeys.has("ctrl+g")).toBe(true);
            expect(activeKeys.has("backspace")).toBe(true);
        });
    });

    describe("9. CandidateDeletionMode", () => {
        it("confirms and deletes candidate with uppercase 'X' then 'Y'", async () => {
            const provider = mockEditor.getJisyoProvider();
            await provider.registerCandidate("たんご", new Candidate("単語"));

            await hiraganaMode.upperAlphabetInput("T");
            await hiraganaMode.lowerAlphabetInput("a");
            await hiraganaMode.lowerAlphabetInput("n");
            await hiraganaMode.lowerAlphabetInput("g");
            await hiraganaMode.lowerAlphabetInput("o");
            await hiraganaMode.spaceInput();
            expect(mockEditor.getCurrentText()).toBe("▼単語");

            // Press 'X' to enter CandidateDeletionMode
            await hiraganaMode.upperAlphabetInput("X");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:candidateDeletion");
            expect(mockEditor.getAppendedSuffix()).toContain("Really delete");

            // Press 'N' cancels deletion and returns to InlineHenkanMode
            await hiraganaMode.upperAlphabetInput("N");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:inlineHenkan");

            // Press 'X' again, then 'Y' confirms deletion
            await hiraganaMode.upperAlphabetInput("X");
            await hiraganaMode.upperAlphabetInput("Y");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:kakutei");

            // Verify deleted from jisyo
            const entry = await provider.lookupCandidates("たんご");
            expect(entry).toBeUndefined();
        });

        it("handles invalid keys in CandidateDeletionMode without throwing exceptions", async () => {
            const provider = mockEditor.getJisyoProvider();
            await provider.registerCandidate("たんご", new Candidate("単語"));

            await hiraganaMode.upperAlphabetInput("T");
            await hiraganaMode.lowerAlphabetInput("a");
            await hiraganaMode.lowerAlphabetInput("n");
            await hiraganaMode.lowerAlphabetInput("g");
            await hiraganaMode.lowerAlphabetInput("o");
            await hiraganaMode.spaceInput();
            expect(mockEditor.getCurrentText()).toBe("▼単語");

            // Press 'X' to enter CandidateDeletionMode
            await hiraganaMode.upperAlphabetInput("X");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:candidateDeletion");

            // Lowercase 'y' and 'n'
            await hiraganaMode.lowerAlphabetInput("y");
            expect(mockEditor.getLastErrorMessage()).toBe("Type Y or N in upper case");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:candidateDeletion");

            await hiraganaMode.lowerAlphabetInput("n");
            expect(mockEditor.getLastErrorMessage()).toBe("Type Y or N in upper case");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:candidateDeletion");

            // Other lowercase alphabet
            await hiraganaMode.lowerAlphabetInput("z");
            expect(mockEditor.getLastErrorMessage()).toBe("Type Y or N");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:candidateDeletion");

            // Other uppercase alphabet (not Y/N)
            await hiraganaMode.upperAlphabetInput("Z");
            expect(mockEditor.getLastErrorMessage()).toBe("Type Y or N");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:candidateDeletion");

            // Number
            await hiraganaMode.numberInput("1");
            expect(mockEditor.getLastErrorMessage()).toBe("Type Y or N");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:candidateDeletion");

            // Symbol
            await hiraganaMode.symbolInput("?");
            expect(mockEditor.getLastErrorMessage()).toBe("Type Y or N");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:candidateDeletion");

            // Space
            await hiraganaMode.spaceInput();
            expect(mockEditor.getLastErrorMessage()).toBe("Type Y or N");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:candidateDeletion");

            // Enter
            await hiraganaMode.enterInput();
            expect(mockEditor.getLastErrorMessage()).toBe("Type Y or N");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:candidateDeletion");

            // Backspace
            await hiraganaMode.backspaceInput();
            expect(mockEditor.getLastErrorMessage()).toBe("Type Y or N");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:candidateDeletion");

            // Ctrl+j
            await hiraganaMode.ctrlJInput();
            expect(mockEditor.getLastErrorMessage()).toBe("Type Y or N");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:candidateDeletion");

            // Cancel with 'N'
            await hiraganaMode.upperAlphabetInput("N");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:inlineHenkan");
        });
    });

    describe("10. Toggle kana type in MidashigoMode with 'q'", () => {
        it("toggles midashigo from Hiragana to Katakana and fixates", async () => {
            await hiraganaMode.upperAlphabetInput("K");
            await hiraganaMode.lowerAlphabetInput("a");
            expect(mockEditor.getCurrentText()).toBe("▽か");

            // 'q' toggles to katakana and fixates
            await hiraganaMode.lowerAlphabetInput("q");
            expect(mockEditor.getCurrentText()).toBe("カ");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:kakutei");
        });
    });

    describe("11. Unmapped symbols in KakuteiMode", () => {
        it("inserts unmapped symbols directly without discarding them", async () => {
            expect(hiraganaMode.getContextualName()).toBe("hiragana:kakutei");

            // Unmapped symbols like ';', ':', '>'
            await hiraganaMode.symbolInput(";");
            expect(mockEditor.getCurrentText()).toBe(";");

            await hiraganaMode.symbolInput(":");
            expect(mockEditor.getCurrentText()).toBe(";:");

            // Mapped symbol like '.' converts to '。'
            await hiraganaMode.symbolInput(".");
            expect(mockEditor.getCurrentText()).toBe(";:。");

            // Mapped symbol '-' converts to 'ー'
            await hiraganaMode.symbolInput("-");
            expect(mockEditor.getCurrentText()).toBe(";:。ー");
        });
    });
});
