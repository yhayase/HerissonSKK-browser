import { iterateJsonJisyoEntries, parseJsonJisyo } from "../../core/skk/jisyo/JsonJisyoParser";
import { parseJisyoText, type JisyoEntry } from "../../core/skk/jisyo/JisyoParser";
import type { Candidate } from "../../core/skk/jisyo/candidate";
import { DEFAULT_STARTER_DICTIONARY_ID } from "../indexedDbSchema";
import { decodeJisyoBuffer, parseJisyoBuffer } from "./JisyoBufferDecoder";
import type { IndexedDbJisyoStore } from "./IndexedDbJisyoStore";

export { decodeJisyoBuffer, parseJisyoBuffer };

export type DictionaryFormat = "auto" | "text" | "json";

export interface DictionaryDefinition {
    dictId: string;
    dictPath: string;
    version: string;
    format?: DictionaryFormat;
}

export interface DictionaryLoadOptions {
    force?: boolean;
    batchSize?: number;
    onProgress?: (dictId: string, importedCount: number) => void;
}

export interface DictionaryLoadResult {
    dictId: string;
    status: "imported" | "current";
    entryCount: number;
}

export interface DictionaryLoaderOptions {
    dictPath?: string;
    dictId?: string;
    version?: string;
    format?: DictionaryFormat;
    force?: boolean;
    batchSize?: number;
    onProgress?: (importedCount: number) => void;
}

export class DictionarySourceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DictionarySourceError";
    }
}

const DEFAULT_DICTIONARY: DictionaryDefinition = {
    dictId: DEFAULT_STARTER_DICTIONARY_ID,
    dictPath: "dict/SKK-JISYO.S",
    version: "1.0.0",
    format: "text",
};

const importSessionId = (() => {
    const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    return `session-${Date.now().toString(36)}-${random}-`;
})();
let generationSequence = 0;

function createGeneration(): string {
    generationSequence += 1;
    return `${importSessionId}${generationSequence.toString(36)}`;
}

function textContainsDataLine(text: string): boolean {
    return text.split(/\r?\n|\r/).some((line) => {
        const trimmed = line.trim();
        return trimmed.length > 0 && !trimmed.startsWith(";;");
    });
}

function mergeEntry(map: Map<string, Candidate[]>, entry: JisyoEntry): void {
    if (entry.candidates.length === 0) return;
    const existing = map.get(entry.key);
    if (!existing) {
        map.set(entry.key, [...entry.candidates]);
        return;
    }
    const seen = new Set(existing.map((candidate) => candidate.word));
    for (const candidate of entry.candidates) {
        if (!seen.has(candidate.word)) {
            seen.add(candidate.word);
            existing.push(candidate);
        }
    }
}

function* iterateEntries(entries: ReadonlyMap<string, Candidate[]>): Generator<JisyoEntry> {
    for (const [key, candidates] of entries) yield { key, candidates };
}

function decodeUtf8Json(buffer: Uint8Array): string {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
        throw new DictionarySourceError("JSON dictionary must be valid UTF-8");
    }
}

function detectFormat(buffer: Uint8Array, definition: DictionaryDefinition): Exclude<DictionaryFormat, "auto"> {
    if (definition.format && definition.format !== "auto") return definition.format;
    if (definition.dictPath.toLowerCase().endsWith(".json")) return "json";
    try {
        if (new TextDecoder("utf-8", { fatal: true }).decode(buffer).trimStart().startsWith("{")) {
            return "json";
        }
    } catch {
        // EUC-JP などのテキスト辞書は後段の既存デコーダーへ渡します。
    }
    return "text";
}

export function parseDictionary(buffer: Uint8Array, definition: DictionaryDefinition): Map<string, Candidate[]> {
    const format = detectFormat(buffer, definition);
    if (format === "json") {
        const document = parseJsonJisyo(decodeUtf8Json(buffer));
        const entries = new Map<string, Candidate[]>();
        for (const entry of iterateJsonJisyoEntries(document)) mergeEntry(entries, entry);
        return entries;
    }

    const text = decodeJisyoBuffer(buffer);
    const entries = parseJisyoText(text);
    if (entries.size === 0 && textContainsDataLine(text)) {
        throw new DictionarySourceError(`Text dictionary "${definition.dictId}" contains no valid entries`);
    }
    return entries;
}

function assertDefinitionsMatchStore(
    store: IndexedDbJisyoStore,
    definitions: readonly DictionaryDefinition[],
): void {
    const ids = definitions.map((definition) => definition.dictId);
    if (new Set(ids).size !== ids.length) throw new Error("Dictionary definitions must have unique dictId values");
    if (ids.length !== store.configuredDictionaryIds.length
        || ids.some((id, index) => id !== store.configuredDictionaryIds[index])) {
        throw new Error("Dictionary definitions must match the store dictionaryIds in the same order");
    }
    for (const definition of definitions) {
        if (!definition.dictId || !definition.dictPath || !definition.version) {
            throw new Error("Dictionary definitions require dictId, dictPath, and version");
        }
    }
}

export class DictionaryLoader {
    public static getDictionaryUrl(dictPath = DEFAULT_DICTIONARY.dictPath): string {
        try {
            const globals = globalThis as typeof globalThis & {
                browser?: { runtime?: { getURL?: (path: string) => string } };
                chrome?: { runtime?: { getURL?: (path: string) => string } };
            };
            if (globals.browser?.runtime?.getURL) return globals.browser.runtime.getURL(dictPath);
            if (globals.chrome?.runtime?.getURL) return globals.chrome.runtime.getURL(dictPath);
        } catch {
            // ランタイムURLを取得できない環境では相対URLを使用します。
        }
        return `/${dictPath}`;
    }

    public static async fetchDictionaryBuffer(
        url: string,
        dictPath = DEFAULT_DICTIONARY.dictPath,
    ): Promise<Uint8Array> {
        if (typeof fetch === "function") {
            try {
                const response = await fetch(url);
                if (response.ok) return new Uint8Array(await response.arrayBuffer());
            } catch {
                // 取得失敗は下の共通エラーとして通知します。
            }
        }

        throw new Error(`Failed to load dictionary from ${url}`);
    }

    private static async ensureDictionary(
        store: IndexedDbJisyoStore,
        definition: DictionaryDefinition,
        options: DictionaryLoadOptions,
    ): Promise<DictionaryLoadResult> {
        return store.runImportExclusive(definition.dictId, async () => {
            let active = await store.getActiveDictionary(definition.dictId);
            if (!options.force && active?.version === definition.version
                && await store.isImportCompleted(definition.dictId, definition.version)) {
                return { dictId: definition.dictId, status: "current", entryCount: active.entryCount };
            }

            const url = this.getDictionaryUrl(definition.dictPath);
            const buffer = await this.fetchDictionaryBuffer(url, definition.dictPath);
            const entries = parseDictionary(buffer, definition);
            await store.cleanupAbandonedGenerations(
                definition.dictId,
                active?.storage === "generation" ? active.activeGeneration : undefined,
                importSessionId,
            );

            for (let attempt = 0; attempt < 2; attempt += 1) {
                active = await store.getActiveDictionary(definition.dictId);
                if (!options.force && active?.version === definition.version
                    && await store.isImportCompleted(definition.dictId, definition.version)) {
                    return { dictId: definition.dictId, status: "current", entryCount: active.entryCount };
                }

                const generation = createGeneration();
                try {
                    const entryCount = await store.stageGeneration(
                        definition.dictId,
                        generation,
                        iterateEntries(entries),
                        options.batchSize ?? 2000,
                        (count) => options.onProgress?.(definition.dictId, count),
                    );
                    const published = await store.publishGeneration(
                        {
                            dictId: definition.dictId,
                            version: definition.version,
                            activeGeneration: generation,
                            entryCount,
                        },
                        active?.revision ?? 0,
                    );
                    if (!published) {
                        await store.deleteGeneration(definition.dictId, generation);
                        continue;
                    }

                    if (active?.storage === "generation" && active.activeGeneration !== generation) {
                        try {
                            await store.deleteGeneration(definition.dictId, active.activeGeneration!);
                        } catch (error) {
                            console.warn("[SKK] Failed to clean superseded dictionary generation:", error);
                        }
                    }
                    return { dictId: definition.dictId, status: "imported", entryCount };
                } catch (error) {
                    try {
                        await store.deleteGeneration(definition.dictId, generation);
                    } catch (cleanupError) {
                        console.warn("[SKK] Failed to clean unsuccessful dictionary generation:", cleanupError);
                    }
                    throw error;
                }
            }

            throw new Error(`Dictionary "${definition.dictId}" changed concurrently during import`);
        });
    }

    public static async ensureDictionaries(
        store: IndexedDbJisyoStore,
        definitions: readonly DictionaryDefinition[],
        options: DictionaryLoadOptions = {},
    ): Promise<DictionaryLoadResult[]> {
        assertDefinitionsMatchStore(store, definitions);
        return Promise.all(definitions.map((definition) => this.ensureDictionary(store, definition, options)));
    }

    public static async ensureInitialized(
        store: IndexedDbJisyoStore,
        options: DictionaryLoaderOptions = {},
    ): Promise<number> {
        const definition: DictionaryDefinition = {
            dictId: options.dictId ?? DEFAULT_DICTIONARY.dictId,
            dictPath: options.dictPath ?? DEFAULT_DICTIONARY.dictPath,
            version: options.version ?? DEFAULT_DICTIONARY.version,
            format: options.format ?? DEFAULT_DICTIONARY.format,
        };
        store.configureSingleDictionaryForCompatibility(definition.dictId);
        const [result] = await this.ensureDictionaries(store, [definition], {
            force: options.force,
            batchSize: options.batchSize,
            onProgress: options.onProgress ? (_dictId, count) => options.onProgress?.(count) : undefined,
        });
        return result?.status === "imported" ? result.entryCount : 0;
    }
}
