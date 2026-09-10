import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Candidate } from "../../src/core/skk/jisyo/candidate";
import { DictionaryLoader, DictionarySourceError, type DictionaryDefinition } from "../../src/storage/jisyo/DictionaryLoader";
import { IndexedDbJisyoStore } from "../../src/storage/jisyo/IndexedDbJisyoStore";
import { DEFAULT_STARTER_DICTIONARY_ID } from "../../src/storage/indexedDbSchema";

const encoder = new TextEncoder();
const stores: IndexedDbJisyoStore[] = [];
const databaseNames = new Set<string>();

function databaseName(label: string): string {
    const name = `test_loader_${label}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    databaseNames.add(name);
    return name;
}

function definition(dictId: string, dictPath: string, version: string, format: "text" | "json"): DictionaryDefinition {
    return { dictId, dictPath, version, format };
}

function jsonDictionary(
    okuriAri: Record<string, string[]> = {},
    okuriNasi: Record<string, string[]> = {},
): string {
    return JSON.stringify({
        copyright: "test",
        license: "test",
        version: "1",
        okuri_ari: okuriAri,
        okuri_nasi: okuriNasi,
    });
}

function mockSources(sources: Record<string, string>): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(DictionaryLoader, "fetchDictionaryBuffer")
        .mockImplementation(async (_url, path) => {
            const source = sources[path ?? ""];
            if (source === undefined) throw new Error(`missing source: ${path}`);
            return encoder.encode(source);
        });
}

async function seedCompletedLegacy(name: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, 3);
        request.onupgradeneeded = () => {
            request.result.createObjectStore("system_jisyo", { keyPath: "key" });
            request.result.createObjectStore("user_jisyo", { keyPath: "key" });
            request.result.createObjectStore("system_metadata", { keyPath: "dictId" });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(["system_jisyo", "system_metadata"], "readwrite");
            tx.objectStore("system_jisyo").put({
                key: "れがしー",
                candidates: [{ word: "旧候補", annotation: "保持対象" }],
            });
            tx.objectStore("system_metadata").put({
                dictId: "dict/SKK-JISYO.S",
                version: "1.0.0",
                completed: true,
                entryCount: 1,
                timestamp: 1,
            });
            tx.oncomplete = () => {
                db.close();
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        };
    });
}

afterEach(async () => {
    vi.restoreAllMocks();
    for (const store of stores.splice(0)) {
        if (store.isOpen) store.close();
    }
    for (const name of databaseNames) await IndexedDbJisyoStore.deleteDatabase(name);
    databaseNames.clear();
});

describe("DictionaryLoader v4", () => {
    it("既存の単一辞書 API で同梱テキスト辞書を初期化して再読込を省略する", async () => {
        const store = new IndexedDbJisyoStore({ dbName: databaseName("default") });
        stores.push(store);

        const first = await DictionaryLoader.ensureInitialized(store);
        const second = await DictionaryLoader.ensureInitialized(store);

        expect(first).toBeGreaterThan(200);
        expect(second).toBe(0);
        expect((await store.lookup("わらu"))?.getCandidateList().map((candidate) => candidate.word)).toContain("笑");
    });

    it("既存の単一辞書 API でカスタム辞書 ID を初期化して検索対象にする", async () => {
        const store = new IndexedDbJisyoStore({ dbName: databaseName("custom-id") });
        stores.push(store);
        mockSources({ "dict/custom.txt": "かすたむ /初期候補/\n" });

        const imported = await DictionaryLoader.ensureInitialized(store, {
            dictId: "custom",
            dictPath: "dict/custom.txt",
            version: "1",
            format: "text",
        });

        expect(imported).toBe(1);
        expect(store.configuredDictionaryIds).toEqual(["custom"]);
        expect((await store.lookup("かすたむ"))?.getCandidateList()[0]?.word).toBe("初期候補");
        expect(await store.isImportCompleted("custom", "1")).toBe(true);
    });

    it("既存の単一辞書 API でカスタム辞書 ID の版を置換する", async () => {
        const store = new IndexedDbJisyoStore({ dbName: databaseName("custom-version") });
        stores.push(store);
        mockSources({
            "dict/custom-v1.txt": "ふるい /旧候補/\n共通 /更新前/\n",
            "dict/custom-v2.txt": "共通 /更新後/\n",
        });

        await DictionaryLoader.ensureInitialized(store, {
            dictId: "custom",
            dictPath: "dict/custom-v1.txt",
            version: "1",
            format: "text",
        });
        const imported = await DictionaryLoader.ensureInitialized(store, {
            dictId: "custom",
            dictPath: "dict/custom-v2.txt",
            version: "2",
            format: "text",
        });

        expect(imported).toBe(1);
        expect(await store.lookup("ふるい")).toBeUndefined();
        expect((await store.lookup("共通"))?.getCandidateList()[0]?.word).toBe("更新後");
        expect((await store.getImportStatus("custom"))?.version).toBe("2");
    });

    it("明示した辞書順を既存の単一辞書 API から変更しない", async () => {
        const store = new IndexedDbJisyoStore({
            dbName: databaseName("explicit-order"),
            dictionaryIds: [DEFAULT_STARTER_DICTIONARY_ID],
        });
        stores.push(store);

        await expect(DictionaryLoader.ensureInitialized(store, {
            dictId: "custom",
            dictPath: "dict/custom.txt",
        })).rejects.toThrow("without explicit dictionaryIds");
        expect(store.configuredDictionaryIds).toEqual([DEFAULT_STARTER_DICTIONARY_ID]);
    });

    it("単一辞書の初期化中に別のカスタム辞書 ID へ切り替えない", async () => {
        const store = new IndexedDbJisyoStore({ dbName: databaseName("custom-concurrent") });
        stores.push(store);
        let releaseFetch!: () => void;
        const fetchGate = new Promise<void>((resolve) => {
            releaseFetch = resolve;
        });
        vi.spyOn(DictionaryLoader, "fetchDictionaryBuffer").mockImplementation(async () => {
            await fetchGate;
            return encoder.encode("key /first/\n");
        });

        const first = DictionaryLoader.ensureInitialized(store, {
            dictId: "first",
            dictPath: "dict/first.txt",
        });
        await expect(DictionaryLoader.ensureInitialized(store, {
            dictId: "second",
            dictPath: "dict/second.txt",
        })).rejects.toThrow("new store");
        expect(store.configuredDictionaryIds).toEqual(["first"]);

        releaseFetch();
        await expect(first).resolves.toBe(1);
        expect((await store.lookup("key"))?.getCandidateList()[0]?.word).toBe("first");
    });

    it("テキストと JSON を設定順で共存させ、最初の注釈を保持する", async () => {
        const definitions = [
            definition("text", "dict/primary.txt", "1", "text"),
            definition("json", "dict/secondary.json", "1", "json"),
        ] as const;
        const store = new IndexedDbJisyoStore({
            dbName: databaseName("mixed"),
            dictionaryIds: definitions.map((item) => item.dictId),
        });
        stores.push(store);
        mockSources({
            "dict/primary.txt": "かんじ /漢字;テキスト注釈/感じ/\n",
            "dict/secondary.json": jsonDictionary({}, { かんじ: ["漢字", "幹事"] }),
        });

        const results = await DictionaryLoader.ensureDictionaries(store, definitions);
        const candidates = (await store.lookup("かんじ"))?.getCandidateList();

        expect(results.map((result) => result.status)).toEqual(["imported", "imported"]);
        expect(candidates?.map((candidate) => [candidate.word, candidate.annotation])).toEqual([
            ["漢字", "テキスト注釈"],
            ["感じ", undefined],
            ["幹事", undefined],
        ]);
    });

    it("catalog が残っていても実レコードを失った同版辞書を再読込する", async () => {
        const store = new IndexedDbJisyoStore({ dbName: databaseName("repair"), dictionaryIds: ["main"] });
        stores.push(store);
        const fetchSpy = mockSources({ "dict/main.txt": "key /value/\n" });
        const definitions = [definition("main", "dict/main.txt", "1", "text")];
        await DictionaryLoader.ensureDictionaries(store, definitions);
        const active = await store.getActiveDictionary("main");
        await store.deleteGeneration("main", active!.activeGeneration!);

        const [result] = await DictionaryLoader.ensureDictionaries(store, definitions);

        expect(result?.status).toBe("imported");
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect((await store.lookup("key"))?.getCandidateList()[0]?.word).toBe("value");
    });

    it("更新成功後に旧版だけの見出しを返さない", async () => {
        const store = new IndexedDbJisyoStore({ dbName: databaseName("replace"), dictionaryIds: ["main"] });
        stores.push(store);
        mockSources({
            "dict/v1.txt": "ふるい /古い/\n共通 /旧候補/\n",
            "dict/v2.txt": "共通 /新候補/\n",
        });

        await DictionaryLoader.ensureDictionaries(store, [definition("main", "dict/v1.txt", "1", "text")]);
        await DictionaryLoader.ensureDictionaries(store, [definition("main", "dict/v2.txt", "2", "text")]);

        expect(await store.lookup("ふるい")).toBeUndefined();
        expect((await store.lookup("共通"))?.getCandidateList()[0]?.word).toBe("新候補");
        expect((await store.getImportStatus("main"))?.version).toBe("2");
    });

    it.each([
        { label: "空 JSON", path: "dict/empty.json", format: "json" as const, source: jsonDictionary() },
        { label: "空白とコメントだけのテキスト", path: "dict/empty.txt", format: "text" as const, source: " \n;; comment\n" },
    ])("$label を有効な空辞書として公開して旧語を隠す", async ({ path, format, source }) => {
        const store = new IndexedDbJisyoStore({ dbName: databaseName(`empty-${format}`), dictionaryIds: ["main"] });
        stores.push(store);
        mockSources({
            "dict/old.txt": "ふるい /古い/\n",
            [path]: source,
        });
        await DictionaryLoader.ensureDictionaries(store, [definition("main", "dict/old.txt", "1", "text")]);

        const [result] = await DictionaryLoader.ensureDictionaries(store, [definition("main", path, "2", format)]);

        expect(result?.entryCount).toBe(0);
        expect(await store.lookup("ふるい")).toBeUndefined();
        expect(await store.isImportCompleted("main", "2")).toBe(true);
    });

    it.each([
        { label: "不正 JSON", path: "dict/bad.json", format: "json" as const, source: "{" },
        { label: "有効行がない非空テキスト", path: "dict/bad.txt", format: "text" as const, source: "invalid data" },
    ])("$label は旧版を壊さず拒否する", async ({ path, format, source }) => {
        const store = new IndexedDbJisyoStore({ dbName: databaseName(`bad-${format}`), dictionaryIds: ["main"] });
        stores.push(store);
        mockSources({
            "dict/old.txt": "key /old/\n",
            [path]: source,
        });
        await DictionaryLoader.ensureDictionaries(store, [definition("main", "dict/old.txt", "1", "text")]);

        await expect(DictionaryLoader.ensureDictionaries(
            store,
            [definition("main", path, "2", format)],
        )).rejects.toThrow(format === "text" ? DictionarySourceError : Error);
        expect((await store.lookup("key"))?.getCandidateList()[0]?.word).toBe("old");
        expect((await store.getImportStatus("main"))?.version).toBe("1");
    });

    it("旧テキスト starter から最初の JSON 更新が失敗しても安定IDの旧辞書を保持する", async () => {
        const name = databaseName("legacy-json-failure");
        await seedCompletedLegacy(name);
        const store = new IndexedDbJisyoStore({ dbName: name });
        stores.push(store);
        mockSources({ "dict/SKK-JISYO.S.json": "{" });

        await expect(DictionaryLoader.ensureDictionaries(store, [{
            dictId: DEFAULT_STARTER_DICTIONARY_ID,
            dictPath: "dict/SKK-JISYO.S.json",
            version: "official-json",
            format: "json",
        }])).rejects.toThrow();

        expect((await store.lookup("れがしー"))?.getCandidateList()[0]).toMatchObject({
            word: "旧候補",
            annotation: "保持対象",
        });
        expect((await store.getActiveDictionary(DEFAULT_STARTER_DICTIONARY_ID))?.storage).toBe("legacy");
    });

    it("取得失敗時に旧版と別辞書を保持する", async () => {
        const definitions = [
            definition("main", "dict/main-v1.txt", "1", "text"),
            definition("other", "dict/other.txt", "1", "text"),
        ];
        const store = new IndexedDbJisyoStore({
            dbName: databaseName("fetch-failure"),
            dictionaryIds: definitions.map((item) => item.dictId),
        });
        stores.push(store);
        mockSources({
            "dict/main-v1.txt": "main /old/\n",
            "dict/other.txt": "other /safe/\n",
        });
        await DictionaryLoader.ensureDictionaries(store, definitions);
        vi.spyOn(DictionaryLoader, "fetchDictionaryBuffer").mockRejectedValueOnce(new Error("network failed"));

        await expect(DictionaryLoader.ensureDictionaries(store, [
            definition("main", "dict/main-v2.txt", "2", "text"),
            definitions[1]!,
        ])).rejects.toThrow("network failed");
        expect((await store.lookup("main"))?.getCandidateList()[0]?.word).toBe("old");
        expect((await store.lookup("other"))?.getCandidateList()[0]?.word).toBe("safe");
    });

    it("チャンク書込失敗時に部分世代を破棄し、再試行できる", async () => {
        const store = new IndexedDbJisyoStore({ dbName: databaseName("chunk-failure"), dictionaryIds: ["main"] });
        stores.push(store);
        mockSources({
            "dict/v1.txt": "key /old/\n",
            "dict/v2.txt": "key /new/\npartial /partial/\n",
        });
        await DictionaryLoader.ensureDictionaries(store, [definition("main", "dict/v1.txt", "1", "text")]);

        const originalStage = store.stageGeneration.bind(store);
        const stageSpy = vi.spyOn(store, "stageGeneration").mockImplementationOnce(async (
            dictId,
            generation,
            sourceEntries,
        ) => {
            const first = [...sourceEntries].slice(0, 1);
            await originalStage(dictId, generation, first, 1);
            throw new Error("chunk failed");
        });
        await expect(DictionaryLoader.ensureDictionaries(
            store,
            [definition("main", "dict/v2.txt", "2", "text")],
        )).rejects.toThrow("chunk failed");
        expect((await store.lookup("key"))?.getCandidateList()[0]?.word).toBe("old");

        stageSpy.mockRestore();
        await DictionaryLoader.ensureDictionaries(store, [definition("main", "dict/v2.txt", "2", "text")]);
        expect((await store.lookup("key"))?.getCandidateList()[0]?.word).toBe("new");
        expect((await store.lookup("partial"))?.getCandidateList()[0]?.word).toBe("partial");
    });

    it("公開 transaction 失敗時に旧版を保持する", async () => {
        const store = new IndexedDbJisyoStore({ dbName: databaseName("publish-failure"), dictionaryIds: ["main"] });
        stores.push(store);
        mockSources({
            "dict/v1.txt": "key /old/\n",
            "dict/v2.txt": "key /new/\n",
        });
        await DictionaryLoader.ensureDictionaries(store, [definition("main", "dict/v1.txt", "1", "text")]);
        const publishSpy = vi.spyOn(store, "publishGeneration").mockRejectedValueOnce(new Error("publish failed"));

        await expect(DictionaryLoader.ensureDictionaries(
            store,
            [definition("main", "dict/v2.txt", "2", "text")],
        )).rejects.toThrow("publish failed");
        expect((await store.lookup("key"))?.getCandidateList()[0]?.word).toBe("old");
        publishSpy.mockRestore();
    });

    it("同じ factory・DB・辞書の同版初期化をインスタンス間で直列化する", async () => {
        const name = databaseName("queue-same");
        const firstStore = new IndexedDbJisyoStore({ dbName: name, dictionaryIds: ["main"] });
        const secondStore = new IndexedDbJisyoStore({ dbName: name, dictionaryIds: ["main"] });
        stores.push(firstStore, secondStore);
        const fetchSpy = mockSources({ "dict/main.txt": "key /value/\n" });
        const def = [definition("main", "dict/main.txt", "1", "text")];

        const [first, second] = await Promise.all([
            DictionaryLoader.ensureDictionaries(firstStore, def),
            DictionaryLoader.ensureDictionaries(secondStore, def),
        ]);

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect([first[0]?.status, second[0]?.status].sort()).toEqual(["current", "imported"]);
    });

    it("異なる版と force を同一辞書で誤って合流させない", async () => {
        const name = databaseName("queue-version");
        const firstStore = new IndexedDbJisyoStore({ dbName: name, dictionaryIds: ["main"] });
        const secondStore = new IndexedDbJisyoStore({ dbName: name, dictionaryIds: ["main"] });
        stores.push(firstStore, secondStore);
        const fetchSpy = mockSources({
            "dict/v1.txt": "key /one/\n",
            "dict/v2.txt": "key /two/\n",
        });

        await Promise.all([
            DictionaryLoader.ensureDictionaries(firstStore, [definition("main", "dict/v1.txt", "1", "text")]),
            DictionaryLoader.ensureDictionaries(secondStore, [definition("main", "dict/v2.txt", "2", "text")]),
        ]);
        expect((await firstStore.lookup("key"))?.getCandidateList()[0]?.word).toBe("two");
        expect((await firstStore.getImportStatus("main"))?.version).toBe("2");

        await Promise.all([
            DictionaryLoader.ensureDictionaries(firstStore, [definition("main", "dict/v2.txt", "2", "text")], { force: true }),
            DictionaryLoader.ensureDictionaries(secondStore, [definition("main", "dict/v2.txt", "2", "text")], { force: true }),
        ]);
        expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it("未設定の辞書を別辞書の件数で完了扱いしない", async () => {
        const store = new IndexedDbJisyoStore({
            dbName: databaseName("missing"),
            dictionaryIds: ["present", "missing"],
        });
        stores.push(store);
        await store.stageGeneration("present", "present-generation", [{
            key: "key",
            candidates: [new Candidate("value")],
        }]);
        expect(await store.publishGeneration(
            { dictId: "present", version: "1", activeGeneration: "present-generation", entryCount: 1 },
            0,
        )).toBe(true);

        expect(await store.isImportCompleted("present", "1")).toBe(true);
        expect(await store.isImportCompleted("missing", "1")).toBe(false);
    });

    it("進捗を辞書ID付きで通知する", async () => {
        const store = new IndexedDbJisyoStore({ dbName: databaseName("progress"), dictionaryIds: ["main"] });
        stores.push(store);
        mockSources({ "dict/main.txt": "a /A/\nb /B/\nc /C/\n" });
        const progress = vi.fn();

        await DictionaryLoader.ensureDictionaries(
            store,
            [definition("main", "dict/main.txt", "1", "text")],
            { batchSize: 2, onProgress: progress },
        );

        expect(progress.mock.calls).toEqual([["main", 2], ["main", 3]]);
    });

    it("定義順がストア設定と異なる場合は開始前に拒否する", async () => {
        const store = new IndexedDbJisyoStore({
            dbName: databaseName("order-mismatch"),
            dictionaryIds: ["a", "b"],
        });
        stores.push(store);
        await expect(DictionaryLoader.ensureDictionaries(store, [
            definition("b", "b.txt", "1", "text"),
            definition("a", "a.txt", "1", "text"),
        ])).rejects.toThrow("same order");
    });

    it("安定した starter ID を既定値として使用する", async () => {
        const store = new IndexedDbJisyoStore({ dbName: databaseName("stable-id") });
        stores.push(store);
        mockSources({ "dict/SKK-JISYO.S": "key /value/\n" });

        await DictionaryLoader.ensureInitialized(store);

        expect(await store.isImportCompleted(DEFAULT_STARTER_DICTIONARY_ID, "1.0.0")).toBe(true);
    });
});
