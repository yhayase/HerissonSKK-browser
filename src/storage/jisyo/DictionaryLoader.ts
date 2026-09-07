import { parseJisyoBuffer } from "../../core/skk/jisyo/JisyoParser";
import type { IndexedDbJisyoStore } from "./IndexedDbJisyoStore";

/**
 * Options for dictionary loading and initialization.
 */
export interface DictionaryLoaderOptions {
    /**
     * Relative path to the starter dictionary within the extension package.
     * Defaults to "dict/SKK-JISYO.S".
     */
    dictPath?: string;

    /**
     * If true, forces re-import even if the store already contains entries.
     */
    force?: boolean;

    /**
     * Number of entries to commit per IndexedDB transaction chunk. Defaults to 2000.
     */
    batchSize?: number;

    /**
     * Optional progress notification callback invoked after each committed chunk.
     */
    onProgress?: (importedCount: number) => void;
}

/**
 * Helper to ensure the initial system dictionary is loaded into IndexedDbJisyoStore.
 * Designed for first-run bootstrapping and testing environments.
 */
export class DictionaryLoader {
    private static initPromise: Promise<number> | null = null;

    /**
     * Resolves the runtime URL for the bundled dictionary file.
     * Uses browser.runtime.getURL or chrome.runtime.getURL if available.
     */
    public static getDictionaryUrl(dictPath: string = "dict/SKK-JISYO.S"): string {
        try {
            const g = globalThis as any;
            if (typeof g.browser !== "undefined" && g.browser.runtime?.getURL) {
                return g.browser.runtime.getURL(dictPath);
            }
            if (typeof g.chrome !== "undefined" && g.chrome.runtime?.getURL) {
                return g.chrome.runtime.getURL(dictPath);
            }
        } catch {
            // ignore
        }
        return `/${dictPath}`;
    }

    /**
     * Fetches raw dictionary buffer from URL, or falls back to Node.js filesystem in testing environments.
     */
    public static async fetchDictionaryBuffer(url: string, dictPath: string = "dict/SKK-JISYO.S"): Promise<Uint8Array> {
        if (typeof fetch === "function") {
            try {
                const response = await fetch(url);
                if (response.ok) {
                    const arrayBuffer = await response.arrayBuffer();
                    return new Uint8Array(arrayBuffer);
                }
            } catch {
                // In Node.js or unit test environments without full HTTP server, try direct filesystem fallback
            }
        }

        // Node.js test environment fallback:
        if (typeof process !== "undefined" && process.versions?.node) {
            try {
                const fs = await import(/* @vite-ignore */ "fs/promises");
                const path = await import(/* @vite-ignore */ "path");
                const filePath = path.resolve(process.cwd(), "public", dictPath);
                const fileBuf = await fs.readFile(filePath);
                return new Uint8Array(fileBuf.buffer, fileBuf.byteOffset, fileBuf.byteLength);
            } catch (fsErr) {
                console.warn("[SKK] DictionaryLoader filesystem fallback failed:", fsErr);
            }
        }

        throw new Error(`Failed to load dictionary from ${url}`);
    }

    /**
     * Ensures the system dictionary store is populated with initial vocabulary.
     * If the store is already non-empty (count > 0), does nothing and returns 0.
     * If empty, fetches, parses, and imports the bundled starter dictionary.
     *
     * @param store The IndexedDbJisyoStore instance
     * @param options Optional loader configuration
     * @returns Promise resolving to the number of imported entries (0 if already populated)
     */
    public static async ensureInitialized(
        store: IndexedDbJisyoStore,
        options?: DictionaryLoaderOptions
    ): Promise<number> {
        if (!options?.force) {
            const count = await store.count();
            if (count > 0) {
                return 0;
            }
        }

        // Deduplicate simultaneous initialization calls
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = (async () => {
            try {
                const dictPath = options?.dictPath ?? "dict/SKK-JISYO.S";
                const url = this.getDictionaryUrl(dictPath);
                const buffer = await this.fetchDictionaryBuffer(url, dictPath);
                const entriesMap = parseJisyoBuffer(buffer);
                const imported = await store.importEntries(
                    entriesMap,
                    options?.batchSize ?? 2000,
                    options?.onProgress
                );
                console.log(`[SKK] DictionaryLoader: successfully imported ${imported} entries into system dictionary`);
                return imported;
            } finally {
                this.initPromise = null;
            }
        })();

        return this.initPromise;
    }
}
