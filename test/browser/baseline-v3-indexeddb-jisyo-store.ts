import type { IJisyoStorage } from "../../src/core/skk/jisyo/IJisyoStorage";
import type { JisyoEntry } from "../../src/core/skk/jisyo/JisyoParser";
import { Candidate } from "../../src/core/skk/jisyo/candidate";
import { Entry } from "../../src/core/skk/jisyo/entry";

/**
 * Candidate data representation stored in IndexedDB.
 */
export interface StoredCandidate {
    word: string;
    annotation?: string;
}

/**
 * Record structure stored in the IndexedDB object store.
 */
export interface StoredJisyoRecord {
    key: string;
    candidates: StoredCandidate[];
}

/**
 * Metadata record representing dictionary import completion state.
 */
export interface DictionaryImportStatus {
    dictId: string;
    version: string;
    completed: boolean;
    entryCount: number;
    timestamp: number;
}

/**
 * Configuration options for IndexedDbJisyoStore.
 */
export interface IndexedDbJisyoStoreOptions {
    /**
     * Database name. Defaults to "skk_dictionary".
     */
    dbName?: string;

    /**
     * Object store name. Defaults to "system_jisyo".
     */
    storeName?: string;

    /**
     * Database schema version. Defaults to 3.
     */
    version?: number;

    /**
     * Custom IDBFactory instance (e.g. fake-indexeddb in tests).
     * If omitted, falls back to the global `indexedDB`.
     */
    indexedDB?: IDBFactory;
}

/**
 * Helper to generate an IDBKeyRange for prefix matches.
 * Uses lexicographical string bounding in UTF-16 code units.
 */
function createPrefixRange(prefix: string): IDBKeyRange | undefined {
    if (prefix.length === 0) {
        return undefined;
    }
    const lastCharCode = prefix.charCodeAt(prefix.length - 1);
    if (lastCharCode < 0xffff) {
        const upper = prefix.slice(0, -1) + String.fromCharCode(lastCharCode + 1);
        return IDBKeyRange.bound(prefix, upper, false, true);
    }
    return IDBKeyRange.lowerBound(prefix, false);
}

/**
 * Normalizes an entry from either JisyoEntry or a [key, candidates] tuple into a StoredJisyoRecord.
 */
function toStoredRecord(item: JisyoEntry | [string, Candidate[] | StoredCandidate[]]): StoredJisyoRecord | undefined {
    let key: string;
    let candidates: (Candidate | StoredCandidate)[];

    if (Array.isArray(item)) {
        key = item[0];
        candidates = item[1];
    } else {
        key = item.key;
        candidates = item.candidates;
    }

    if (!key || candidates.length === 0) {
        return undefined;
    }

    return {
        key,
        candidates: candidates.map((c) => ({
            word: c.word,
            ...(c.annotation ? { annotation: c.annotation } : {}),
        })),
    };
}

/**
 * High-performance IndexedDB-backed dictionary storage implementing IJisyoStorage.
 * Designed for system dictionaries (such as SKK-JISYO.L) with fast exact match and prefix lookup.
 */
export class IndexedDbJisyoStore implements IJisyoStorage {
    private readonly dbName: string;
    private readonly storeName: string;
    private readonly version: number;
    private readonly idbFactory?: IDBFactory;

    private db: IDBDatabase | null = null;
    private isClosed = false;
    private initPromise: Promise<void> | null = null;

    constructor(options?: IndexedDbJisyoStoreOptions) {
        this.dbName = options?.dbName ?? "skk_dictionary";
        this.storeName = options?.storeName ?? "system_jisyo";
        this.version = options?.version ?? 3;
        this.idbFactory = options?.indexedDB;
    }

    /**
     * Whether the database connection is currently active and open.
     */
    public get isOpen(): boolean {
        return this.db !== null && !this.isClosed;
    }

    /**
     * Initializes the IndexedDB database connection and creates the object store if needed.
     * Concurrently dispatched calls share the same initialization promise.
     */
    public async init(): Promise<void> {
        if (this.db && !this.isClosed) {
            return;
        }
        if (this.initPromise) {
            return this.initPromise;
        }
        this.isClosed = false;

        this.initPromise = (async () => {
            const factory = this.idbFactory ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined);
            if (!factory) {
                throw new Error("IndexedDB is not supported in this environment");
            }

            await new Promise<void>((resolve, reject) => {
                const request = factory.open(this.dbName, this.version);

                request.onblocked = () => {
                    reject(new Error(`IndexedDB database "${this.dbName}" is blocked by another connection`));
                };

                request.onerror = () => {
                    reject(request.error ?? new Error(`Failed to open IndexedDB database "${this.dbName}"`));
                };

                request.onupgradeneeded = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains("system_jisyo")) {
                        db.createObjectStore("system_jisyo", { keyPath: "key" });
                    }
                    if (!db.objectStoreNames.contains("user_jisyo")) {
                        db.createObjectStore("user_jisyo", { keyPath: "key" });
                    }
                    if (!db.objectStoreNames.contains("system_metadata")) {
                        db.createObjectStore("system_metadata", { keyPath: "dictId" });
                    }
                    if (!db.objectStoreNames.contains(this.storeName)) {
                        db.createObjectStore(this.storeName, { keyPath: "key" });
                    }
                };

                request.onsuccess = () => {
                    this.db = request.result;

                    this.db.onversionchange = () => {
                        this.close();
                    };

                    resolve();
                };
            });
        })().finally(() => {
            this.initPromise = null;
        });

        return this.initPromise;
    }

    /**
     * Ensures that the database connection is initialized.
     */
    private async ensureInitialized(): Promise<IDBDatabase> {
        if (this.isClosed) {
            throw new Error("IndexedDbJisyoStore is closed");
        }
        if (!this.db) {
            await this.init();
        }
        if (!this.db) {
            throw new Error("Failed to initialize IndexedDB database connection");
        }
        return this.db;
    }

    /**
     * Looks up candidates for an exact dictionary key (midashigo).
     *
     * @param key The dictionary key to look up (e.g. "とうきょう", "いk", "だい>")
     * @returns An Entry object if found, or undefined if not found
     */
    public async lookup(key: string): Promise<Entry | undefined> {
        const db = await this.ensureInitialized();

        return new Promise<Entry | undefined>((resolve, reject) => {
            const tx = db.transaction(this.storeName, "readonly");
            const store = tx.objectStore(this.storeName);
            const req = store.get(key);

            req.onsuccess = () => {
                const record = req.result as StoredJisyoRecord | undefined;
                if (!record || !record.candidates || record.candidates.length === 0) {
                    resolve(undefined);
                    return;
                }
                const candidates = record.candidates.map((c) => new Candidate(c.word, c.annotation));
                resolve(new Entry(key, candidates, ""));
            };

            req.onerror = () => {
                reject(req.error ?? new Error(`Failed to lookup key "${key}" in IndexedDB`));
            };
        });
    }

    /**
     * Looks up entries starting with the specified prefix (for completion or incremental search).
     *
     * @param prefix The key prefix to search
     * @param limit Maximum number of entries to return (optional)
     * @returns Array of matching Entry objects
     */
    public async lookupPrefix(prefix: string, limit?: number): Promise<Entry[]> {
        if (limit !== undefined && limit <= 0) {
            return [];
        }

        const db = await this.ensureInitialized();

        return new Promise<Entry[]>((resolve, reject) => {
            const tx = db.transaction(this.storeName, "readonly");
            const store = tx.objectStore(this.storeName);
            const range = createPrefixRange(prefix);

            const req = limit !== undefined ? store.getAll(range, limit) : store.getAll(range);

            req.onsuccess = () => {
                const records = req.result as StoredJisyoRecord[];
                const results: Entry[] = [];
                for (const record of records) {
                    if (record.key.startsWith(prefix) && record.candidates && record.candidates.length > 0) {
                        const candidates = record.candidates.map((c) => new Candidate(c.word, c.annotation));
                        results.push(new Entry(record.key, candidates, ""));
                    }
                }
                resolve(results);
            };

            req.onerror = () => {
                reject(req.error ?? new Error(`Failed to lookup prefix "${prefix}" in IndexedDB`));
            };
        });
    }

    /**
     * Batch imports dictionary entries into IndexedDB using chunked transactions.
     *
     * @param entries An iterable of JisyoEntry or a Map of key to Candidate[]
     * @param batchSize Number of records per transaction chunk (default: 2000)
     * @param progressCallback Optional progress notification callback invoked after each committed chunk
     * @returns Total number of records successfully imported
     */
    public async importEntries(
        entries: Iterable<JisyoEntry> | Map<string, Candidate[]>,
        batchSize: number = 2000,
        progressCallback?: (count: number) => void
    ): Promise<number> {
        const db = await this.ensureInitialized();
        let totalImported = 0;
        let currentBatch: StoredJisyoRecord[] = [];

        const commitBatch = async (batch: StoredJisyoRecord[]): Promise<void> => {
            if (batch.length === 0) return;
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(this.storeName, "readwrite");
                const store = tx.objectStore(this.storeName);

                for (const record of batch) {
                    store.put(record);
                }

                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction error during import"));
                tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted during import"));
            });
            totalImported += batch.length;
            progressCallback?.(totalImported);
        };

        const iterable = entries instanceof Map ? entries.entries() : entries;
        for (const item of iterable) {
            const record = toStoredRecord(item as JisyoEntry | [string, Candidate[]]);
            if (!record) {
                continue;
            }
            currentBatch.push(record);
            if (currentBatch.length >= batchSize) {
                await commitBatch(currentBatch);
                currentBatch = [];
            }
        }

        if (currentBatch.length > 0) {
            await commitBatch(currentBatch);
        }

        return totalImported;
    }

    /**
     * Records or updates the import status for a dictionary.
     *
     * @param status Dictionary import status metadata
     */
    public async setImportStatus(status: DictionaryImportStatus): Promise<void> {
        if (this.isClosed) {
            throw new Error("IndexedDbJisyoStore is closed");
        }
        const db = await this.ensureInitialized();

        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction("system_metadata", "readwrite");
            const store = tx.objectStore("system_metadata");
            const req = store.put(status);

            req.onerror = () => {
                reject(req.error ?? new Error(`Failed to set import status for "${status.dictId}"`));
            };

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error("Transaction error setting import status"));
            tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted setting import status"));
        });
    }

    /**
     * Retrieves the import status record for a given dictionary identifier.
     *
     * @param dictId The dictionary identifier (e.g. "dict/SKK-JISYO.S")
     * @returns DictionaryImportStatus if found, or undefined
     */
    public async getImportStatus(dictId: string): Promise<DictionaryImportStatus | undefined> {
        if (this.isClosed) {
            throw new Error("IndexedDbJisyoStore is closed");
        }
        const db = await this.ensureInitialized();

        return new Promise<DictionaryImportStatus | undefined>((resolve, reject) => {
            const tx = db.transaction("system_metadata", "readonly");
            const store = tx.objectStore("system_metadata");
            const req = store.get(dictId);

            req.onsuccess = () => {
                resolve(req.result as DictionaryImportStatus | undefined);
            };

            req.onerror = () => {
                reject(req.error ?? new Error(`Failed to get import status for "${dictId}"`));
            };
        });
    }

    /**
     * Deletes the import status record for a given dictionary identifier.
     *
     * @param dictId The dictionary identifier
     */
    public async deleteImportStatus(dictId: string): Promise<void> {
        if (this.isClosed) {
            throw new Error("IndexedDbJisyoStore is closed");
        }
        const db = await this.ensureInitialized();

        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction("system_metadata", "readwrite");
            const store = tx.objectStore("system_metadata");
            store.delete(dictId);

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error(`Failed to delete import status for "${dictId}"`));
            tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted deleting import status"));
        });
    }

    /**
     * Checks if the dictionary import was completed for the specified dictId and version.
     * Also verifies that the store contains records.
     *
     * @param dictId Dictionary identifier
     * @param version Optional version string to match
     * @returns True if import is completed and valid
     */
    public async isImportCompleted(dictId: string, version?: string): Promise<boolean> {
        const status = await this.getImportStatus(dictId);
        if (!status || !status.completed) {
            return false;
        }
        if (version !== undefined && status.version !== version) {
            return false;
        }
        const count = await this.count();
        if (count === 0) {
            return false;
        }
        return true;
    }

    /**
     * Clears all records from the dictionary object store.
     * Optionally also clears the import status for the specified dictId.
     */
    public async clear(dictId?: string): Promise<void> {
        if (this.isClosed) {
            throw new Error("IndexedDbJisyoStore is closed");
        }
        const db = await this.ensureInitialized();

        return new Promise<void>((resolve, reject) => {
            const hasMeta = db.objectStoreNames.contains("system_metadata");
            const storeNames = hasMeta ? [this.storeName, "system_metadata"] : [this.storeName];
            const tx = db.transaction(Array.from(new Set(storeNames)), "readwrite");
            const store = tx.objectStore(this.storeName);
            store.clear();

            if (hasMeta && dictId) {
                const metaStore = tx.objectStore("system_metadata");
                metaStore.delete(dictId);
            }

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error("Failed to clear IndexedDB store"));
            tx.onabort = () => reject(tx.error ?? new Error("Clear transaction aborted"));
        });
    }

    /**
     * Counts the total number of records currently stored in the object store.
     */
    public async count(): Promise<number> {
        const db = await this.ensureInitialized();

        return new Promise<number>((resolve, reject) => {
            const tx = db.transaction(this.storeName, "readonly");
            const store = tx.objectStore(this.storeName);
            const req = store.count();

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error ?? new Error("Failed to count records in IndexedDB store"));
        });
    }

    /**
     * Closes the active IndexedDB connection.
     */
    public close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
        this.initPromise = null;
        this.isClosed = true;
    }

    /**
     * Deletes the entire IndexedDB database (useful for reset, migration, or test cleanup).
     */
    public static async deleteDatabase(dbName: string = "skk_dictionary", factory?: IDBFactory): Promise<void> {
        const idb = factory ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined);
        if (!idb) return;

        return new Promise<void>((resolve, reject) => {
            const req = idb.deleteDatabase(dbName);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error ?? new Error(`Failed to delete database "${dbName}"`));
            req.onblocked = () => resolve();
        });
    }
}
