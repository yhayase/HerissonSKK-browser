import { describe, expect, it } from "vitest";
import {
    JsonJisyoParseError,
    iterateJsonJisyoEntries,
    parseJsonJisyo,
} from "../../src/core/skk/jisyo/JsonJisyoParser";

function dictionary(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        version: "0.0.0",
        copyright: "Copyright example",
        license: "Example license",
        okuri_ari: {},
        okuri_nasi: {},
        ...overrides,
    });
}

describe("JsonJisyoParser", () => {
    describe("parseJsonJisyo", () => {
        it("公式 S/L 辞書と同じ構造を解析し、追加プロパティも保持する", () => {
            const parsed = parseJsonJisyo(
                dictionary({
                    description: "Small size dictionary for SKK system",
                    okuri_ari: { "わたr": ["渡", "亘", "亙", "渉"] },
                    okuri_nasi: { greek: ["α", "β", "γ"], io: ["イオ", "Ｉ／Ｏ", "I/O"] },
                }),
            );

            expect(parsed.version).toBe("0.0.0");
            expect(parsed.description).toBe("Small size dictionary for SKK system");
            expect(parsed.okuri_ari["わたr"]).toEqual(["渡", "亘", "亙", "渉"]);
            expect(parsed.okuri_nasi.io).toEqual(["イオ", "Ｉ／Ｏ", "I/O"]);
        });

        it("スキーマ上で任意の version を省略できる", () => {
            const parsed = parseJsonJisyo(
                JSON.stringify({
                    copyright: "Copyright example",
                    license: "Example license",
                    okuri_ari: {},
                    okuri_nasi: {},
                }),
            );

            expect(parsed.version).toBeUndefined();
        });

        it.each(["copyright", "license", "okuri_ari", "okuri_nasi"])(
            "必須プロパティ %s がない入力を拒否する",
            (missingProperty) => {
                const value = JSON.parse(dictionary()) as Record<string, unknown>;
                delete value[missingProperty];

                expect(() => parseJsonJisyo(JSON.stringify(value))).toThrow(JsonJisyoParseError);
                expect(() => parseJsonJisyo(JSON.stringify(value))).toThrow(`$.${missingProperty}`);
            },
        );

        it.each<[string, unknown]>([
            ["copyright", 1],
            ["license", null],
            ["version", 0],
            ["okuri_ari", []],
            ["okuri_nasi", "辞書"],
        ])("プロパティ %s の不正な型を拒否する", (property, invalidValue) => {
            expect(() => parseJsonJisyo(dictionary({ [property]: invalidValue }))).toThrow(JsonJisyoParseError);
            expect(() => parseJsonJisyo(dictionary({ [property]: invalidValue }))).toThrow(`$.${property}`);
        });

        it("候補リストと候補要素の不正な型を入力全体の解析時に拒否する", () => {
            expect(() => parseJsonJisyo(dictionary({ okuri_ari: { "かk": "書" } }))).toThrow(
                '$.okuri_ari["かk"]',
            );
            expect(() => parseJsonJisyo(dictionary({ okuri_nasi: { てすと: ["試験", 2] } }))).toThrow(
                '$.okuri_nasi["てすと"][1]',
            );
        });

        it.each(["", "null", "[]", "{", "\uFEFF" + dictionary()])("辞書ではない入力または不正な JSON を拒否する", (source) => {
            expect(() => parseJsonJisyo(source)).toThrow(JsonJisyoParseError);
        });

        it("同一オブジェクト内の重複キーを Unicode エスケープ表記も含めて拒否する", () => {
            const duplicateTopLevel =
                '{"copyright":"a","copyright":"b","license":"l","okuri_ari":{},"okuri_nasi":{}}';
            const duplicateEntry =
                '{"copyright":"a","license":"l","okuri_ari":{},"okuri_nasi":{"a":["一"],"\\u0061":["二"]}}';

            expect(() => parseJsonJisyo(duplicateTopLevel)).toThrow('キー "copyright" が重複');
            expect(() => parseJsonJisyo(duplicateEntry)).toThrow('キー "a" が重複');
        });
    });

    describe("iterateJsonJisyoEntries", () => {
        it("セクション、エントリー順、候補順、重複候補を保って既存モデルへ変換する", () => {
            const parsed = parseJsonJisyo(
                dictionary({
                    okuri_ari: { "かk": ["書", "描", "書"], "いk": ["行"] },
                    okuri_nasi: { かく: ["核"] },
                }),
            );

            const entries = Array.from(iterateJsonJisyoEntries(parsed));

            expect(entries.map(({ section, key }) => [section, key])).toEqual([
                ["okuri_ari", "かk"],
                ["okuri_ari", "いk"],
                ["okuri_nasi", "かく"],
            ]);
            expect(entries[0]?.candidates.map(({ word }) => word)).toEqual(["書", "描", "書"]);
            expect(entries[0]?.candidates.every(({ annotation }) => annotation === undefined)).toBe(true);
        });

        it("JSON で復号済みの特殊文字や concat 風文字列を単語としてそのまま保持する", () => {
            const words = ["I/O", "foo;注釈ではない", "\\LaTeX", '(concat "DOS\\057V")', "𠮷野家🍚"];
            const parsed = parseJsonJisyo(dictionary({ okuri_nasi: { special: words } }));

            const [entry] = Array.from(iterateJsonJisyoEntries(parsed, "okuri_nasi"));

            expect(entry?.candidates.map(({ word }) => word)).toEqual(words);
            expect(entry?.candidates.every(({ annotation }) => annotation === undefined)).toBe(true);
        });

        it("両セクションに同じキーがあっても区別して列挙する", () => {
            const parsed = parseJsonJisyo(
                dictionary({
                    okuri_ari: { collision: ["送りあり"] },
                    okuri_nasi: { collision: ["送りなし"] },
                }),
            );

            const entries = Array.from(iterateJsonJisyoEntries(parsed));

            expect(entries).toHaveLength(2);
            expect(entries.map(({ section }) => section)).toEqual(["okuri_ari", "okuri_nasi"]);
            expect(entries.map(({ candidates }) => candidates[0]?.word)).toEqual(["送りあり", "送りなし"]);
        });

        it("スキーマが許す空のキー、空の候補、空の候補リストを保持する", () => {
            const parsed = parseJsonJisyo(dictionary({ okuri_nasi: { "": [""], empty: [] } }));

            const entries = Array.from(iterateJsonJisyoEntries(parsed, "okuri_nasi"));

            expect(entries[0]?.key).toBe("");
            expect(entries[0]?.candidates[0]?.word).toBe("");
            expect(entries[1]?.candidates).toEqual([]);
        });
    });
});
