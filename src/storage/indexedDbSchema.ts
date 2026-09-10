export const SKK_DATABASE_VERSION = 4;
export const SYSTEM_LEGACY_STORE = "system_jisyo";
export const USER_JISYO_STORE = "user_jisyo";
export const SYSTEM_METADATA_STORE = "system_metadata";
export const SYSTEM_CATALOG_STORE = "system_catalog";
export const SYSTEM_ENTRIES_STORE = "system_entries";

export const DEFAULT_STARTER_DICTIONARY_ID = "skk-jisyo-s";
const LEGACY_STARTER_METADATA_ID = "dict/SKK-JISYO.S";

export interface ActiveDictionaryRecord {
    dictId: string;
    version: string;
    activeGeneration?: string;
    entryCount: number;
    revision: number;
    storage: "generation" | "legacy";
    timestamp: number;
}

/**
 * 全ストレージ実装で共有する IndexedDB スキーマを更新します。
 * ユーザー辞書は削除・再作成せず、旧システム辞書は移行完了まで読み取り可能にします。
 */
export function upgradeSkkDatabase(
    request: IDBOpenDBRequest,
    oldVersion: number,
    additionalStore?: { name: string; keyPath: string | string[] },
): void {
    const db = request.result;
    const tx = request.transaction;
    if (!tx) {
        throw new Error("IndexedDB upgrade transaction is unavailable");
    }

    if (!db.objectStoreNames.contains(SYSTEM_LEGACY_STORE)) {
        db.createObjectStore(SYSTEM_LEGACY_STORE, { keyPath: "key" });
    }
    if (!db.objectStoreNames.contains(USER_JISYO_STORE)) {
        db.createObjectStore(USER_JISYO_STORE, { keyPath: "key" });
    }
    if (!db.objectStoreNames.contains(SYSTEM_METADATA_STORE)) {
        db.createObjectStore(SYSTEM_METADATA_STORE, { keyPath: "dictId" });
    }
    if (!db.objectStoreNames.contains(SYSTEM_CATALOG_STORE)) {
        db.createObjectStore(SYSTEM_CATALOG_STORE, { keyPath: "dictId" });
    }
    if (!db.objectStoreNames.contains(SYSTEM_ENTRIES_STORE)) {
        db.createObjectStore(SYSTEM_ENTRIES_STORE, { keyPath: ["dictId", "generation", "key"] });
    }
    if (additionalStore && !db.objectStoreNames.contains(additionalStore.name)) {
        db.createObjectStore(additionalStore.name, { keyPath: additionalStore.keyPath });
    }

    if (oldVersion === 0 || oldVersion >= SKK_DATABASE_VERSION) {
        return;
    }

    const legacyStore = tx.objectStore(SYSTEM_LEGACY_STORE);
    const catalogStore = tx.objectStore(SYSTEM_CATALOG_STORE);
    const countRequest = legacyStore.count();

    countRequest.onsuccess = () => {
        const entryCount = countRequest.result;
        if (entryCount === 0) {
            return;
        }

        const adoptLegacy = (): void => {
            const record: ActiveDictionaryRecord = {
                dictId: DEFAULT_STARTER_DICTIONARY_ID,
                version: `legacy-v${oldVersion}`,
                entryCount,
                revision: 1,
                storage: "legacy",
                timestamp: Date.now(),
            };
            catalogStore.put(record);
        };

        if (oldVersion < 3) {
            adoptLegacy();
            return;
        }

        const metadataStore = tx.objectStore(SYSTEM_METADATA_STORE);
        const statusRequest = metadataStore.get(LEGACY_STARTER_METADATA_ID);
        statusRequest.onsuccess = () => {
            const status = statusRequest.result as { completed?: unknown } | undefined;
            if (status?.completed === true) {
                adoptLegacy();
            }
        };
    };
}

export function openSkkDatabase(
    factory: IDBFactory,
    dbName: string,
    version: number = SKK_DATABASE_VERSION,
    additionalStore?: { name: string; keyPath: string | string[] },
): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const request = factory.open(dbName, version);

        request.onerror = () => {
            reject(request.error ?? new Error(`Failed to open IndexedDB database "${dbName}"`));
        };
        request.onupgradeneeded = (event) => {
            upgradeSkkDatabase(request, event.oldVersion, additionalStore);
        };
        request.onsuccess = () => resolve(request.result);
    });
}
