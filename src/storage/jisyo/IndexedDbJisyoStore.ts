import type { IJisyoStorage } from "../../core/skk/jisyo/IJisyoStorage";
import type { JisyoEntry } from "../../core/skk/jisyo/JisyoParser";
import { Candidate } from "../../core/skk/jisyo/candidate";
import { Entry } from "../../core/skk/jisyo/entry";
import {
    DEFAULT_STARTER_DICTIONARY_ID,
    SKK_DATABASE_VERSION,
    SYSTEM_CATALOG_STORE,
    SYSTEM_ENTRIES_STORE,
    SYSTEM_LEGACY_STORE,
    type ActiveDictionaryRecord,
    openSkkDatabase,
} from "../indexedDbSchema";

export interface StoredCandidate {
    word: string;
    annotation?: string;
}

export interface StoredJisyoRecord {
    dictId: string;
    generation: string;
    key: string;
    candidates: StoredCandidate[];
}

interface LegacyStoredJisyoRecord {
    key: string;
    candidates: StoredCandidate[];
}

export interface DictionaryImportStatus {
    dictId: string;
    version: string;
    completed: boolean;
    entryCount: number;
    timestamp: number;
    activeGeneration?: string;
    revision?: number;
}

export interface DictionaryGenerationPublication {
    dictId: string;
    version: string;
    activeGeneration: string;
    entryCount: number;
}

export interface IndexedDbJisyoStoreOptions {
    dbName?: string;
    version?: number;
    indexedDB?: IDBFactory;
    dictionaryIds?: readonly string[];
}

const importQueues = new WeakMap<IDBFactory, Map<string, Map<string, Promise<void>>>>();

function generationRange(dictId: string, generation: string): IDBKeyRange {
    return IDBKeyRange.bound([dictId, generation], [dictId, generation, []], false, true);
}

function generationPrefixRange(dictId: string, generation: string, prefix: string): IDBKeyRange {
    if (prefix.length === 0) return generationRange(dictId, generation);
    const lastCode = prefix.charCodeAt(prefix.length - 1);
    if (lastCode < 0xffff) {
        const upper = prefix.slice(0, -1) + String.fromCharCode(lastCode + 1);
        return IDBKeyRange.bound([dictId, generation, prefix], [dictId, generation, upper], false, true);
    }
    return IDBKeyRange.bound([dictId, generation, prefix], [dictId, generation, []], false, true);
}

function legacyPrefixRange(prefix: string): IDBKeyRange | undefined {
    if (prefix.length === 0) return undefined;
    const lastCode = prefix.charCodeAt(prefix.length - 1);
    if (lastCode < 0xffff) {
        const upper = prefix.slice(0, -1) + String.fromCharCode(lastCode + 1);
        return IDBKeyRange.bound(prefix, upper, false, true);
    }
    return IDBKeyRange.lowerBound(prefix);
}

function toStoredRecord(dictId: string, generation: string, entry: JisyoEntry): StoredJisyoRecord | undefined {
    if (entry.candidates.length === 0) return undefined;
    return {
        dictId,
        generation,
        key: entry.key,
        candidates: entry.candidates.map((candidate) => ({
            word: candidate.word,
            ...(candidate.annotation ? { annotation: candidate.annotation } : {}),
        })),
    };
}

function appendCandidates(target: Candidate[], seen: Set<string>, candidates: readonly StoredCandidate[]): void {
    for (const candidate of candidates) {
        if (!seen.has(candidate.word)) {
            seen.add(candidate.word);
            target.push(new Candidate(candidate.word, candidate.annotation));
        }
    }
}

export class IndexedDbJisyoStore implements IJisyoStorage {
    private readonly dbName: string;
    private readonly version: number;
    private readonly idbFactory?: IDBFactory;
    private readonly usesImplicitDictionaryIds: boolean;
    private dictionaryIds: readonly string[];
    private dictionaryConfigurationLocked = false;
    private db: IDBDatabase | null = null;
    private isClosed = false;
    private initPromise: Promise<void> | null = null;

    constructor(options?: IndexedDbJisyoStoreOptions) {
        this.dbName = options?.dbName ?? "skk_dictionary";
        this.version = options?.version ?? SKK_DATABASE_VERSION;
        this.idbFactory = options?.indexedDB;
        this.usesImplicitDictionaryIds = options?.dictionaryIds === undefined;
        this.dictionaryIds = [...(options?.dictionaryIds ?? [DEFAULT_STARTER_DICTIONARY_ID])];
        if (new Set(this.dictionaryIds).size !== this.dictionaryIds.length) {
            throw new Error("dictionaryIds must not contain duplicates");
        }
    }

    public get isOpen(): boolean {
        return this.db !== null && !this.isClosed;
    }

    public get configuredDictionaryIds(): readonly string[] {
        return this.dictionaryIds;
    }

    /** 既存の単一辞書ローダーが、初回処理前に限って暗黙の辞書 ID を置き換えるために使用します。 */
    public configureSingleDictionaryForCompatibility(dictId: string): void {
        if (!dictId) throw new Error("dictId must not be empty");
        if (this.dictionaryIds.length === 1 && this.dictionaryIds[0] === dictId) {
            this.dictionaryConfigurationLocked = true;
            return;
        }
        if (!this.usesImplicitDictionaryIds
            || this.dictionaryConfigurationLocked
            || this.db
            || this.initPromise
            || this.isClosed) {
            throw new Error("Custom dictId requires a new store without explicit dictionaryIds");
        }
        this.dictionaryIds = [dictId];
        this.dictionaryConfigurationLocked = true;
    }

    private getFactory(): IDBFactory {
        const factory = this.idbFactory ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined);
        if (!factory) throw new Error("IndexedDB is not supported in this environment");
        return factory;
    }

    public async init(): Promise<void> {
        this.dictionaryConfigurationLocked = true;
        if (this.db && !this.isClosed) return;
        if (this.initPromise) return this.initPromise;
        this.isClosed = false;
        this.initPromise = openSkkDatabase(this.getFactory(), this.dbName, this.version)
            .then((db) => {
                this.db = db;
                db.onversionchange = () => this.close();
            })
            .finally(() => {
                this.initPromise = null;
            });
        return this.initPromise;
    }

    private async ensureInitialized(): Promise<IDBDatabase> {
        if (this.isClosed) throw new Error("IndexedDbJisyoStore is closed");
        if (!this.db) await this.init();
        if (!this.db) throw new Error("Failed to initialize IndexedDB database connection");
        return this.db;
    }

    /** 同じDB・辞書IDのインポートをストアインスタンス間で直列化します。 */
    public async runImportExclusive<T>(dictId: string, action: () => Promise<T>): Promise<T> {
        this.dictionaryConfigurationLocked = true;
        const factory = this.getFactory();
        let databases = importQueues.get(factory);
        if (!databases) {
            databases = new Map();
            importQueues.set(factory, databases);
        }
        let dictionaries = databases.get(this.dbName);
        if (!dictionaries) {
            dictionaries = new Map();
            databases.set(this.dbName, dictionaries);
        }

        const previous = dictionaries.get(dictId) ?? Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const tail = previous.catch(() => undefined).then(() => gate);
        dictionaries.set(dictId, tail);

        await previous.catch(() => undefined);
        try {
            return await action();
        } finally {
            release();
            if (dictionaries.get(dictId) === tail) {
                void tail.finally(() => {
                    if (dictionaries?.get(dictId) === tail) dictionaries.delete(dictId);
                    if (dictionaries?.size === 0) databases?.delete(this.dbName);
                });
            }
        }
    }

    public async getActiveDictionary(dictId: string): Promise<ActiveDictionaryRecord | undefined> {
        const db = await this.ensureInitialized();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(SYSTEM_CATALOG_STORE, "readonly");
            const request = tx.objectStore(SYSTEM_CATALOG_STORE).get(dictId);
            request.onsuccess = () => resolve(request.result as ActiveDictionaryRecord | undefined);
            request.onerror = () => reject(request.error ?? new Error(`Failed to read catalog for "${dictId}"`));
        });
    }

    public async lookup(key: string): Promise<Entry | undefined> {
        const db = await this.ensureInitialized();
        return new Promise<Entry | undefined>((resolve, reject) => {
            const tx = db.transaction([SYSTEM_CATALOG_STORE, SYSTEM_ENTRIES_STORE, SYSTEM_LEGACY_STORE], "readonly");
            const records = new Map<string, StoredCandidate[]>();

            for (const dictId of this.dictionaryIds) {
                const catalogRequest = tx.objectStore(SYSTEM_CATALOG_STORE).get(dictId);
                catalogRequest.onsuccess = () => {
                    const catalog = catalogRequest.result as ActiveDictionaryRecord | undefined;
                    if (!catalog || (catalog.storage === "generation" && !catalog.activeGeneration)) return;
                    const request = catalog.storage === "legacy"
                        ? tx.objectStore(SYSTEM_LEGACY_STORE).get(key)
                        : tx.objectStore(SYSTEM_ENTRIES_STORE).get([dictId, catalog.activeGeneration!, key]);
                    request.onsuccess = () => {
                        const record = request.result as StoredJisyoRecord | LegacyStoredJisyoRecord | undefined;
                        if (record?.candidates?.length) records.set(dictId, record.candidates);
                    };
                };
            }

            tx.oncomplete = () => {
                const candidates: Candidate[] = [];
                const seen = new Set<string>();
                for (const dictId of this.dictionaryIds) appendCandidates(candidates, seen, records.get(dictId) ?? []);
                resolve(candidates.length > 0 ? new Entry(key, candidates, "") : undefined);
            };
            tx.onerror = () => reject(tx.error ?? new Error(`Failed to lookup key "${key}" in IndexedDB`));
            tx.onabort = () => reject(tx.error ?? new Error(`Lookup transaction aborted for "${key}"`));
        });
    }

    public async lookupPrefix(prefix: string, limit?: number): Promise<Entry[]> {
        if (limit !== undefined && limit <= 0) return [];
        const db = await this.ensureInitialized();
        return new Promise<Entry[]>((resolve, reject) => {
            const tx = db.transaction([SYSTEM_CATALOG_STORE, SYSTEM_ENTRIES_STORE, SYSTEM_LEGACY_STORE], "readonly");
            const records = new Map<string, Array<StoredJisyoRecord | LegacyStoredJisyoRecord>>();

            for (const dictId of this.dictionaryIds) {
                const catalogRequest = tx.objectStore(SYSTEM_CATALOG_STORE).get(dictId);
                catalogRequest.onsuccess = () => {
                    const catalog = catalogRequest.result as ActiveDictionaryRecord | undefined;
                    if (!catalog || (catalog.storage === "generation" && !catalog.activeGeneration)) return;
                    const request = catalog.storage === "legacy"
                        ? (limit === undefined
                            ? tx.objectStore(SYSTEM_LEGACY_STORE).getAll(legacyPrefixRange(prefix))
                            : tx.objectStore(SYSTEM_LEGACY_STORE).getAll(legacyPrefixRange(prefix), limit))
                        : (limit === undefined
                            ? tx.objectStore(SYSTEM_ENTRIES_STORE).getAll(generationPrefixRange(dictId, catalog.activeGeneration!, prefix))
                            : tx.objectStore(SYSTEM_ENTRIES_STORE).getAll(generationPrefixRange(dictId, catalog.activeGeneration!, prefix), limit));
                    request.onsuccess = () => {
                        records.set(dictId, (request.result as Array<StoredJisyoRecord | LegacyStoredJisyoRecord>)
                            .filter((record) => record.key.startsWith(prefix)));
                    };
                };
            }

            tx.oncomplete = () => {
                const byKey = new Map<string, { candidates: Candidate[]; seen: Set<string> }>();
                for (const dictId of this.dictionaryIds) {
                    for (const record of records.get(dictId) ?? []) {
                        let combined = byKey.get(record.key);
                        if (!combined) {
                            combined = { candidates: [], seen: new Set() };
                            byKey.set(record.key, combined);
                        }
                        appendCandidates(combined.candidates, combined.seen, record.candidates);
                    }
                }
                const keys = [...byKey.keys()].sort();
                const selected = limit === undefined ? keys : keys.slice(0, limit);
                resolve(selected.map((entryKey) => new Entry(entryKey, byKey.get(entryKey)!.candidates, "")));
            };
            tx.onerror = () => reject(tx.error ?? new Error(`Failed to lookup prefix "${prefix}" in IndexedDB`));
            tx.onabort = () => reject(tx.error ?? new Error(`Prefix lookup transaction aborted for "${prefix}"`));
        });
    }

    public async stageGeneration(
        dictId: string,
        generation: string,
        entries: Iterable<JisyoEntry>,
        batchSize = 2000,
        progressCallback?: (count: number) => void,
    ): Promise<number> {
        if (!Number.isInteger(batchSize) || batchSize <= 0) throw new Error("batchSize must be a positive integer");
        const db = await this.ensureInitialized();
        let imported = 0;
        let batch: StoredJisyoRecord[] = [];

        const commit = async (): Promise<void> => {
            if (batch.length === 0) return;
            const current = batch;
            batch = [];
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(SYSTEM_ENTRIES_STORE, "readwrite");
                const store = tx.objectStore(SYSTEM_ENTRIES_STORE);
                for (const record of current) store.put(record);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction error during import"));
                tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted during import"));
            });
            imported += current.length;
            progressCallback?.(imported);
        };

        for (const entry of entries) {
            const record = toStoredRecord(dictId, generation, entry);
            if (!record) continue;
            batch.push(record);
            if (batch.length >= batchSize) await commit();
        }
        await commit();
        return imported;
    }

    public async publishGeneration(
        record: DictionaryGenerationPublication,
        expectedRevision: number,
    ): Promise<boolean> {
        const db = await this.ensureInitialized();
        return new Promise<boolean>((resolve, reject) => {
            let published = false;
            const tx = db.transaction([SYSTEM_CATALOG_STORE, SYSTEM_ENTRIES_STORE], "readwrite");
            const catalogStore = tx.objectStore(SYSTEM_CATALOG_STORE);
            const currentRequest = catalogStore.get(record.dictId);
            currentRequest.onsuccess = () => {
                const current = currentRequest.result as ActiveDictionaryRecord | undefined;
                if ((current?.revision ?? 0) !== expectedRevision) return;
                const countRequest = tx.objectStore(SYSTEM_ENTRIES_STORE)
                    .count(generationRange(record.dictId, record.activeGeneration!));
                countRequest.onsuccess = () => {
                    if (countRequest.result !== record.entryCount) {
                        tx.abort();
                        return;
                    }
                    catalogStore.put({
                        ...record,
                        revision: expectedRevision + 1,
                        storage: "generation",
                        timestamp: Date.now(),
                    } satisfies ActiveDictionaryRecord);
                    published = true;
                };
            };
            tx.oncomplete = () => resolve(published);
            tx.onerror = () => reject(tx.error ?? new Error(`Failed to publish dictionary "${record.dictId}"`));
            tx.onabort = () => reject(tx.error ?? new Error(`Dictionary publication aborted for "${record.dictId}"`));
        });
    }

    public async deleteGeneration(dictId: string, generation: string): Promise<void> {
        const db = await this.ensureInitialized();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(SYSTEM_ENTRIES_STORE, "readwrite");
            tx.objectStore(SYSTEM_ENTRIES_STORE).delete(generationRange(dictId, generation));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error(`Failed to delete generation "${generation}"`));
            tx.onabort = () => reject(tx.error ?? new Error(`Generation cleanup aborted for "${generation}"`));
        });
    }

    /** 同一辞書の排他ロック内でのみ呼び出し、停止済みインポートの世代を回収します。 */
    public async cleanupAbandonedGenerations(
        dictId: string,
        activeGeneration?: string,
        protectedGenerationPrefix?: string,
    ): Promise<void> {
        const db = await this.ensureInitialized();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(SYSTEM_ENTRIES_STORE, "readwrite");
            const request = tx.objectStore(SYSTEM_ENTRIES_STORE)
                .openCursor(IDBKeyRange.bound([dictId], [dictId, []], false, true));
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) return;
                const value = cursor.value as StoredJisyoRecord;
                if (value.generation !== activeGeneration
                    && (!protectedGenerationPrefix || !value.generation.startsWith(protectedGenerationPrefix))) {
                    cursor.delete();
                }
                cursor.continue();
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error(`Failed to recover abandoned imports for "${dictId}"`));
            tx.onabort = () => reject(tx.error ?? new Error(`Abandoned import recovery aborted for "${dictId}"`));
        });
    }

    public async getImportStatus(dictId: string): Promise<DictionaryImportStatus | undefined> {
        const active = await this.getActiveDictionary(dictId);
        if (!active) return undefined;
        return {
            dictId,
            version: active.version,
            completed: true,
            entryCount: active.entryCount,
            timestamp: active.timestamp,
            activeGeneration: active.activeGeneration,
            revision: active.revision,
        };
    }

    public async isImportCompleted(dictId: string, version?: string): Promise<boolean> {
        const db = await this.ensureInitialized();
        return new Promise<boolean>((resolve, reject) => {
            let completed = false;
            const tx = db.transaction(
                [SYSTEM_CATALOG_STORE, SYSTEM_ENTRIES_STORE, SYSTEM_LEGACY_STORE],
                "readonly",
            );
            const catalogRequest = tx.objectStore(SYSTEM_CATALOG_STORE).get(dictId);
            catalogRequest.onsuccess = () => {
                const active = catalogRequest.result as ActiveDictionaryRecord | undefined;
                if (!active || (version !== undefined && active.version !== version)) return;
                if (active.storage === "generation" && !active.activeGeneration) return;
                const countRequest = active.storage === "legacy"
                    ? tx.objectStore(SYSTEM_LEGACY_STORE).count()
                    : tx.objectStore(SYSTEM_ENTRIES_STORE).count(
                        generationRange(dictId, active.activeGeneration!),
                    );
                countRequest.onsuccess = () => {
                    completed = countRequest.result === active.entryCount;
                };
            };
            tx.oncomplete = () => resolve(completed);
            tx.onerror = () => reject(tx.error ?? new Error(`Failed to verify dictionary "${dictId}"`));
            tx.onabort = () => reject(tx.error ?? new Error(`Dictionary verification aborted for "${dictId}"`));
        });
    }

    public async count(dictId?: string): Promise<number> {
        const ids = dictId ? [dictId] : this.dictionaryIds;
        const records = await Promise.all(ids.map((id) => this.getActiveDictionary(id)));
        return records.reduce((sum, record) => sum + (record?.entryCount ?? 0), 0);
    }

    public async clearDictionary(dictId: string): Promise<void> {
        await this.runImportExclusive(dictId, async () => {
            const active = await this.getActiveDictionary(dictId);
            const db = await this.ensureInitialized();
            await new Promise<void>((resolve, reject) => {
                const stores = active?.storage === "legacy"
                    ? [SYSTEM_CATALOG_STORE, SYSTEM_LEGACY_STORE]
                    : [SYSTEM_CATALOG_STORE];
                const tx = db.transaction(stores, "readwrite");
                tx.objectStore(SYSTEM_CATALOG_STORE).delete(dictId);
                if (active?.storage === "legacy") tx.objectStore(SYSTEM_LEGACY_STORE).clear();
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error(`Failed to clear dictionary "${dictId}"`));
                tx.onabort = () => reject(tx.error ?? new Error(`Clear transaction aborted for "${dictId}"`));
            });
            await this.cleanupAbandonedGenerations(dictId);
        });
    }

    public close(): void {
        this.db?.close();
        this.db = null;
        this.initPromise = null;
        this.isClosed = true;
    }

    public static async deleteDatabase(dbName = "skk_dictionary", factory?: IDBFactory): Promise<void> {
        const idb = factory ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined);
        if (!idb) return;
        return new Promise<void>((resolve, reject) => {
            const request = idb.deleteDatabase(dbName);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error ?? new Error(`Failed to delete database "${dbName}"`));
            request.onblocked = () => resolve();
        });
    }
}
