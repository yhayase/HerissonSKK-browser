import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockEditor } from "./mocks/MockEditor";
import { EditorFactory } from "../../src/core/skk/editor/EditorFactory";
import { HiraganaMode } from "../../src/core/skk/input-mode/HiraganaMode";
import { KatakanaMode } from "../../src/core/skk/input-mode/KatakanaMode";
import { AsciiMode } from "../../src/core/skk/input-mode/AsciiMode";
import { ZeneiMode } from "../../src/core/skk/input-mode/ZeneiMode";
import { Candidate } from "../../src/core/skk/jisyo/candidate";

describe("SKK Core Engine - Edge Cases & Robustness", () => {
    let mockEditor: MockEditor;
    let hiraganaMode: HiraganaMode;

    beforeEach(() => {
        mockEditor = new MockEditor();
        EditorFactory.setInstance(mockEditor);
        hiraganaMode = HiraganaMode.getInstance(mockEditor);
        mockEditor.setInputMode(hiraganaMode);
    });

    afterEach(() => {
        EditorFactory.reset();
    });

    describe("1. 未確定・変換途中でのモード切り替え・キー割り込み (Interrupting midashigo & henkan)", () => {
        it("1.1: MidashigoMode (▽とうきょう) で 'l' を押すと見出し語を確定して AsciiMode に遷移する", async () => {
            await hiraganaMode.upperAlphabetInput("T");
            await hiraganaMode.lowerAlphabetInput("o");
            await hiraganaMode.lowerAlphabetInput("u");
            await hiraganaMode.lowerAlphabetInput("k");
            await hiraganaMode.lowerAlphabetInput("y");
            await hiraganaMode.lowerAlphabetInput("o");
            await hiraganaMode.lowerAlphabetInput("u");
            expect(mockEditor.getCurrentText()).toBe("▽とうきょう");

            // Press 'l' to switch to AsciiMode
            await hiraganaMode.lowerAlphabetInput("l");
            expect(mockEditor.getCurrentInputMode()).toBeInstanceOf(AsciiMode);
            expect(mockEditor.getCurrentInputMode().getContextualName()).toBe("ascii");
            expect(mockEditor.getCurrentText()).toBe("とうきょう");

            // Subsequent typing is verbatim ASCII
            await mockEditor.getCurrentInputMode().lowerAlphabetInput("a");
            await mockEditor.getCurrentInputMode().lowerAlphabetInput("b");
            await mockEditor.getCurrentInputMode().lowerAlphabetInput("c");
            expect(mockEditor.getCurrentText()).toBe("とうきょうabc");
        });

        it("1.2: MidashigoMode (▽とうきょう) で 'q' を押すと見出し語をカタカナ反転確定して KakuteiMode に戻る", async () => {
            await hiraganaMode.upperAlphabetInput("T");
            await hiraganaMode.lowerAlphabetInput("o");
            await hiraganaMode.lowerAlphabetInput("u");
            await hiraganaMode.lowerAlphabetInput("k");
            await hiraganaMode.lowerAlphabetInput("y");
            await hiraganaMode.lowerAlphabetInput("o");
            await hiraganaMode.lowerAlphabetInput("u");
            expect(mockEditor.getCurrentText()).toBe("▽とうきょう");

            // Press 'q'
            await hiraganaMode.lowerAlphabetInput("q");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:kakutei");
            expect(mockEditor.getCurrentText()).toBe("トウキョウ");
        });

        it("1.3: MidashigoMode (▽とうきょう) で 'L' を押すと見出し語を確定して ZeneiMode に遷移する", async () => {
            await hiraganaMode.upperAlphabetInput("T");
            await hiraganaMode.lowerAlphabetInput("o");
            await hiraganaMode.lowerAlphabetInput("u");
            expect(mockEditor.getCurrentText()).toBe("▽とう");

            // Press 'L'
            await hiraganaMode.upperAlphabetInput("L");
            expect(mockEditor.getCurrentInputMode()).toBeInstanceOf(ZeneiMode);
            expect(mockEditor.getCurrentText()).toBe("とう");

            // Subsequent typing is full-width
            await mockEditor.getCurrentInputMode().numberInput("1");
            expect(mockEditor.getCurrentText()).toBe("とう１");
        });

        it("1.4: MidashigoMode (▽とうきょう) で 'Ctrl+j' を押すと見出し語を平仮名のまま確定して KakuteiMode に戻る", async () => {
            await hiraganaMode.upperAlphabetInput("T");
            await hiraganaMode.lowerAlphabetInput("o");
            await hiraganaMode.lowerAlphabetInput("u");
            expect(mockEditor.getCurrentText()).toBe("▽とう");

            // Press Ctrl+j
            await hiraganaMode.ctrlJInput();
            expect(hiraganaMode.getContextualName()).toBe("hiragana:kakutei");
            expect(mockEditor.getCurrentText()).toBe("とう");
        });

        it("1.5: InlineHenkanMode (▼東京) で 'q' を押すと候補を確定してかなモードをトグルする", async () => {
            await mockEditor.getJisyoProvider().registerCandidate("とうきょう", new Candidate("東京"));

            await hiraganaMode.upperAlphabetInput("T");
            await hiraganaMode.lowerAlphabetInput("o");
            await hiraganaMode.lowerAlphabetInput("u");
            await hiraganaMode.lowerAlphabetInput("k");
            await hiraganaMode.lowerAlphabetInput("y");
            await hiraganaMode.lowerAlphabetInput("o");
            await hiraganaMode.lowerAlphabetInput("u");
            await hiraganaMode.spaceInput();
            expect(mockEditor.getCurrentText()).toBe("▼東京");

            // Press 'q'
            await hiraganaMode.lowerAlphabetInput("q");
            expect(mockEditor.getCurrentText()).toBe("東京");
            expect(mockEditor.getCurrentInputMode()).toBeInstanceOf(KatakanaMode);
            expect(mockEditor.getCurrentInputMode().getContextualName()).toBe("katakana:kakutei");
        });

        it("1.6: InlineHenkanMode (▼東京) で 'L' を押すと候補を確定して ZeneiMode に遷移する", async () => {
            await mockEditor.getJisyoProvider().registerCandidate("とうきょう", new Candidate("東京"));

            await hiraganaMode.upperAlphabetInput("T");
            await hiraganaMode.lowerAlphabetInput("o");
            await hiraganaMode.lowerAlphabetInput("u");
            await hiraganaMode.lowerAlphabetInput("k");
            await hiraganaMode.lowerAlphabetInput("y");
            await hiraganaMode.lowerAlphabetInput("o");
            await hiraganaMode.lowerAlphabetInput("u");
            await hiraganaMode.spaceInput();
            expect(mockEditor.getCurrentText()).toBe("▼東京");

            // Press 'L'
            await hiraganaMode.upperAlphabetInput("L");
            expect(mockEditor.getCurrentInputMode()).toBeInstanceOf(ZeneiMode);
            expect(mockEditor.getCurrentText()).toBe("東京");
        });

        it("1.7: InlineHenkanMode (▼東京) で通常文字キーを押すと候補を確定しその文字を入力する", async () => {
            await mockEditor.getJisyoProvider().registerCandidate("とうきょう", new Candidate("東京"));

            await hiraganaMode.upperAlphabetInput("T");
            await hiraganaMode.lowerAlphabetInput("o");
            await hiraganaMode.lowerAlphabetInput("u");
            await hiraganaMode.lowerAlphabetInput("k");
            await hiraganaMode.lowerAlphabetInput("y");
            await hiraganaMode.lowerAlphabetInput("o");
            await hiraganaMode.lowerAlphabetInput("u");
            await hiraganaMode.spaceInput();
            expect(mockEditor.getCurrentText()).toBe("▼東京");

            // Type 'w' -> candidate '東京' fixated, and 'w' starts romaji input 'w'
            await hiraganaMode.lowerAlphabetInput("w");
            expect(mockEditor.getCurrentText()).toBe("東京");
            // Next 'a' completes 'わ'
            await hiraganaMode.lowerAlphabetInput("a");
            expect(mockEditor.getCurrentText()).toBe("東京わ");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:kakutei");
        });
    });

    describe("2. ローマ字未消化バッファと促音・拗音のエッジケース (Pending romaji buffer, gemination, backspace)", () => {
        it("2.1: MidashigoMode で未消化ローマ字がある状態での Backspace は未消化文字のみを消去する", async () => {
            await hiraganaMode.upperAlphabetInput("K");
            await hiraganaMode.lowerAlphabetInput("a");
            expect(mockEditor.getCurrentText()).toBe("▽か");

            // Input incomplete consonant 'k'
            await hiraganaMode.lowerAlphabetInput("k");
            expect(mockEditor.getRemainingRomaji()).toBe("k");
            expect(mockEditor.getCurrentText()).toBe("▽か");

            // 1st Backspace deletes pending 'k'
            await hiraganaMode.backspaceInput();
            expect(mockEditor.getRemainingRomaji()).toBe("");
            expect(mockEditor.getCurrentText()).toBe("▽か");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:midashigo:gokan");

            // 2nd Backspace deletes 'か' -> leaving '▽'
            await hiraganaMode.backspaceInput();
            expect(mockEditor.getCurrentText()).toBe("▽");

            // 3rd Backspace deletes '▽' -> returns to KakuteiMode
            await hiraganaMode.backspaceInput();
            expect(mockEditor.getCurrentText()).toBe("");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:kakutei");
        });

        it("2.2: MidashigoMode で未消化ローマ字がある状態での Ctrl+g は見出し語全体を破棄して KakuteiMode に戻る", async () => {
            await hiraganaMode.upperAlphabetInput("K");
            await hiraganaMode.lowerAlphabetInput("a");
            await hiraganaMode.lowerAlphabetInput("k"); // pending 'k'
            expect(mockEditor.getRemainingRomaji()).toBe("k");
            expect(mockEditor.getCurrentText()).toBe("▽か");

            // Ctrl+g cancels everything
            await hiraganaMode.ctrlGInput();
            expect(mockEditor.getRemainingRomaji()).toBe("");
            expect(mockEditor.getCurrentText()).toBe("");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:kakutei");
        });

        it("2.3: 'n' (ん) の未消化バッファで Space を押すと 'ん' に変換されてから辞書検索される", async () => {
            await mockEditor.getJisyoProvider().registerCandidate("あん", new Candidate("案"));

            await hiraganaMode.upperAlphabetInput("A");
            expect(mockEditor.getCurrentText()).toBe("▽あ");

            // 'n' remains pending as romaji buffer
            await hiraganaMode.lowerAlphabetInput("n");
            expect(mockEditor.getRemainingRomaji()).toBe("n");
            expect(mockEditor.getCurrentText()).toBe("▽あ");

            // Space triggers conversion: pending 'n' becomes 'ん' -> search 'あん'
            await hiraganaMode.spaceInput();
            expect(hiraganaMode.getContextualName()).toBe("hiragana:inlineHenkan");
            expect(mockEditor.getCurrentText()).toBe("▼案");

            await hiraganaMode.ctrlJInput();
            expect(mockEditor.getCurrentText()).toBe("案");
        });

        it("2.4: 促音を含む語幹の送りあり変換 (K -> e -> x -> t -> u -> S -> i -> 決し)", async () => {
            // Register okuri-ari 'けっs' -> '決' (okuri 'し' -> '決し')
            await mockEditor.getJisyoProvider().registerCandidate("けっs", new Candidate("決"));

            // 'K' 'e' -> 'け'
            await hiraganaMode.upperAlphabetInput("K");
            await hiraganaMode.lowerAlphabetInput("e");
            expect(mockEditor.getCurrentText()).toBe("▽け");

            // 'x' 't' 'u' -> 'っ'
            await hiraganaMode.lowerAlphabetInput("x");
            await hiraganaMode.lowerAlphabetInput("t");
            await hiraganaMode.lowerAlphabetInput("u");
            expect(mockEditor.getCurrentText()).toBe("▽けっ");

            // 'S' starts okurigana with 's'
            await hiraganaMode.upperAlphabetInput("S");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:midashigo:okurigana");

            // 'i' completes okuri 'し' -> triggers lookup for 'けっs'
            await hiraganaMode.lowerAlphabetInput("i");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:inlineHenkan");
            expect(mockEditor.getCurrentText()).toBe("▼決");
            expect(mockEditor.getAppendedSuffix()).toBe("し");

            await hiraganaMode.ctrlJInput();
            expect(mockEditor.getCurrentText()).toBe("決し");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:kakutei");
        });

        it("2.5: 拗音の入力途中 (k -> y -> u) でも見出し語が正しく構築される", async () => {
            await mockEditor.getJisyoProvider().registerCandidate("きゅう", new Candidate("九"));

            await hiraganaMode.upperAlphabetInput("K");
            await hiraganaMode.lowerAlphabetInput("y");
            expect(mockEditor.getRemainingRomaji()).toBe("ky");

            await hiraganaMode.lowerAlphabetInput("u");
            expect(mockEditor.getRemainingRomaji()).toBe("");
            expect(mockEditor.getCurrentText()).toBe("▽きゅ");

            await hiraganaMode.lowerAlphabetInput("u");
            expect(mockEditor.getCurrentText()).toBe("▽きゅう");

            await hiraganaMode.spaceInput();
            expect(mockEditor.getCurrentText()).toBe("▼九");

            await hiraganaMode.ctrlJInput();
            expect(mockEditor.getCurrentText()).toBe("九");
        });
    });

    describe("3. 候補一覧メニュー（MenuHenkanMode）の境界値テスト (MenuHenkanMode pagination & keys)", () => {
        it("3.1: 候補数が 3 個以下の場合は MenuHenkanMode に遷移せずインラインで循環する", async () => {
            const provider = mockEditor.getJisyoProvider();
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
            expect(mockEditor.getCurrentText()).toBe("▼候補1");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:inlineHenkan");

            // 2nd candidate
            await hiraganaMode.spaceInput();
            expect(mockEditor.getCurrentText()).toBe("▼候補2");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:inlineHenkan");

            // Space again past end -> triggers registration editor because candidateIndex+1 >= 2
            await hiraganaMode.spaceInput();
            expect(mockEditor.wasRegistrationEditorOpened()).toBe(true);
        });

        it("3.2: 多数の候補がある場合、複数ページを Space で順送り、'x' で逆送りできる", async () => {
            const provider = mockEditor.getJisyoProvider();
            // Register 15 candidates: C01 .. C15
            for (let i = 15; i >= 1; i--) {
                const num = i < 10 ? `0${i}` : `${i}`;
                await provider.registerCandidate("てすと", new Candidate(`C${num}`));
            }

            await hiraganaMode.upperAlphabetInput("T");
            await hiraganaMode.lowerAlphabetInput("e");
            await hiraganaMode.lowerAlphabetInput("s");
            await hiraganaMode.lowerAlphabetInput("u");
            await hiraganaMode.lowerAlphabetInput("t");
            await hiraganaMode.lowerAlphabetInput("o");

            // Candidates 1, 2, 3 (inline)
            await hiraganaMode.spaceInput(); // C01
            expect(mockEditor.getCurrentText()).toBe("▼C01");
            await hiraganaMode.spaceInput(); // C02
            expect(mockEditor.getCurrentText()).toBe("▼C02");
            await hiraganaMode.spaceInput(); // C03
            expect(mockEditor.getCurrentText()).toBe("▼C03");

            // 4th Space enters MenuHenkanMode (page 1: candidates C04 .. C10, total 7 candidates)
            await hiraganaMode.spaceInput();
            expect(hiraganaMode.getContextualName()).toBe("hiragana:menuHenkan");
            const page1List = mockEditor.getCandidateList();
            expect(page1List.candidates.length).toBe(7);
            expect(page1List.candidates[0]?.word).toBe("C04");
            expect(page1List.candidates[6]?.word).toBe("C10");
            expect(page1List.selectionKeys).toEqual(["A", "S", "D", "F", "J", "K", "L"]);

            // Space advances to page 2 (candidates C11 .. C15, total 5 candidates)
            await hiraganaMode.spaceInput();
            expect(hiraganaMode.getContextualName()).toBe("hiragana:menuHenkan");
            const page2List = mockEditor.getCandidateList();
            expect(page2List.candidates.length).toBe(5);
            expect(page2List.candidates[0]?.word).toBe("C11");
            expect(page2List.candidates[4]?.word).toBe("C15");

            // 'x' scrolls back to page 1
            await hiraganaMode.lowerAlphabetInput("x");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:menuHenkan");
            const backToPage1 = mockEditor.getCandidateList();
            expect(backToPage1.candidates[0]?.word).toBe("C04");

            // 'x' again scrolls back below start -> returns to InlineHenkanMode!
            await hiraganaMode.lowerAlphabetInput("x");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:inlineHenkan");
            expect(mockEditor.getCurrentText()).toBe("▼C03");
        });

        it("3.3: MenuHenkanMode での大文字キー選択 (e.g. 'A') で直接確定できる", async () => {
            const provider = mockEditor.getJisyoProvider();
            for (let i = 5; i >= 1; i--) {
                await provider.registerCandidate("てすと", new Candidate(`候補${i}`));
            }

            await hiraganaMode.upperAlphabetInput("T");
            await hiraganaMode.lowerAlphabetInput("e");
            await hiraganaMode.lowerAlphabetInput("s");
            await hiraganaMode.lowerAlphabetInput("u");
            await hiraganaMode.lowerAlphabetInput("t");
            await hiraganaMode.lowerAlphabetInput("o");

            await hiraganaMode.spaceInput(); // 候補1
            await hiraganaMode.spaceInput(); // 候補2
            await hiraganaMode.spaceInput(); // 候補3
            await hiraganaMode.spaceInput(); // MenuHenkanMode: [A] 候補4, [S] 候補5
            expect(hiraganaMode.getContextualName()).toBe("hiragana:menuHenkan");

            // Select with uppercase 'A'
            await hiraganaMode.upperAlphabetInput("A");
            expect(mockEditor.getCurrentText()).toBe("候補4");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:kakutei");
        });

        it("3.4: MenuHenkanMode で Ctrl+g を押すと候補メニューを閉じて MidashigoMode に復帰する", async () => {
            const provider = mockEditor.getJisyoProvider();
            for (let i = 4; i >= 1; i--) {
                await provider.registerCandidate("てすと", new Candidate(`候補${i}`));
            }

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

            // Ctrl+g returns to MidashigoMode
            await hiraganaMode.ctrlGInput();
            expect(hiraganaMode.getContextualName()).toBe("hiragana:midashigo:gokan");
            expect(mockEditor.getCurrentText()).toBe("▽てすと");
        });

        it("3.5: MenuHenkanMode で '.' を押すと即座に辞書登録モードを起動する", async () => {
            const provider = mockEditor.getJisyoProvider();
            for (let i = 4; i >= 1; i--) {
                await provider.registerCandidate("てすと", new Candidate(`候補${i}`));
            }

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

            // '.' opens registration editor
            await hiraganaMode.symbolInput(".");
            expect(mockEditor.wasRegistrationEditorOpened()).toBe(true);
        });
    });

    describe("4. 複雑な送り仮名・活用語・接頭辞/接尾辞の組み合わせ (Okuri, conjugations, prefixes/suffixes)", () => {
        it("4.1: 同一語幹に対する異なる送り仮名（五段活用）の連続変換が正しく動作する", async () => {
            const provider = mockEditor.getJisyoProvider();
            // 'かk' -> '書' (送り 'く', 'き', 'け')
            await provider.registerCandidate("かk", new Candidate("書"));

            // 1. 書く (KaK-u)
            await hiraganaMode.upperAlphabetInput("K");
            await hiraganaMode.lowerAlphabetInput("a");
            await hiraganaMode.upperAlphabetInput("K");
            await hiraganaMode.lowerAlphabetInput("u");
            expect(mockEditor.getCurrentText()).toBe("▼書");
            expect(mockEditor.getAppendedSuffix()).toBe("く");
            await hiraganaMode.ctrlJInput();
            expect(mockEditor.getCurrentText()).toBe("書く");

            // 2. 書き (KaK-i)
            await hiraganaMode.upperAlphabetInput("K");
            await hiraganaMode.lowerAlphabetInput("a");
            await hiraganaMode.upperAlphabetInput("K");
            await hiraganaMode.lowerAlphabetInput("i");
            expect(mockEditor.getCurrentText()).toBe("書く▼書");
            expect(mockEditor.getAppendedSuffix()).toBe("き");
            await hiraganaMode.ctrlJInput();
            expect(mockEditor.getCurrentText()).toBe("書く書き");

            // 3. 書け (KaK-e)
            await hiraganaMode.upperAlphabetInput("K");
            await hiraganaMode.lowerAlphabetInput("a");
            await hiraganaMode.upperAlphabetInput("K");
            await hiraganaMode.lowerAlphabetInput("e");
            expect(mockEditor.getCurrentText()).toBe("書く書き▼書");
            expect(mockEditor.getAppendedSuffix()).toBe("け");
            await hiraganaMode.ctrlJInput();
            expect(mockEditor.getCurrentText()).toBe("書く書き書け");
        });

        it("4.2: 接頭辞 (>) と 接尾辞 (>) の連続変換が正しく動作する", async () => {
            const provider = mockEditor.getJisyoProvider();
            await provider.registerCandidate("だい>", new Candidate("第"));
            await provider.registerCandidate(">ごう", new Candidate("号"));

            // 1. 接頭辞: Dai> -> 第
            await hiraganaMode.upperAlphabetInput("D");
            await hiraganaMode.lowerAlphabetInput("a");
            await hiraganaMode.lowerAlphabetInput("i");
            await hiraganaMode.symbolInput(">");
            expect(mockEditor.getCurrentText()).toBe("▼第");

            // 2. 接尾辞: 候補選択中に '>' を押すと '第' を確定して即座に接尾辞 midashigo (▽>) を開始
            await hiraganaMode.symbolInput(">");
            expect(mockEditor.getCurrentText()).toBe("第▽>");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:midashigo:gokan");

            // Type 'gou'
            await hiraganaMode.lowerAlphabetInput("g");
            await hiraganaMode.lowerAlphabetInput("o");
            await hiraganaMode.lowerAlphabetInput("u");
            expect(mockEditor.getCurrentText()).toBe("第▽>ごう");

            // Space converts suffix '>ごう' -> ▼号
            await hiraganaMode.spaceInput();
            expect(mockEditor.getCurrentText()).toBe("第▼号");
            expect(hiraganaMode.getContextualName()).toBe("hiragana:inlineHenkan");

            // Fixate
            await hiraganaMode.ctrlJInput();
            expect(mockEditor.getCurrentText()).toBe("第号");
        });

        it("4.3: カタカナモードからの送りあり変換でも見出し語キーが正しく平仮名正規化される", async () => {
            const provider = mockEditor.getJisyoProvider();
            await provider.registerCandidate("はなs", new Candidate("話"));

            const katakanaMode = KatakanaMode.getInstance(mockEditor);
            mockEditor.setInputMode(katakanaMode);

            // In Katakana mode, type 'HaNaS-u' (話す)
            await katakanaMode.upperAlphabetInput("H");
            await katakanaMode.lowerAlphabetInput("a");
            await katakanaMode.lowerAlphabetInput("n");
            await katakanaMode.lowerAlphabetInput("a");
            expect(mockEditor.getCurrentText()).toBe("▽ハナ");

            await katakanaMode.upperAlphabetInput("S");
            await katakanaMode.lowerAlphabetInput("u"); // okuri 'ス'
            expect(mockEditor.getCurrentText()).toBe("▼話");
            expect(mockEditor.getAppendedSuffix()).toBe("ス");

            await katakanaMode.ctrlJInput();
            expect(mockEditor.getCurrentText()).toBe("話ス");
            expect(mockEditor.getCurrentInputMode()).toBeInstanceOf(KatakanaMode);
        });
    });
});
