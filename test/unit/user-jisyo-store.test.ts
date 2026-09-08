import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { IndexedDbUserStore } from "../../src/storage/user-jisyo/IndexedDbUserStore";
import { IndexedDbJisyoStore } from "../../src/storage/jisyo/IndexedDbJisyoStore";
import { Candidate } from "../../src/core/skk/jisyo/candidate";

describe("IndexedDbUserStore", () => {
    let store: IndexedDbUserStore;
    let testDbName: string;

    beforeEach(async () => {
        testDbName = `test_user_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        store = new IndexedDbUserStore({ dbName: testDbName });
    });

    afterEach(async () => {
        if (store.isOpen) {
            store.close();
        }
        await IndexedDbUserStore.deleteDatabase(testDbName);
    });

    describe("Initialization & Lifecycle", () => {
        it("initializes and creates user_jisyo object store", async () => {
            expect(store.isOpen).toBe(false);
            await store.init();
            expect(store.isOpen).toBe(true);
        });

        it("handles concurrent init() calls without multiple opens", async () => {
            const openSpy = vi.spyOn(indexedDB, "open");

            await Promise.all([store.init(), store.init(), store.count(), store.loadUserEntries()]);

            expect(store.isOpen).toBe(true);
            expect(openSpy).toHaveBeenCalledTimes(1);

            openSpy.mockRestore();
        });

        it("closes connection and updates isOpen state", async () => {
            await store.init();
            expect(store.isOpen).toBe(true);
            store.close();
            expect(store.isOpen).toBe(false);
        });
    });

    describe("saveCandidate & loadUserEntries", () => {
        it("saves candidate to front and loads all entries", async () => {
            await store.saveCandidate("とうきょう", new Candidate("東京"));
            await store.saveCandidate("とうきょう", new Candidate("とうきょう"));

            const entries = await store.loadUserEntries();
            expect(entries.size).toBe(1);

            const cands = entries.get("とうきょう")!;
            expect(cands).toHaveLength(2);
            // Most recently saved is promoted to the front (LRU)
            expect(cands[0]!.word).toBe("とうきょう");
            expect(cands[1]!.word).toBe("東京");
        });

        it("re-saving an existing candidate moves it to index 0 without duplicates", async () => {
            await store.saveCandidate("へんかん", new Candidate("変換"));
            await store.saveCandidate("へんかん", new Candidate("返還"));
            await store.saveCandidate("へんかん", new Candidate("変漢"));

            let entries = await store.loadUserEntries();
            expect(entries.get("へんかん")?.map((c) => c.word)).toEqual(["変漢", "返還", "変換"]);

            // Re-save "変換"
            await store.saveCandidate("へんかん", new Candidate("変換"));
            entries = await store.loadUserEntries();
            expect(entries.get("へんかん")?.map((c) => c.word)).toEqual(["変換", "変漢", "返還"]);
        });

        it("preserves annotations when saving candidates", async () => {
            await store.saveCandidate("にほん", new Candidate("日本", "にほん"));
            const entries = await store.loadUserEntries();
            const cand = entries.get("にほん")?.[0];
            expect(cand).toBeDefined();
            expect(cand!.word).toBe("日本");
            expect(cand!.annotation).toBe("にほん");
        });
    });

    describe("reorderCandidate", () => {
        it("promotes candidate at selectedIndex to index 0", async () => {
            await store.saveCandidate("test", new Candidate("c1"));
            await store.saveCandidate("test", new Candidate("c2"));
            await store.saveCandidate("test", new Candidate("c3"));
            // Current order: ["c3", "c2", "c1"]

            const success = await store.reorderCandidate("test", 2);
            expect(success).toBe(true);

            const entries = await store.loadUserEntries();
            expect(entries.get("test")?.map((c) => c.word)).toEqual(["c1", "c3", "c2"]);
        });

        it("returns false for non-existent key or out-of-range index", async () => {
            await store.saveCandidate("test", new Candidate("c1"));

            expect(await store.reorderCandidate("non_existent", 0)).toBe(false);
            expect(await store.reorderCandidate("test", -1)).toBe(false);
            expect(await store.reorderCandidate("test", 5)).toBe(false);
        });

        it("promotes candidate by Candidate object", async () => {
            await store.saveCandidate("test", new Candidate("c1"));
            await store.saveCandidate("test", new Candidate("c2"));
            await store.saveCandidate("test", new Candidate("c3"));
            // Current order: ["c3", "c2", "c1"]

            const success = await store.reorderCandidate("test", new Candidate("c1"));
            expect(success).toBe(true);

            const entries = await store.loadUserEntries();
            expect(entries.get("test")?.map((c) => c.word)).toEqual(["c1", "c3", "c2"]);
        });

        it("promotes candidate by word string", async () => {
            await store.saveCandidate("test", new Candidate("c1"));
            await store.saveCandidate("test", new Candidate("c2"));
            await store.saveCandidate("test", new Candidate("c3"));
            // Current order: ["c3", "c2", "c1"]

            const success = await store.reorderCandidate("test", "c2");
            expect(success).toBe(true);

            const entries = await store.loadUserEntries();
            expect(entries.get("test")?.map((c) => c.word)).toEqual(["c2", "c3", "c1"]);
        });

        it("returns false when candidate object or word is not found", async () => {
            await store.saveCandidate("test", new Candidate("c1"));
            expect(await store.reorderCandidate("test", new Candidate("not_found"))).toBe(false);
            expect(await store.reorderCandidate("test", "not_found")).toBe(false);
        });
    });

    describe("deleteCandidate", () => {
        it("deletes a specific candidate from entry", async () => {
            await store.saveCandidate("test", new Candidate("c1"));
            await store.saveCandidate("test", new Candidate("c2"));

            const deleted = await store.deleteCandidate("test", new Candidate("c1"));
            expect(deleted).toBe(true);

            const entries = await store.loadUserEntries();
            expect(entries.get("test")?.map((c) => c.word)).toEqual(["c2"]);
        });

        it("removes key entry completely when last candidate is deleted", async () => {
            await store.saveCandidate("single", new Candidate("only"));
            expect((await store.loadUserEntries()).has("single")).toBe(true);

            await store.deleteCandidate("single", new Candidate("only"));
            const entries = await store.loadUserEntries();
            expect(entries.has("single")).toBe(false);
            expect(await store.count()).toBe(0);
        });

        it("returns false when deleting non-existent key or non-existent candidate", async () => {
            expect(await store.deleteCandidate("unknown", new Candidate("c1"))).toBe(false);

            await store.saveCandidate("k", new Candidate("w1"));
            expect(await store.deleteCandidate("k", new Candidate("w2"))).toBe(false);
        });
    });

    describe("Bulk Save & Maintenance", () => {
        it("bulk saves entries via saveUserEntries", async () => {
            const bulkMap = new Map<string, Candidate[]>([
                ["a", [new Candidate("A1"), new Candidate("A2")]],
                ["b", [new Candidate("B1")]],
            ]);

            const success = await store.saveUserEntries(bulkMap);
            expect(success).toBe(true);

            const loaded = await store.loadUserEntries();
            expect(loaded.size).toBe(2);
            expect(loaded.get("a")?.map((c) => c.word)).toEqual(["A1", "A2"]);
            expect(loaded.get("b")?.map((c) => c.word)).toEqual(["B1"]);
        });

        it("clears all records via clear()", async () => {
            await store.saveCandidate("k1", new Candidate("w1"));
            await store.saveCandidate("k2", new Candidate("w2"));
            expect(await store.count()).toBe(2);

            await store.clear();
            expect(await store.count()).toBe(0);
            expect((await store.loadUserEntries()).size).toBe(0);
        });

        it("throws error when operations are called on closed store", async () => {
            await store.init();
            store.close();

            await expect(store.loadUserEntries()).rejects.toThrow("IndexedDbUserStore is closed");
            await expect(store.saveCandidate("k", new Candidate("w"))).rejects.toThrow(
                "IndexedDbUserStore is closed"
            );
            await expect(store.reorderCandidate("k", 0)).rejects.toThrow("IndexedDbUserStore is closed");
            await expect(store.deleteCandidate("k", new Candidate("w"))).rejects.toThrow(
                "IndexedDbUserStore is closed"
            );
        });
    });

    describe("Persistence Across Re-instantiation", () => {
        it("persists user entries across store close and re-opening", async () => {
            await store.saveCandidate("とうきょう", new Candidate("東京"));
            await store.saveCandidate("にほん", new Candidate("日本", "にほん"));
            store.close();

            // Re-instantiate a new store against the same database name
            const store2 = new IndexedDbUserStore({ dbName: testDbName });
            const loaded = await store2.loadUserEntries();

            expect(loaded.size).toBe(2);
            expect(loaded.get("とうきょう")?.[0]?.word).toBe("東京");
            expect(loaded.get("にほん")?.[0]?.annotation).toBe("にほん");

            store2.close();
        });

        it("coexists with IndexedDbJisyoStore in the same database without conflicts", async () => {
            // Write system dictionary entry
            const systemStore = new IndexedDbJisyoStore({ dbName: testDbName });
            await systemStore.importEntries([
                { key: "とうきょう", candidates: [new Candidate("東京-system")] },
            ]);
            systemStore.close();

            // Write user dictionary entry
            const userStore = new IndexedDbUserStore({ dbName: testDbName });
            await userStore.saveCandidate("とうきょう", new Candidate("東京-user"));
            userStore.close();

            // Both stores can read their respective entries independently
            const sys = new IndexedDbJisyoStore({ dbName: testDbName });
            const usr = new IndexedDbUserStore({ dbName: testDbName });

            const sysEntry = await sys.lookup("とうきょう");
            expect(sysEntry?.getCandidateList()[0]?.word).toBe("東京-system");

            const usrEntries = await usr.loadUserEntries();
            expect(usrEntries.get("とうきょう")?.[0]?.word).toBe("東京-user");

            sys.close();
            usr.close();
        });
    });
});
