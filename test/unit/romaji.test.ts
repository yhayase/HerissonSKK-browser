import { describe, it, expect, beforeEach } from 'vitest';
import { RomajiInput } from '../../src/core/romaji/RomajiInput';
import { lookupOkuriAlphabet } from '../../src/core/skk/jisyo/okuri';
import { Candidate } from '../../src/core/skk/jisyo/candidate';
import { Entry } from '../../src/core/skk/jisyo/entry';

function typeString(romajiInput: RomajiInput, input: string): string {
    let result = '';
    for (const char of input) {
        result += romajiInput.processInput(char);
    }
    return result;
}

describe('RomajiInput', () => {
    let romajiInput: RomajiInput;

    beforeEach(() => {
        romajiInput = new RomajiInput();
    });

    describe('Hiragana conversion', () => {
        it('converts basic vowels (a, i, u, e, o)', () => {
            expect(typeString(romajiInput, 'a')).toBe('あ');
            expect(typeString(romajiInput, 'i')).toBe('い');
            expect(typeString(romajiInput, 'u')).toBe('う');
            expect(typeString(romajiInput, 'e')).toBe('え');
            expect(typeString(romajiInput, 'o')).toBe('お');
            expect(romajiInput.getRemainingRomaji()).toBe('');
        });

        it('converts basic consonant rows (ka, sa, ta, na, ha, ma, ya, ra, wa)', () => {
            expect(typeString(romajiInput, 'ka')).toBe('か');
            expect(typeString(romajiInput, 'ki')).toBe('き');
            expect(typeString(romajiInput, 'ku')).toBe('く');
            expect(typeString(romajiInput, 'ke')).toBe('け');
            expect(typeString(romajiInput, 'ko')).toBe('こ');

            expect(typeString(romajiInput, 'sa')).toBe('さ');
            expect(typeString(romajiInput, 'si')).toBe('し');
            expect(typeString(romajiInput, 'shi')).toBe('し');
            expect(typeString(romajiInput, 'su')).toBe('す');
            expect(typeString(romajiInput, 'se')).toBe('せ');
            expect(typeString(romajiInput, 'so')).toBe('そ');

            expect(typeString(romajiInput, 'ta')).toBe('た');
            expect(typeString(romajiInput, 'ti')).toBe('ち');
            expect(typeString(romajiInput, 'chi')).toBe('ち');
            expect(typeString(romajiInput, 'tu')).toBe('つ');
            expect(typeString(romajiInput, 'tsu')).toBe('つ');
            expect(typeString(romajiInput, 'te')).toBe('て');
            expect(typeString(romajiInput, 'to')).toBe('と');

            expect(typeString(romajiInput, 'na')).toBe('な');
            expect(typeString(romajiInput, 'ni')).toBe('に');
            expect(typeString(romajiInput, 'nu')).toBe('ぬ');
            expect(typeString(romajiInput, 'ne')).toBe('ね');
            expect(typeString(romajiInput, 'no')).toBe('の');

            expect(typeString(romajiInput, 'ha')).toBe('は');
            expect(typeString(romajiInput, 'hi')).toBe('ひ');
            expect(typeString(romajiInput, 'hu')).toBe('ふ');
            expect(typeString(romajiInput, 'fu')).toBe('ふ');
            expect(typeString(romajiInput, 'he')).toBe('へ');
            expect(typeString(romajiInput, 'ho')).toBe('ほ');

            expect(typeString(romajiInput, 'ma')).toBe('ま');
            expect(typeString(romajiInput, 'mi')).toBe('み');
            expect(typeString(romajiInput, 'mu')).toBe('む');
            expect(typeString(romajiInput, 'me')).toBe('め');
            expect(typeString(romajiInput, 'mo')).toBe('も');

            expect(typeString(romajiInput, 'ya')).toBe('や');
            expect(typeString(romajiInput, 'yu')).toBe('ゆ');
            expect(typeString(romajiInput, 'yo')).toBe('よ');

            expect(typeString(romajiInput, 'ra')).toBe('ら');
            expect(typeString(romajiInput, 'ri')).toBe('り');
            expect(typeString(romajiInput, 'ru')).toBe('る');
            expect(typeString(romajiInput, 're')).toBe('れ');
            expect(typeString(romajiInput, 'ro')).toBe('ろ');

            expect(typeString(romajiInput, 'wa')).toBe('わ');
            expect(typeString(romajiInput, 'wo')).toBe('を');
        });

        it('converts voiced and semi-voiced consonant rows (ga, za, da, ba, pa)', () => {
            expect(typeString(romajiInput, 'ga')).toBe('が');
            expect(typeString(romajiInput, 'gi')).toBe('ぎ');
            expect(typeString(romajiInput, 'gu')).toBe('ぐ');
            expect(typeString(romajiInput, 'ge')).toBe('げ');
            expect(typeString(romajiInput, 'go')).toBe('ご');

            expect(typeString(romajiInput, 'za')).toBe('ざ');
            expect(typeString(romajiInput, 'zi')).toBe('じ');
            expect(typeString(romajiInput, 'ji')).toBe('じ');
            expect(typeString(romajiInput, 'zu')).toBe('ず');
            expect(typeString(romajiInput, 'ze')).toBe('ぜ');
            expect(typeString(romajiInput, 'zo')).toBe('ぞ');

            expect(typeString(romajiInput, 'da')).toBe('だ');
            expect(typeString(romajiInput, 'di')).toBe('ぢ');
            expect(typeString(romajiInput, 'du')).toBe('づ');
            expect(typeString(romajiInput, 'de')).toBe('で');
            expect(typeString(romajiInput, 'do')).toBe('ど');

            expect(typeString(romajiInput, 'ba')).toBe('ば');
            expect(typeString(romajiInput, 'bi')).toBe('び');
            expect(typeString(romajiInput, 'bu')).toBe('ぶ');
            expect(typeString(romajiInput, 'be')).toBe('べ');
            expect(typeString(romajiInput, 'bo')).toBe('ぼ');

            expect(typeString(romajiInput, 'pa')).toBe('ぱ');
            expect(typeString(romajiInput, 'pi')).toBe('ぴ');
            expect(typeString(romajiInput, 'pu')).toBe('ぷ');
            expect(typeString(romajiInput, 'pe')).toBe('ぺ');
            expect(typeString(romajiInput, 'po')).toBe('ぽ');
        });

        it('converts contracted sounds (kya, sha, cha, nya, etc.)', () => {
            expect(typeString(romajiInput, 'kya')).toBe('きゃ');
            expect(typeString(romajiInput, 'kyu')).toBe('きゅ');
            expect(typeString(romajiInput, 'kyo')).toBe('きょ');

            expect(typeString(romajiInput, 'sha')).toBe('しゃ');
            expect(typeString(romajiInput, 'shu')).toBe('しゅ');
            expect(typeString(romajiInput, 'sho')).toBe('しょ');

            expect(typeString(romajiInput, 'cha')).toBe('ちゃ');
            expect(typeString(romajiInput, 'chu')).toBe('ちゅ');
            expect(typeString(romajiInput, 'cho')).toBe('ちょ');

            expect(typeString(romajiInput, 'nya')).toBe('にゃ');
            expect(typeString(romajiInput, 'nyu')).toBe('にゅ');
            expect(typeString(romajiInput, 'nyo')).toBe('にょ');

            expect(typeString(romajiInput, 'hya')).toBe('ひゃ');
            expect(typeString(romajiInput, 'hyu')).toBe('ひゅ');
            expect(typeString(romajiInput, 'hyo')).toBe('ひょ');

            expect(typeString(romajiInput, 'mya')).toBe('みゃ');
            expect(typeString(romajiInput, 'myu')).toBe('みゅ');
            expect(typeString(romajiInput, 'myo')).toBe('みょ');

            expect(typeString(romajiInput, 'rya')).toBe('りゃ');
            expect(typeString(romajiInput, 'ryu')).toBe('りゅ');
            expect(typeString(romajiInput, 'ryo')).toBe('りょ');

            expect(typeString(romajiInput, 'gya')).toBe('ぎゃ');
            expect(typeString(romajiInput, 'gyu')).toBe('ぎゅ');
            expect(typeString(romajiInput, 'gyo')).toBe('ぎょ');

            expect(typeString(romajiInput, 'ja')).toBe('じゃ');
            expect(typeString(romajiInput, 'ju')).toBe('じゅ');
            expect(typeString(romajiInput, 'jo')).toBe('じょ');

            expect(typeString(romajiInput, 'bya')).toBe('びゃ');
            expect(typeString(romajiInput, 'byu')).toBe('びゅ');
            expect(typeString(romajiInput, 'byo')).toBe('びょ');

            expect(typeString(romajiInput, 'pya')).toBe('ぴゃ');
            expect(typeString(romajiInput, 'pyu')).toBe('ぴゅ');
            expect(typeString(romajiInput, 'pyo')).toBe('ぴょ');
        });

        it('converts small kana and symbols', () => {
            expect(typeString(romajiInput, 'xa')).toBe('ぁ');
            expect(typeString(romajiInput, 'xi')).toBe('ぃ');
            expect(typeString(romajiInput, 'xu')).toBe('ぅ');
            expect(typeString(romajiInput, 'xe')).toBe('ぇ');
            expect(typeString(romajiInput, 'xo')).toBe('ぉ');
            expect(typeString(romajiInput, 'xtsu')).toBe('っ');

            expect(typeString(romajiInput, '-')).toBe('ー');
            expect(typeString(romajiInput, ',')).toBe('、');
            expect(typeString(romajiInput, '.')).toBe('。');
            expect(typeString(romajiInput, '[')).toBe('「');
            expect(typeString(romajiInput, ']')).toBe('」');
            expect(typeString(romajiInput, '?')).toBe('？');
            expect(typeString(romajiInput, '!')).toBe('！');
        });

        it('converts z-prefix special symbols', () => {
            expect(typeString(romajiInput, 'z ')).toBe('　');
            expect(typeString(romajiInput, 'z/')).toBe('・');
            expect(typeString(romajiInput, 'z-')).toBe('〜');
            expect(typeString(romajiInput, 'z.')).toBe('…');
            expect(typeString(romajiInput, 'zh')).toBe('←');
            expect(typeString(romajiInput, 'zj')).toBe('↓');
            expect(typeString(romajiInput, 'zk')).toBe('↑');
            expect(typeString(romajiInput, 'zl')).toBe('→');
        });
    });

    describe('Katakana conversion', () => {
        let kataInput: RomajiInput;

        beforeEach(() => {
            kataInput = new RomajiInput(true);
        });

        it('converts basic vowels to katakana', () => {
            expect(typeString(kataInput, 'a')).toBe('ア');
            expect(typeString(kataInput, 'i')).toBe('イ');
            expect(typeString(kataInput, 'u')).toBe('ウ');
            expect(typeString(kataInput, 'e')).toBe('エ');
            expect(typeString(kataInput, 'o')).toBe('オ');
        });

        it('converts consonants to katakana', () => {
            expect(typeString(kataInput, 'ka')).toBe('カ');
            expect(typeString(kataInput, 'sa')).toBe('サ');
            expect(typeString(kataInput, 'ta')).toBe('タ');
            expect(typeString(kataInput, 'na')).toBe('ナ');
            expect(typeString(kataInput, 'ha')).toBe('ハ');
            expect(typeString(kataInput, 'ma')).toBe('マ');
            expect(typeString(kataInput, 'ya')).toBe('ヤ');
            expect(typeString(kataInput, 'ra')).toBe('ラ');
            expect(typeString(kataInput, 'wa')).toBe('ワ');
        });

        it('converts contracted sounds to katakana', () => {
            expect(typeString(kataInput, 'kyo')).toBe('キョ');
            expect(typeString(kataInput, 'shu')).toBe('シュ');
            expect(typeString(kataInput, 'cha')).toBe('チャ');
        });

        it('converts double consonants to katakana sokuon', () => {
            expect(kataInput.processInput('k')).toBe('');
            expect(kataInput.processInput('k')).toBe('ッ');
            expect(kataInput.processInput('a')).toBe('カ');

            expect(typeString(kataInput, 'tta')).toBe('ッタ');
        });

        it('converts katakana string to hiragana via convertKanaToHiragana', () => {
            expect(kataInput.convertKanaToHiragana('カタカナ')).toBe('かたかな');
            expect(kataInput.convertKanaToHiragana('東京テスト')).toBe('東京てすと');

            // In Hiragana mode, returns unchanged
            expect(romajiInput.convertKanaToHiragana('カタカナ')).toBe('カタカナ');
        });
    });

    describe('Double consonants / Sokuon', () => {
        it('converts kka to っか step-by-step', () => {
            expect(romajiInput.processInput('k')).toBe('');
            expect(romajiInput.getRemainingRomaji()).toBe('k');

            expect(romajiInput.processInput('k')).toBe('っ');
            expect(romajiInput.getRemainingRomaji()).toBe('k');

            expect(romajiInput.processInput('a')).toBe('か');
            expect(romajiInput.getRemainingRomaji()).toBe('');
        });

        it('converts tta to った step-by-step', () => {
            expect(romajiInput.processInput('t')).toBe('');
            expect(romajiInput.getRemainingRomaji()).toBe('t');

            expect(romajiInput.processInput('t')).toBe('っ');
            expect(romajiInput.getRemainingRomaji()).toBe('t');

            expect(romajiInput.processInput('a')).toBe('た');
            expect(romajiInput.getRemainingRomaji()).toBe('');
        });

        it('converts other double consonants (ssa, ppa, dda, bba)', () => {
            expect(typeString(romajiInput, 'ssa')).toBe('っさ');
            expect(typeString(romajiInput, 'ppa')).toBe('っぱ');
            expect(typeString(romajiInput, 'dda')).toBe('っだ');
            expect(typeString(romajiInput, 'bba')).toBe('っば');
        });

        it('converts cch sequences to っちゃ', () => {
            expect(romajiInput.processInput('c')).toBe('');
            expect(romajiInput.processInput('c')).toBe('っ');
            expect(romajiInput.getRemainingRomaji()).toBe('c');
            expect(romajiInput.processInput('h')).toBe('');
            expect(romajiInput.getRemainingRomaji()).toBe('ch');
            expect(romajiInput.processInput('a')).toBe('ちゃ');
            expect(romajiInput.getRemainingRomaji()).toBe('');
        });
    });

    describe('Hatsun (ん)', () => {
        it('converts nn to single ん', () => {
            expect(romajiInput.processInput('n')).toBe('');
            expect(romajiInput.getRemainingRomaji()).toBe('n');

            expect(romajiInput.processInput('n')).toBe('ん');
            expect(romajiInput.getRemainingRomaji()).toBe('');
        });

        it('converts n\' to single ん', () => {
            expect(romajiInput.processInput('n')).toBe('');
            expect(romajiInput.getRemainingRomaji()).toBe('n');

            expect(romajiInput.processInput("'")).toBe('ん');
            expect(romajiInput.getRemainingRomaji()).toBe('');
        });

        it('converts n followed by a consonant (e.g. nto -> ん + と, nka -> ん + か)', () => {
            // Test "nto"
            expect(romajiInput.processInput('n')).toBe('');
            expect(romajiInput.getRemainingRomaji()).toBe('n');

            expect(romajiInput.processInput('t')).toBe('ん');
            expect(romajiInput.getRemainingRomaji()).toBe('t');

            expect(romajiInput.processInput('o')).toBe('と');
            expect(romajiInput.getRemainingRomaji()).toBe('');

            // Test "nka"
            expect(typeString(romajiInput, 'nka')).toBe('んか');
            expect(romajiInput.getRemainingRomaji()).toBe('');

            // Test "nsi" -> んし
            expect(typeString(romajiInput, 'nsi')).toBe('んし');
            expect(romajiInput.getRemainingRomaji()).toBe('');
        });

        it('does not prematurely convert n followed by vowel or y', () => {
            // na -> な, not ん + あ
            expect(typeString(romajiInput, 'na')).toBe('な');
            expect(romajiInput.getRemainingRomaji()).toBe('');

            // nya -> にゃ, not ん + や
            expect(typeString(romajiInput, 'nya')).toBe('にゃ');
            expect(romajiInput.getRemainingRomaji()).toBe('');
        });

        it('resolves n to ん using findExactKanaForRomBuffer', () => {
            expect(romajiInput.processInput('n')).toBe('');
            expect(romajiInput.getRemainingRomaji()).toBe('n');
            expect(romajiInput.findExactKanaForRomBuffer()).toBe('ん');
        });
    });

    describe('Remaining romaji tracking and buffer manipulation', () => {
        it('starts in empty state', () => {
            expect(romajiInput.isEmpty()).toBe(true);
            expect(romajiInput.getRemainingRomaji()).toBe('');
        });

        it('tracks partial romaji across single and multiple characters', () => {
            expect(romajiInput.processInput('k')).toBe('');
            expect(romajiInput.isEmpty()).toBe(false);
            expect(romajiInput.getRemainingRomaji()).toBe('k');

            expect(romajiInput.processInput('y')).toBe('');
            expect(romajiInput.getRemainingRomaji()).toBe('ky');

            expect(romajiInput.processInput('u')).toBe('きゅ');
            expect(romajiInput.isEmpty()).toBe(true);
            expect(romajiInput.getRemainingRomaji()).toBe('');
        });

        it('resets buffer when reset() is called', () => {
            romajiInput.processInput('s');
            romajiInput.processInput('h');
            expect(romajiInput.getRemainingRomaji()).toBe('sh');

            romajiInput.reset();
            expect(romajiInput.isEmpty()).toBe(true);
            expect(romajiInput.getRemainingRomaji()).toBe('');
        });

        it('deletes the last character with deleteLastChar()', () => {
            romajiInput.processInput('k');
            romajiInput.processInput('y');
            expect(romajiInput.getRemainingRomaji()).toBe('ky');

            romajiInput.deleteLastChar();
            expect(romajiInput.getRemainingRomaji()).toBe('k');

            romajiInput.deleteLastChar();
            expect(romajiInput.getRemainingRomaji()).toBe('');
            expect(romajiInput.isEmpty()).toBe(true);
        });

        it('discards invalid romaji input (e.g. q)', () => {
            expect(romajiInput.processInput('q')).toBe('');
            expect(romajiInput.isEmpty()).toBe(true);
            expect(romajiInput.getRemainingRomaji()).toBe('');
        });

        it('discards invalid prefix but retains valid suffix (e.g. ste -> て)', () => {
            expect(romajiInput.processInput('s')).toBe('');
            expect(romajiInput.getRemainingRomaji()).toBe('s');

            expect(romajiInput.processInput('t')).toBe('');
            expect(romajiInput.getRemainingRomaji()).toBe('t');

            expect(romajiInput.processInput('e')).toBe('て');
            expect(romajiInput.getRemainingRomaji()).toBe('');
        });
    });

    describe('Okuri-ari romaji handling', () => {
        it('looks up okuri alphabet correctly for various kana', () => {
            // Ka-row -> k
            expect(lookupOkuriAlphabet('か')).toBe('k');
            expect(lookupOkuriAlphabet('く')).toBe('k');
            expect(lookupOkuriAlphabet('け')).toBe('k');

            // Sa-row -> s
            expect(lookupOkuriAlphabet('さ')).toBe('s');
            expect(lookupOkuriAlphabet('し')).toBe('s');
            expect(lookupOkuriAlphabet('す')).toBe('s');

            // Ta-row -> t
            expect(lookupOkuriAlphabet('た')).toBe('t');
            expect(lookupOkuriAlphabet('ち')).toBe('t');
            expect(lookupOkuriAlphabet('つ')).toBe('t');

            // Ra-row -> r
            expect(lookupOkuriAlphabet('ら')).toBe('r');
            expect(lookupOkuriAlphabet('る')).toBe('r');

            // Vowels
            expect(lookupOkuriAlphabet('あ')).toBe('a');
            expect(lookupOkuriAlphabet('い')).toBe('i');
            expect(lookupOkuriAlphabet('う')).toBe('u');
            expect(lookupOkuriAlphabet('え')).toBe('e');
            expect(lookupOkuriAlphabet('お')).toBe('o');

            // Katakana okuri
            expect(lookupOkuriAlphabet('ル')).toBe('r');
            expect(lookupOkuriAlphabet('ク')).toBe('k');
            expect(lookupOkuriAlphabet('ボ')).toBe('b');

            // Empty or invalid input
            expect(lookupOkuriAlphabet('')).toBeUndefined();
            expect(lookupOkuriAlphabet('1')).toBeUndefined();
        });

        it('simulates full okuri-ari flow (stem + uppercase okuri trigger + okuri kana)', () => {
            // Example: typing "KakU" -> stem "か" (from "ka"), okuri "く" (from "k" + "u")
            const stemInput = new RomajiInput();
            const stem = typeString(stemInput, 'ka');
            expect(stem).toBe('か');

            // Okuri entered starting with uppercase 'K'
            const okuriKey = 'K'.toLowerCase();
            const okuriInput = new RomajiInput();
            expect(okuriInput.processInput(okuriKey)).toBe('');
            expect(okuriInput.getRemainingRomaji()).toBe('k');

            const okuriKana = okuriInput.processInput('u');
            expect(okuriKana).toBe('く');
            expect(okuriInput.getRemainingRomaji()).toBe('');

            const okuriAlphabet = lookupOkuriAlphabet(okuriKana);
            expect(okuriAlphabet).toBe('k');

            // SKK dictionary key with okuri: midashigo + okuriAlphabet
            const dictKey = stem + okuriAlphabet;
            expect(dictKey).toBe('かk');

            // Entry cooks candidates by appending okurigana to raw candidate words
            const rawCandidates = [
                new Candidate('書'),
                new Candidate('描'),
                new Candidate('欠'),
            ];
            const entry = new Entry(dictKey, rawCandidates, okuriKana);

            expect(entry.getMidashigo()).toBe('かk');
            expect(entry.getRawCandidateList()).toEqual(rawCandidates);

            const cooked = entry.getCandidateList();
            expect(cooked.length).toBe(3);
            expect(cooked[0]?.word).toBe('書く');
            expect(cooked[1]?.word).toBe('描く');
            expect(cooked[2]?.word).toBe('欠く');
        });

        it('simulates okuri-ari with sokuon in okurigana (e.g. った -> t)', () => {
            // Example: "OmoTtA" -> stem "おも", okuri "った" -> okuriAlphabet "t"
            const stemInput = new RomajiInput();
            const stem = typeString(stemInput, 'omo');
            expect(stem).toBe('おも');

            // Okuri: 'T' + 't' + 'a'
            const okuriInput = new RomajiInput();
            let okuriKana = '';
            okuriKana += okuriInput.processInput('T'.toLowerCase());
            okuriKana += okuriInput.processInput('t');
            okuriKana += okuriInput.processInput('a');
            expect(okuriKana).toBe('った');

            const okuriAlphabet = lookupOkuriAlphabet(okuriKana);
            // 促音に続くかなから送りあり検索用の英字を求めます。
            expect(okuriAlphabet).toBe('t');
            expect(lookupOkuriAlphabet('た')).toBe('t');
        });

        it('creates Entry with empty okuri when okuri-nashi', () => {
            const rawCandidates = [
                new Candidate('日本'),
                new Candidate('にほん'),
            ];
            const entry = new Entry('にほん', rawCandidates, '');
            expect(entry.getMidashigo()).toBe('にほん');
            expect(entry.getCandidateList()).toBe(rawCandidates);
            expect(entry.getCandidateList()[0]?.word).toBe('日本');
        });
    });
});
