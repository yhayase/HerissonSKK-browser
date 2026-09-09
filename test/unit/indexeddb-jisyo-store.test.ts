import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Candidate } from "../../src/core/skk/jisyo/candidate";
import type { JisyoEntry } from "../../src/core/skk/jisyo/JisyoParser";
import { IndexedDbJisyoStore } from "../../src/storage/jisyo/IndexedDbJisyoStore";
import { IndexedDbUserStore } from "../../src/storage/user-jisyo/IndexedDbUserStore";
import { DEFAULT_STARTER_DICTIONARY_ID } from "../../src/storage/indexedDbSchema";

const openedStores: Array<IndexedDbJisyoStore | IndexedDbUserStore> = [];
const databaseNames = new Set<string>();

function databaseName(label: string): string {
    const name = `test_${label}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    databaseNames.add(name);
    return name;
}

function entries(values: Record<string, Array<[string, string?]>>): JisyoEntry[] {
    return Object.entries(values).map(([key, candidates]) => ({
        key,
        candidates: candidates.map(([word, annotation]) => new Candidate(word, annotation)),
    }));
}

async function activate(
    store: IndexedDbJisyoStore,
    dictId: string,
    version: string,
    values: Record<string, Array<[string, string?]>>,
    generation = `generation-${Math.random().toString(36).slice(2)}`,
): Promise<string> {
    const active = await store.getActiveDictionary(dictId);
    const count = await store.stageGeneration(dictId, generation, entries(values), 2);
    const published = await store.publishGeneration(
        { dictId, version, activeGeneration: generation, entryCount: count },
        active?.revision ?? 0,
    );
    expect(published).toBe(true);
    return generation;
}

async function seedLegacyDatabase(
    name: string,
    version: 1 | 2 | 3,
    completed = true,
): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onupgradeneeded = () => {
            const db = request.result;
            db.createObjectStore("system_jisyo", { keyPath: "key" });
            if (version >= 2) db.createObjectStore("user_jisyo", { keyPath: "key" });
            if (version >= 3) db.createObjectStore("system_metadata", { keyPath: "dictId" });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const db = request.result;
            const stores = ["system_jisyo"];
            if (version >= 2) stores.push("user_jisyo");
            if (version >= 3) stores.push("system_metadata");
            const tx = db.transaction(stores, "readwrite");
            tx.objectStore("system_jisyo").put({
                key: "れがしー",
                candidates: [{ word: "旧候補", annotation: "旧注釈" }],
            });
            if (version >= 2) {
                tx.objectStore("user_jisyo").put({
                    key: "がくしゅう",
                    candidates: [
                        { word: "第二候補", annotation: "二" },
                        { word: "第一候補", annotation: "一" },
                    ],
                    updatedAt: 12345,
                });
            }
            if (version >= 3) {
                tx.objectStore("system_metadata").put({
                    dictId: "dict/SKK-JISYO.S",
                    version: "1.0.0",
                    completed,
                    entryCount: 1,
                    timestamp: 12345,
                });
            }
            tx.oncomplete = () => {
                db.close();
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        };
    });
}

afterEach(async () => {
    for (const store of openedStores.splice(0)) {
        if (store.isOpen) store.close();
    }
    for (const name of databaseNames) await IndexedDbJisyoStore.deleteDatabase(name);
    databaseNames.clear();
    vi.restoreAllMocks();
});

describe("IndexedDbJisyoStore v4", () => {
    it("初期化と同一インスタンスの並行初期化を安全に処理する", async () => {
        const store = new IndexedDbJisyoStore({ dbName: databaseName("init") });
        openedStores.push(store);
        const openSpy = vi.spyOn(indexedDB, "open");

        await Promise.all([store.init(), store.init(), store.lookup("未登録")]);

        expect(store.isOpen).toBe(true);
        expect(openSpy).toHaveBeenCalledTimes(1);
    });

    it("設定順で辞書を合成し、先に現れた語と注釈を保持する", async () => {
        const store = new IndexedDbJisyoStore({
            dbName: databaseName("priority"),
            dictionaryIds: ["primary", "secondary"],
        });
        openedStores.push(store);
        await activate(store, "primary", "1", {
            かんじ: [["漢字", "第一注釈"], ["感じ"]],
        });
        await activate(store, "secondary", "1", {
            かんじ: [["漢字", "第二注釈"], ["幹事"]],
        });

        const result = await store.lookup("かんじ");

        expect(result?.getCandidateList().map((candidate) => [candidate.word, candidate.annotation])).toEqual([
            ["漢字", "第一注釈"],
            ["感じ", undefined],
            ["幹事", undefined],
        ]);
        expect(await store.count()).toBe(2);
    });

    it("辞書順を反転すると重複語の優先注釈も反転する", async () => {
        const name = databaseName("reverse");
        const writer = new IndexedDbJisyoStore({ dbName: name, dictionaryIds: ["a", "b"] });
        openedStores.push(writer);
        await activate(writer, "a", "1", { かな: [["仮名", "A"]] });
        await activate(writer, "b", "1", { かな: [["仮名", "B"]] });

        const reader = new IndexedDbJisyoStore({ dbName: name, dictionaryIds: ["b", "a"] });
        openedStores.push(reader);
        expect((await reader.lookup("かな"))?.getCandidateList()[0]?.annotation).toBe("B");
    });

    it("前方一致を辞書間で合成して辞書式順の全体上限を適用する", async () => {
        const store = new IndexedDbJisyoStore({
            dbName: databaseName("prefix"),
            dictionaryIds: ["a", "b"],
        });
        openedStores.push(store);
        await activate(store, "a", "1", {
            あい: [["愛"]],
            あお: [["青", "A"]],
        });
        await activate(store, "b", "1", {
            あか: [["赤"]],
            あお: [["蒼"], ["青", "B"]],
        });

        const result = await store.lookupPrefix("あ", 2);

        expect(result.map((entry) => entry.getMidashigo())).toEqual(["あい", "あお"]);
        expect((await store.lookup("あお"))?.getCandidateList().map((candidate) => candidate.word)).toEqual(["青", "蒼"]);
    });

    it("空世代を有効化すると旧世代の語を返さない", async () => {
        const store = new IndexedDbJisyoStore({ dbName: databaseName("empty"), dictionaryIds: ["a"] });
        openedStores.push(store);
        const oldGeneration = await activate(store, "a", "1", { ふるい: [["古い"]] });
        const active = await store.getActiveDictionary("a");
        await store.stageGeneration("a", "empty", []);
        expect(await store.publishGeneration(
            { dictId: "a", version: "2", activeGeneration: "empty", entryCount: 0 },
            active!.revision,
        )).toBe(true);
        await store.deleteGeneration("a", oldGeneration);

        expect(await store.lookup("ふるい")).toBeUndefined();
        expect(await store.isImportCompleted("a", "2")).toBe(true);
        expect(await store.count("a")).toBe(0);
    });

    it("catalog と実レコード件数が一致しない辞書を完了扱いしない", async () => {
        const store = new IndexedDbJisyoStore({ dbName: databaseName("integrity"), dictionaryIds: ["a"] });
        openedStores.push(store);
        const generation = await activate(store, "a", "1", { key: [["value"]] });

        await store.deleteGeneration("a", generation);

        expect(await store.isImportCompleted("a", "1")).toBe(false);
    });

    it("revision が変わった公開要求を拒否して現行世代を保持する", async () => {
        const store = new IndexedDbJisyoStore({ dbName: databaseName("cas"), dictionaryIds: ["a"] });
        openedStores.push(store);
        await activate(store, "a", "1", { key: [["current"]] }, "current");
        await store.stageGeneration("a", "loser", entries({ key: [["loser"]] }));

        expect(await store.publishGeneration(
            { dictId: "a", version: "2", activeGeneration: "loser", entryCount: 1 },
            0,
        )).toBe(false);
        expect((await store.lookup("key"))?.getCandidateList()[0]?.word).toBe("current");
    });

    it("公開件数がステージ件数と違う場合は transaction を中断して旧版を保持する", async () => {
        const store = new IndexedDbJisyoStore({ dbName: databaseName("abort"), dictionaryIds: ["a"] });
        openedStores.push(store);
        await activate(store, "a", "1", { key: [["old"]] }, "old");
        const active = await store.getActiveDictionary("a");
        await store.stageGeneration("a", "broken", entries({ key: [["new"]] }));

        await expect(store.publishGeneration(
            { dictId: "a", version: "2", activeGeneration: "broken", entryCount: 2 },
            active!.revision,
        )).rejects.toThrow("publication aborted");
        expect((await store.lookup("key"))?.getCandidateList()[0]?.word).toBe("old");
        expect((await store.getActiveDictionary("a"))?.version).toBe("1");
    });

    it("公開と旧世代削除の間に開始した読み取りは一貫した世代を返す", async () => {
        const store = new IndexedDbJisyoStore({ dbName: databaseName("snapshot"), dictionaryIds: ["a"] });
        openedStores.push(store);
        const oldGeneration = await activate(store, "a", "1", { key: [["old"]] }, "old");
        const active = await store.getActiveDictionary("a");
        await store.stageGeneration("a", "new", entries({ key: [["new"]] }));

        const readBeforePublish = store.lookup("key");
        expect(await store.publishGeneration(
            { dictId: "a", version: "2", activeGeneration: "new", entryCount: 1 },
            active!.revision,
        )).toBe(true);
        await store.deleteGeneration("a", oldGeneration);

        expect((await readBeforePublish)?.getCandidateList()[0]?.word).toBe("old");
        expect((await store.lookup("key"))?.getCandidateList()[0]?.word).toBe("new");
    });

    it("停止済み世代を回収して同一セッションの世代を削除しない", async () => {
        const store = new IndexedDbJisyoStore({ dbName: databaseName("recovery"), dictionaryIds: ["a"] });
        openedStores.push(store);
        await activate(store, "a", "1", { active: [["active"]] }, "active");
        await store.stageGeneration("a", "old-session-orphan", entries({ orphan: [["orphan"]] }));
        await store.stageGeneration("a", "live-session-attempt", entries({ live: [["live"]] }));
        const current = await store.getActiveDictionary("a");

        await store.cleanupAbandonedGenerations("a", "active", "live-session-");
        expect(await store.publishGeneration(
            { dictId: "a", version: "2", activeGeneration: "live-session-attempt", entryCount: 1 },
            current!.revision,
        )).toBe(true);
        expect((await store.lookup("live"))?.getCandidateList()[0]?.word).toBe("live");
    });

    it("close 後の操作を拒否し、明示的な init で再接続できる", async () => {
        const store = new IndexedDbJisyoStore({ dbName: databaseName("close") });
        openedStores.push(store);
        await store.init();
        store.close();
        await expect(store.lookup("key")).rejects.toThrow("closed");

        await store.init();
        expect(store.isOpen).toBe(true);
    });
});

describe.each([
    { version: 1 as const, order: "system-first" },
    { version: 1 as const, order: "user-first" },
    { version: 2 as const, order: "system-first" },
    { version: 2 as const, order: "user-first" },
    { version: 3 as const, order: "system-first" },
    { version: 3 as const, order: "user-first" },
])("v$version migration ($order)", ({ version, order }) => {
    it("旧システム辞書を読み取り可能にしてユーザー学習を保持する", async () => {
        const name = databaseName(`migration-${version}-${order}`);
        await seedLegacyDatabase(name, version);
        const system = new IndexedDbJisyoStore({ dbName: name });
        const user = new IndexedDbUserStore({ dbName: name });
        openedStores.push(system, user);

        if (order === "system-first") {
            await system.init();
            await user.init();
        } else {
            await user.init();
            await system.init();
        }

        expect((await system.lookup("れがしー"))?.getCandidateList()[0]).toMatchObject({
            word: "旧候補",
            annotation: "旧注釈",
        });
        expect((await system.getActiveDictionary(DEFAULT_STARTER_DICTIONARY_ID))?.storage).toBe("legacy");
        if (version >= 2) {
            const learned = (await user.loadUserEntries()).get("がくしゅう");
            expect(learned?.map((candidate) => [candidate.word, candidate.annotation])).toEqual([
                ["第二候補", "二"],
                ["第一候補", "一"],
            ]);
        }
    });
});

describe("v3 incomplete migration", () => {
    it("未完了の旧システム辞書を有効辞書として採用しない", async () => {
        const name = databaseName("migration-incomplete");
        await seedLegacyDatabase(name, 3, false);
        const store = new IndexedDbJisyoStore({ dbName: name });
        openedStores.push(store);

        expect(await store.lookup("れがしー")).toBeUndefined();
        expect(await store.getImportStatus(DEFAULT_STARTER_DICTIONARY_ID)).toBeUndefined();
    });
});

describe("concurrent schema migration", () => {
    it("system と user の同時初期化で学習データを保持する", async () => {
        const name = databaseName("migration-concurrent");
        await seedLegacyDatabase(name, 2);
        const system = new IndexedDbJisyoStore({ dbName: name });
        const user = new IndexedDbUserStore({ dbName: name });
        openedStores.push(system, user);

        await Promise.all([system.init(), user.init()]);

        expect((await system.lookup("れがしー"))?.getCandidateList()[0]?.word).toBe("旧候補");
        expect((await user.loadUserEntries()).get("がくしゅう")?.map((candidate) => candidate.word)).toEqual([
            "第二候補",
            "第一候補",
        ]);
    });

    it("v3 接続による blocked 後も接続解放を待って v4 初期化を完了する", async () => {
        const name = databaseName("migration-blocked");
        await seedLegacyDatabase(name, 3);
        const heldConnection = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(name, 3);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
        heldConnection.onversionchange = () => undefined;

        const openSpy = vi.spyOn(indexedDB, "open");
        const store = new IndexedDbJisyoStore({ dbName: name });
        openedStores.push(store);
        const initPromise = store.init();
        const openRequest = openSpy.mock.results[0]?.value;
        expect(openRequest).toBeDefined();

        let blocked = false;
        openRequest!.addEventListener("blocked", () => {
            blocked = true;
        });
        let settled = false;
        void initPromise.then(
            () => { settled = true; },
            () => { settled = true; },
        );

        await vi.waitFor(() => expect(blocked).toBe(true));
        await Promise.resolve();
        expect(settled).toBe(false);

        heldConnection.close();
        await initPromise;
        expect(store.isOpen).toBe(true);
        store.close();

        const nextVersionStore = new IndexedDbJisyoStore({ dbName: name, version: 5 });
        openedStores.push(nextVersionStore);
        await nextVersionStore.init();
        expect(nextVersionStore.isOpen).toBe(true);
        nextVersionStore.close();
        await expect(IndexedDbJisyoStore.deleteDatabase(name)).resolves.toBeUndefined();
    });
});
