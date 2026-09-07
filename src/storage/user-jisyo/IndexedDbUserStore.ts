import type { IUserJisyoStorage } from "../../core/skk/jisyo/IJisyoStorage";
import { Candidate } from "../../core/skk/jisyo/candidate";

/**
 * Candidate data representation stored in IndexedDB for user dictionary.
 */
export interface StoredUserCandidate {
    word: string;
    annotation?: string;
}

/**
 * Record structure stored in the user_jisyo object store.
 */
export interface StoredUserRecord {
    key: string;
    candidates: StoredUserCandidate[];
    updatedAt: number;
}

/**
 * Configuration options for IndexedDbUserStore.
 */
export interface IndexedDbUserStoreOptions {
    /**
     * Database name. Defaults to "skk_dictionary".
     */
    dbName?: string;

    /**
     * Object store name. Defaults to "user_jisyo".
     */
    storeName?: string;

    /**
     * Database schema version. Defaults to 2.
     */
    version?: number;

    /**
     * Custom IDBFactory instance (e.g. fake-indexeddb in tests).
     * If omitted, falls back to the global `indexedDB`.
     */
    indexedDB?: IDBFactory;
}

/**
 * IndexedDB-backed user dictionary storage implementing IUserJisyoStorage.
 * Manages user candidate learning, LRU promotion, deletions, and persistence.
 */
export class IndexedDbUserStore implements IUserJisyoStorage {
    private readonly dbName: string;
    private readonly storeName: string;
    private readonly version: number;
    private readonly idbFactory?: IDBFactory;

    private db: IDBDatabase | null = null;
    private isClosed = false;
    private initPromise: Promise<void> | null = null;

    constructor(options?: IndexedDbUserStoreOptions) {
        this.dbName = options?.dbName ?? "skk_dictionary";
        this.storeName = options?.storeName ?? "user_jisyo";
        this.version = options?.version ?? 2;
        this.idbFactory = options?.indexedDB;
    }

    /**
     * Whether the database connection is currently active and open.
     */
    public get isOpen(): boolean {
        return this.db !== null && !this.isClosed;
    }

    /**
     * Initializes the IndexedDB database connection and creates required object stores if needed.
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
            throw new Error("IndexedDbUserStore is closed");
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
     * Loads all user entries from storage into a Map of key to Candidate[].
     */
    public async loadUserEntries(): Promise<Map<string, Candidate[]>> {
        const db = await this.ensureInitialized();

        return new Promise<Map<string, Candidate[]>>((resolve, reject) => {
            const tx = db.transaction(this.storeName, "readonly");
            const store = tx.objectStore(this.storeName);
            const req = store.getAll();

            req.onsuccess = () => {
                const records = req.result as StoredUserRecord[];
                const map = new Map<string, Candidate[]>();
                for (const record of records) {
                    if (record.key && record.candidates && record.candidates.length > 0) {
                        const candidates = record.candidates.map(
                            (c) => new Candidate(c.word, c.annotation)
                        );
                        map.set(record.key, candidates);
                    }
                }
                resolve(map);
            };

            req.onerror = () => {
                reject(req.error ?? new Error("Failed to load user entries from IndexedDB"));
            };
        });
    }

    /**
     * Saves or registers a candidate for a given key.
     * Moves existing candidate to the front (LRU/MRU ordering) or prepends a new candidate.
     */
    public async saveCandidate(key: string, candidate: Candidate): Promise<boolean> {
        const db = await this.ensureInitialized();

        return new Promise<boolean>((resolve, reject) => {
            const tx = db.transaction(this.storeName, "readwrite");
            const store = tx.objectStore(this.storeName);
            const getReq = store.get(key);

            getReq.onsuccess = () => {
                const record = getReq.result as StoredUserRecord | undefined;
                const existingCandidates = record?.candidates ? [...record.candidates] : [];
                const existingIdx = existingCandidates.findIndex((c) => c.word === candidate.word);

                if (existingIdx !== -1) {
                    existingCandidates.splice(existingIdx, 1);
                }

                existingCandidates.unshift({
                    word: candidate.word,
                    ...(candidate.annotation ? { annotation: candidate.annotation } : {}),
                });

                const newRecord: StoredUserRecord = {
                    key,
                    candidates: existingCandidates,
                    updatedAt: Date.now(),
                };

                const putReq = store.put(newRecord);
                putReq.onerror = () => {
                    reject(putReq.error ?? new Error(`Failed to put candidate for key "${key}"`));
                };
            };

            getReq.onerror = () => {
                reject(getReq.error ?? new Error(`Failed to get record for key "${key}"`));
            };

            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error ?? new Error(`Transaction error in saveCandidate for "${key}"`));
            tx.onabort = () => reject(tx.error ?? new Error(`Transaction aborted in saveCandidate for "${key}"`));
        });
    }

    /**
     * Reorders candidates for a key by moving the candidate at selectedIndex to the front.
     */
    public async reorderCandidate(key: string, selectedIndex: number): Promise<boolean> {
        const db = await this.ensureInitialized();

        return new Promise<boolean>((resolve, reject) => {
            let success = false;
            const tx = db.transaction(this.storeName, "readwrite");
            const store = tx.objectStore(this.storeName);
            const getReq = store.get(key);

            getReq.onsuccess = () => {
                const record = getReq.result as StoredUserRecord | undefined;
                if (!record || !record.candidates || selectedIndex < 0 || selectedIndex >= record.candidates.length) {
                    return;
                }

                const candidates = [...record.candidates];
                const [selected] = candidates.splice(selectedIndex, 1);
                if (selected) {
                    candidates.unshift(selected);
                }

                const newRecord: StoredUserRecord = {
                    key,
                    candidates,
                    updatedAt: Date.now(),
                };

                const putReq = store.put(newRecord);
                putReq.onerror = () => {
                    reject(putReq.error ?? new Error(`Failed to update reordered record for key "${key}"`));
                };
                success = true;
            };

            getReq.onerror = () => {
                reject(getReq.error ?? new Error(`Failed to get record for key "${key}"`));
            };

            tx.oncomplete = () => resolve(success);
            tx.onerror = () => reject(tx.error ?? new Error(`Transaction error in reorderCandidate for "${key}"`));
            tx.onabort = () => reject(tx.error ?? new Error(`Transaction aborted in reorderCandidate for "${key}"`));
        });
    }

    /**
     * Deletes a candidate for a given key.
     * If all candidates for the key are deleted, removes the key record entirely.
     */
    public async deleteCandidate(key: string, candidate: Candidate): Promise<boolean> {
        const db = await this.ensureInitialized();

        return new Promise<boolean>((resolve, reject) => {
            let found = false;
            const tx = db.transaction(this.storeName, "readwrite");
            const store = tx.objectStore(this.storeName);
            const getReq = store.get(key);

            getReq.onsuccess = () => {
                const record = getReq.result as StoredUserRecord | undefined;
                if (!record || !record.candidates) {
                    return;
                }

                const candidates = [...record.candidates];
                const index = candidates.findIndex((c) => c.word === candidate.word);
                if (index === -1) {
                    return;
                }

                found = true;
                candidates.splice(index, 1);

                if (candidates.length === 0) {
                    store.delete(key);
                } else {
                    store.put({
                        key,
                        candidates,
                        updatedAt: Date.now(),
                    });
                }
            };

            getReq.onerror = () => {
                reject(getReq.error ?? new Error(`Failed to get record for key "${key}"`));
            };

            tx.oncomplete = () => resolve(found);
            tx.onerror = () => reject(tx.error ?? new Error(`Transaction error in deleteCandidate for "${key}"`));
            tx.onabort = () => reject(tx.error ?? new Error(`Transaction aborted in deleteCandidate for "${key}"`));
        });
    }

    /**
     * Bulk saves user dictionary entries (for import, migration, or restore).
     */
    public async saveUserEntries(entries: Map<string, Candidate[]>): Promise<boolean> {
        const db = await this.ensureInitialized();

        return new Promise<boolean>((resolve, reject) => {
            const tx = db.transaction(this.storeName, "readwrite");
            const store = tx.objectStore(this.storeName);
            const now = Date.now();

            for (const [key, candidates] of entries) {
                if (!key || candidates.length === 0) continue;
                const record: StoredUserRecord = {
                    key,
                    candidates: candidates.map((c) => ({
                        word: c.word,
                        ...(c.annotation ? { annotation: c.annotation } : {}),
                    })),
                    updatedAt: now,
                };
                store.put(record);
            }

            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error ?? new Error("Failed to save user entries"));
            tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted for saveUserEntries"));
        });
    }

    /**
     * Clears all user dictionary records.
     */
    public async clear(): Promise<boolean> {
        const db = await this.ensureInitialized();

        return new Promise<boolean>((resolve, reject) => {
            const tx = db.transaction(this.storeName, "readwrite");
            const store = tx.objectStore(this.storeName);
            store.clear();

            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error ?? new Error("Failed to clear user dictionary"));
            tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted for clear"));
        });
    }

    /**
     * Counts the total number of entries in the user dictionary.
     */
    public async count(): Promise<number> {
        const db = await this.ensureInitialized();

        return new Promise<number>((resolve, reject) => {
            const tx = db.transaction(this.storeName, "readonly");
            const store = tx.objectStore(this.storeName);
            const req = store.count();

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error ?? new Error("Failed to count user dictionary records"));
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
