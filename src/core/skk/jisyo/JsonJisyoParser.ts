import { Candidate } from "./candidate";
import type { JisyoEntry } from "./JisyoParser";

export const JSON_JISYO_SECTIONS = ["okuri_ari", "okuri_nasi"] as const;

export type JsonJisyoSection = (typeof JSON_JISYO_SECTIONS)[number];

/**
 * jisyo.schema.v0.0.0.json に準拠する辞書です。
 * `version` はスキーマ上では任意で、未定義の追加プロパティも許可されます。
 */
export interface JsonJisyoDocument {
    copyright: string;
    license: string;
    version?: string;
    okuri_ari: Record<string, string[]>;
    okuri_nasi: Record<string, string[]>;
    [key: string]: unknown;
}

/**
 * 送り有無を保持した、既存の辞書エントリー互換の表現です。
 */
export interface JsonJisyoEntry extends JisyoEntry {
    section: JsonJisyoSection;
}

export class JsonJisyoParseError extends Error {
    readonly path: string;

    constructor(message: string, path = "$") {
        super(`${path}: ${message}`);
        this.name = "JsonJisyoParseError";
        this.path = path;
    }
}

type ObjectFrame = {
    kind: "object";
    state: "key-or-end" | "colon" | "value" | "comma-or-end";
    keys: Set<string>;
};

type ArrayFrame = {
    kind: "array";
    state: "value-or-end" | "comma-or-end";
};

type ScanFrame = ObjectFrame | ArrayFrame;

function isWhitespace(char: string | undefined): boolean {
    return char === " " || char === "\n" || char === "\r" || char === "\t";
}

/**
 * JSON.parse が上書きしてしまうオブジェクト内の重複キーを事前に検出します。
 * 構文自体は先に JSON.parse で検証済みなので、ここでは構造トークンのみを追跡します。
 */
function assertNoDuplicateObjectKeys(source: string): void {
    let index = 0;
    let rootConsumed = false;
    const stack: ScanFrame[] = [];

    const skipWhitespace = (): void => {
        while (isWhitespace(source[index])) {
            index += 1;
        }
    };

    const readString = (): string => {
        const start = index;
        index += 1;
        while (index < source.length) {
            const char = source[index];
            if (char === "\\") {
                index += 2;
            } else if (char === '"') {
                index += 1;
                return JSON.parse(source.slice(start, index)) as string;
            } else {
                index += 1;
            }
        }
        throw new JsonJisyoParseError("JSON 文字列が閉じられていません。");
    };

    const markValueConsumed = (): void => {
        const parent = stack.at(-1);
        if (!parent) {
            rootConsumed = true;
        } else {
            parent.state = "comma-or-end";
        }
    };

    const consumeValue = (): void => {
        markValueConsumed();
        const char = source[index];
        if (char === "{") {
            index += 1;
            stack.push({ kind: "object", state: "key-or-end", keys: new Set() });
        } else if (char === "[") {
            index += 1;
            stack.push({ kind: "array", state: "value-or-end" });
        } else if (char === '"') {
            readString();
        } else {
            while (index < source.length) {
                const scalarChar = source[index];
                if (isWhitespace(scalarChar) || scalarChar === "," || scalarChar === "]" || scalarChar === "}") {
                    break;
                }
                index += 1;
            }
        }
    };

    while (true) {
        skipWhitespace();
        const frame = stack.at(-1);

        if (!frame) {
            if (rootConsumed) {
                return;
            }
            consumeValue();
            continue;
        }

        if (frame.kind === "object") {
            if (frame.state === "key-or-end") {
                if (source[index] === "}") {
                    index += 1;
                    stack.pop();
                    continue;
                }
                const key = readString();
                if (frame.keys.has(key)) {
                    throw new JsonJisyoParseError(`オブジェクトのキー ${JSON.stringify(key)} が重複しています。`);
                }
                frame.keys.add(key);
                frame.state = "colon";
            } else if (frame.state === "colon") {
                index += 1;
                frame.state = "value";
            } else if (frame.state === "value") {
                consumeValue();
            } else if (source[index] === ",") {
                index += 1;
                frame.state = "key-or-end";
            } else {
                index += 1;
                stack.pop();
            }
            continue;
        }

        if (frame.state === "value-or-end") {
            if (source[index] === "]") {
                index += 1;
                stack.pop();
            } else {
                consumeValue();
            }
        } else if (source[index] === ",") {
            index += 1;
            frame.state = "value-or-end";
        } else {
            index += 1;
            stack.pop();
        }
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function assertStringProperty(document: Record<string, unknown>, key: string, required: boolean): void {
    if (!hasOwn(document, key)) {
        if (required) {
            throw new JsonJisyoParseError("必須プロパティがありません。", `$.${key}`);
        }
        return;
    }
    if (typeof document[key] !== "string") {
        throw new JsonJisyoParseError("文字列である必要があります。", `$.${key}`);
    }
}

function assertSection(document: Record<string, unknown>, section: JsonJisyoSection): void {
    if (!hasOwn(document, section)) {
        throw new JsonJisyoParseError("必須プロパティがありません。", `$.${section}`);
    }

    const value = document[section];
    if (!isObject(value)) {
        throw new JsonJisyoParseError("オブジェクトである必要があります。", `$.${section}`);
    }

    for (const [key, candidates] of Object.entries(value)) {
        const entryPath = `$.${section}[${JSON.stringify(key)}]`;
        if (!Array.isArray(candidates)) {
            throw new JsonJisyoParseError("候補の配列である必要があります。", entryPath);
        }
        for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
            if (typeof candidates[candidateIndex] !== "string") {
                throw new JsonJisyoParseError("候補は文字列である必要があります。", `${entryPath}[${candidateIndex}]`);
            }
        }
    }
}

/**
 * JSON 辞書全体を解析し、スキーマの必須項目と型を検証します。
 * 不正な入力では部分的な結果を返さず JsonJisyoParseError を送出します。
 */
export function parseJsonJisyo(source: string): JsonJisyoDocument {
    let parsed: unknown;
    try {
        parsed = JSON.parse(source) as unknown;
    } catch {
        throw new JsonJisyoParseError("有効な JSON ではありません。");
    }

    assertNoDuplicateObjectKeys(source);

    if (!isObject(parsed)) {
        throw new JsonJisyoParseError("辞書のルートはオブジェクトである必要があります。");
    }

    assertStringProperty(parsed, "copyright", true);
    assertStringProperty(parsed, "license", true);
    assertStringProperty(parsed, "version", false);
    for (const section of JSON_JISYO_SECTIONS) {
        assertSection(parsed, section);
    }

    return parsed as JsonJisyoDocument;
}

/**
 * 解析済み JSON 辞書を、Map を追加生成せず既存モデルへ順次変換します。
 * セクションを省略した場合は送りあり、送りなしの順に列挙します。
 * JSON の候補文字列は変換済みの単語なので、SKK テキスト形式として再解釈しません。
 */
export function* iterateJsonJisyoEntries(
    document: JsonJisyoDocument,
    section?: JsonJisyoSection,
): Generator<JsonJisyoEntry> {
    const sections: readonly JsonJisyoSection[] = section ? [section] : JSON_JISYO_SECTIONS;
    for (const currentSection of sections) {
        for (const [key, words] of Object.entries(document[currentSection])) {
            yield {
                section: currentSection,
                key,
                candidates: words.map((word) => new Candidate(word)),
            };
        }
    }
}
