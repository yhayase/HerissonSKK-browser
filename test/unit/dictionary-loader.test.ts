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
});
