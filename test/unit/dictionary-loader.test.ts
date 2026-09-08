import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IndexedDbJisyoStore } from "../../src/storage/jisyo/IndexedDbJisyoStore";
import { DictionaryLoader } from "../../src/storage/jisyo/DictionaryLoader";

describe("DictionaryLoader", () => {
    let store: IndexedDbJisyoStore;
    let testDbName: string;

    beforeEach(() => {
        testDbName = `test_dict_loader_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        store = new IndexedDbJisyoStore({ dbName: testDbName });
    });

    afterEach(async () => {
        if (store.isOpen) {
            store.close();
        }
        await IndexedDbJisyoStore.deleteDatabase(testDbName);
    });

    it("loads and imports bundled starter dictionary into empty store", async () => {
        const initialCount = await store.count();
        expect(initialCount).toBe(0);

        const importedCount = await DictionaryLoader.ensureInitialized(store);
        expect(importedCount).toBeGreaterThan(200);

        const afterCount = await store.count();
        expect(afterCount).toBe(importedCount);

        // Verify entries from SKK-JISYO.S
        const entryWarau = await store.lookup("わらu");
        expect(entryWarau).toBeDefined();
        expect(entryWarau?.getCandidateList().map((c) => c.word)).toContain("笑");

        const entryWarai = await store.lookup("わらi");
        expect(entryWarai).toBeDefined();
        expect(entryWarai?.getCandidateList().map((c) => c.word)).toContain("笑");
    });

    it("skips loading if store is already populated", async () => {
        await DictionaryLoader.ensureInitialized(store);
        const countFirst = await store.count();
        expect(countFirst).toBeGreaterThan(0);

        // Second call should return 0 without re-importing
        const countSecond = await DictionaryLoader.ensureInitialized(store);
        expect(countSecond).toBe(0);

        const countAfter = await store.count();
        expect(countAfter).toBe(countFirst);
    });

    it("re-imports when force option is true", async () => {
        await DictionaryLoader.ensureInitialized(store);
        const countFirst = await store.count();
        expect(countFirst).toBeGreaterThan(0);

        const reimported = await DictionaryLoader.ensureInitialized(store, { force: true });
        expect(reimported).toBe(countFirst);
    });

    it("marks dictionary import completed with metadata record", async () => {
        await DictionaryLoader.ensureInitialized(store, { dictId: "test_dict", version: "1.0.0" });

        const status = await store.getImportStatus("test_dict");
        expect(status).toBeDefined();
        expect(status?.completed).toBe(true);
        expect(status?.version).toBe("1.0.0");
        expect(status?.entryCount).toBeGreaterThan(200);
        expect(await store.isImportCompleted("test_dict", "1.0.0")).toBe(true);
    });

    it("recovers from interrupted / partial import by clearing partial data and re-importing", async () => {
        // Simulate an interrupted import: store has 1 entry, but status is unrecorded or completed=false
        await store.importEntries([
            { key: "partial_key", candidates: [{ word: "partial_word" } as any] },
        ]);
        expect(await store.count()).toBe(1);

        // Import status marked incomplete
        await store.setImportStatus({
            dictId: "dict/SKK-JISYO.S",
            version: "1.0.0",
            completed: false,
            entryCount: 1,
            timestamp: Date.now(),
        });

        // ensureInitialized should detect incomplete status, clear partial entry, and perform full import
        const imported = await DictionaryLoader.ensureInitialized(store);
        expect(imported).toBeGreaterThan(200);

        // Partial entry should have been replaced
        const partialLookup = await store.lookup("partial_key");
        expect(partialLookup).toBeUndefined();

        const completedStatus = await store.getImportStatus("dict/SKK-JISYO.S");
        expect(completedStatus?.completed).toBe(true);
    });

    it("re-imports when dictionary version changes", async () => {
        // Initial import with v1.0.0
        await DictionaryLoader.ensureInitialized(store, { dictId: "ver_test", version: "1.0.0" });
        const v1Status = await store.getImportStatus("ver_test");
        expect(v1Status?.version).toBe("1.0.0");

        // Requesting with v2.0.0 should re-import
        const reimported = await DictionaryLoader.ensureInitialized(store, { dictId: "ver_test", version: "2.0.0" });
        expect(reimported).toBeGreaterThan(200);

        const v2Status = await store.getImportStatus("ver_test");
        expect(v2Status?.version).toBe("2.0.0");
        expect(v2Status?.completed).toBe(true);
    });
});
