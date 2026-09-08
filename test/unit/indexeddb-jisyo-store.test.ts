import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { IndexedDbJisyoStore } from "../../src/storage/jisyo/IndexedDbJisyoStore";
import { Candidate } from "../../src/core/skk/jisyo/candidate";
import type { JisyoEntry } from "../../src/core/skk/jisyo/JisyoParser";

describe("IndexedDbJisyoStore", () => {
    let store: IndexedDbJisyoStore;
    let testDbName: string;

    beforeEach(async () => {
        testDbName = `test_skk_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        store = new IndexedDbJisyoStore({ dbName: testDbName });
    });

    afterEach(async () => {
        if (store.isOpen) {
            store.close();
        }
        await IndexedDbJisyoStore.deleteDatabase(testDbName);
    });

    describe("Initialization & Lifecycle", () => {
        it("initializes and creates object store", async () => {
            expect(store.isOpen).toBe(false);
            await store.init();
            expect(store.isOpen).toBe(true);
        });

        it("handles multiple init() calls safely without error", async () => {
            await store.init();
            await store.init();
            expect(store.isOpen).toBe(true);
        });

        it("handles concurrent initialization without multiple DB opens or race conditions", async () => {
            const openSpy = vi.spyOn(indexedDB, "open");

            // Execute concurrent init and lookup calls before DB is initialized
            const [init1, init2, lookup1, lookup2] = await Promise.all([
                store.init(),
                store.init(),
                store.lookup("key1"),
                store.lookup("key2"),
            ]);

            expect(store.isOpen).toBe(true);
            expect(lookup1).toBeUndefined();
            expect(lookup2).toBeUndefined();
            // indexedDB.open should only be called once for this store
            expect(openSpy).toHaveBeenCalledTimes(1);

            openSpy.mockRestore();
        });

        it("auto-initializes on lookup if init() was not explicitly called", async () => {
            expect(store.isOpen).toBe(false);
            const result = await store.lookup("とうきょう");
            expect(result).toBeUndefined();
            expect(store.isOpen).toBe(true);
        });

        it("closes connection and updates isOpen state", async () => {
            await store.init();
            expect(store.isOpen).toBe(true);
            store.close();
            expect(store.isOpen).toBe(false);
        });
    });

    describe("importEntries", () => {
        it("imports entries from a Map<string, Candidate[]>", async () => {
            const map = new Map<string, Candidate[]>([
                ["とうきょう", [new Candidate("東京"), new Candidate("とうきょう")]],
                ["にほん", [new Candidate("日本", "にほん")]],
            ]);

            const importedCount = await store.importEntries(map);
            expect(importedCount).toBe(2);

            const count = await store.count();
            expect(count).toBe(2);

            const entry = await store.lookup("とうきょう");
            expect(entry).toBeDefined();
            expect(entry!.getMidashigo()).toBe("とうきょう");
            expect(entry!.getCandidateList()).toHaveLength(2);
            expect(entry!.getCandidateList()[0]!.word).toBe("東京");
            expect(entry!.getCandidateList()[1]!.word).toBe("とうきょう");
        });

        it("imports entries from an Iterable of JisyoEntry", async () => {
            const entries: JisyoEntry[] = [
                { key: "いk", candidates: [new Candidate("行"), new Candidate("逝")] },
                { key: "だい>", candidates: [new Candidate("大")] },
                { key: ">さま", candidates: [new Candidate("様")] },
            ];

            const importedCount = await store.importEntries(entries);
            expect(importedCount).toBe(3);

            const ik = await store.lookup("いk");
            expect(ik).toBeDefined();
            expect(ik!.getCandidateList().map((c) => c.word)).toEqual(["行", "逝"]);

            const dai = await store.lookup("だい>");
            expect(dai).toBeDefined();
            expect(dai!.getCandidateList()[0]!.word).toBe("大");
        });

        it("invokes progressCallback across chunked transactions", async () => {
            const entries: JisyoEntry[] = [];
            for (let i = 0; i < 250; i++) {
                entries.push({
                    key: `key_${i}`,
                    candidates: [new Candidate(`word_${i}`)],
                });
            }

            const progressSteps: number[] = [];
            const importedCount = await store.importEntries(entries, 100, (count) => {
                progressSteps.push(count);
            });

            expect(importedCount).toBe(250);
            expect(progressSteps).toEqual([100, 200, 250]);
        });

        it("skips invalid entries with empty keys or empty candidate lists", async () => {
            const entries: JisyoEntry[] = [
                { key: "", candidates: [new Candidate("無効")] },
                { key: "valid", candidates: [new Candidate("有効")] },
                { key: "empty_cands", candidates: [] },
            ];

            const count = await store.importEntries(entries);
            expect(count).toBe(1);

            const valid = await store.lookup("valid");
            expect(valid).toBeDefined();
        });

        it("efficiently handles bulk import of thousands of records", async () => {
            const total = 3000;
            const entries: JisyoEntry[] = [];
            for (let i = 0; i < total; i++) {
                entries.push({
                    key: `k_${i}`,
                    candidates: [new Candidate(`w_${i}`)],
                });
            }

            const importedCount = await store.importEntries(entries, 1000);
            expect(importedCount).toBe(total);

            const count = await store.count();
            expect(count).toBe(total);

            const mid = await store.lookup("k_1500");
            expect(mid).toBeDefined();
            expect(mid!.getCandidateList()[0]!.word).toBe("w_1500");
        });
    });

    describe("lookup (Exact Search)", () => {
        beforeEach(async () => {
            const entries: JisyoEntry[] = [
                {
                    key: "とうきょう",
                    candidates: [new Candidate("東京"), new Candidate("とうきょう")],
                },
                {
                    key: "にほん",
                    candidates: [new Candidate("日本", "にほん"), new Candidate("二本")],
                },
                {
                    key: "DOS/V",
                    candidates: [new Candidate("DOS/V")],
                },
            ];
            await store.importEntries(entries);
        });

        it("returns Entry with candidates for matching key", async () => {
            const entry = await store.lookup("とうきょう");
            expect(entry).toBeDefined();
            expect(entry!.getMidashigo()).toBe("とうきょう");
            expect(entry!.getCandidateList()).toHaveLength(2);
            expect(entry!.getCandidateList()[0]!.word).toBe("東京");
            expect(entry!.getCandidateList()[1]!.word).toBe("とうきょう");
        });

        it("preserves annotations accurately", async () => {
            const entry = await store.lookup("にほん");
            expect(entry).toBeDefined();
            const cands = entry!.getCandidateList();
            expect(cands[0]!.word).toBe("日本");
            expect(cands[0]!.annotation).toBe("にほん");
            expect(cands[1]!.word).toBe("二本");
            expect(cands[1]!.annotation).toBeUndefined();
        });

        it("returns undefined for non-existent key", async () => {
            const entry = await store.lookup("おおさか");
            expect(entry).toBeUndefined();
        });

        it("supports keys with special characters", async () => {
            const entry = await store.lookup("DOS/V");
            expect(entry).toBeDefined();
            expect(entry!.getCandidateList()[0]!.word).toBe("DOS/V");
        });
    });

    describe("lookupPrefix (Prefix Search)", () => {
        beforeEach(async () => {
            const entries: JisyoEntry[] = [
                { key: "とうきょう", candidates: [new Candidate("東京")] },
                { key: "とうきょう>", candidates: [new Candidate("東京都")] },
                { key: "とうきょうえき", candidates: [new Candidate("東京駅")] },
                { key: "とうきょうと", candidates: [new Candidate("東京都")] },
                { key: "とうけい", candidates: [new Candidate("統計")] },
                { key: "と", candidates: [new Candidate("戸")] },
                { key: "おおさか", candidates: [new Candidate("大阪")] },
            ];
            await store.importEntries(entries);
        });

        it("returns all entries starting with prefix", async () => {
            const results = await store.lookupPrefix("とうきょう");
            expect(results).toHaveLength(4);
            const keys = results.map((e) => e.getMidashigo());
            expect(keys).toEqual(["とうきょう", "とうきょう>", "とうきょうえき", "とうきょうと"]);
        });

        it("respects limit parameter", async () => {
            const results = await store.lookupPrefix("とうきょう", 2);
            expect(results).toHaveLength(2);
            expect(results[0]!.getMidashigo()).toBe("とうきょう");
            expect(results[1]!.getMidashigo()).toBe("とうきょう>");
        });

        it("returns empty array for limit <= 0", async () => {
            const results = await store.lookupPrefix("とうきょう", 0);
            expect(results).toEqual([]);

            const negativeResults = await store.lookupPrefix("とうきょう", -1);
            expect(negativeResults).toEqual([]);
        });

        it("returns empty array for non-matching prefix", async () => {
            const results = await store.lookupPrefix("なごや");
            expect(results).toEqual([]);
        });

        it("returns matching entries when prefix is single character", async () => {
            const results = await store.lookupPrefix("と");
            // keys starting with "と": "と", "とうきょう", "とうきょう>", "とうきょうえき", "とうきょうと", "とうけい"
            expect(results).toHaveLength(6);
            expect(results.map((e) => e.getMidashigo())).toContain("と");
            expect(results.map((e) => e.getMidashigo())).toContain("とうけい");
            expect(results.map((e) => e.getMidashigo())).not.toContain("おおさか");
        });
    });

    describe("Maintenance (clear, count, deleteDatabase)", () => {
        it("clears all records from store", async () => {
            await store.importEntries([
                { key: "k1", candidates: [new Candidate("c1")] },
                { key: "k2", candidates: [new Candidate("c2")] },
            ]);
            expect(await store.count()).toBe(2);

            await store.clear();
            expect(await store.count()).toBe(0);

            const result = await store.lookup("k1");
            expect(result).toBeUndefined();
        });

        it("returns 0 for count on empty store", async () => {
            await store.init();
            expect(await store.count()).toBe(0);
        });

        it("deletes database completely using static deleteDatabase", async () => {
            await store.importEntries([{ key: "k1", candidates: [new Candidate("c1")] }]);
            store.close();

            await IndexedDbJisyoStore.deleteDatabase(testDbName);

            // Reopening database should start fresh with count 0
            const newStore = new IndexedDbJisyoStore({ dbName: testDbName });
            expect(await newStore.count()).toBe(0);
            newStore.close();
        });
    });

    describe("Error Handling", () => {
        it("throws error when operations are performed after close()", async () => {
            await store.init();
            store.close();

            await expect(store.lookup("key")).rejects.toThrow("IndexedDbJisyoStore is closed");
            await expect(store.lookupPrefix("pre")).rejects.toThrow("IndexedDbJisyoStore is closed");
            await expect(store.count()).rejects.toThrow("IndexedDbJisyoStore is closed");
            await expect(store.clear()).rejects.toThrow("IndexedDbJisyoStore is closed");
            await expect(store.importEntries([])).rejects.toThrow("IndexedDbJisyoStore is closed");
        });

        it("allows re-initializing after close()", async () => {
            await store.importEntries([{ key: "k1", candidates: [new Candidate("c1")] }]);
            store.close();
            expect(store.isOpen).toBe(false);

            await store.init();
            expect(store.isOpen).toBe(true);
            const entry = await store.lookup("k1");
            expect(entry).toBeDefined();
            expect(entry!.getCandidateList()[0]!.word).toBe("c1");
        });

        it("throws error if IndexedDB is not supported", async () => {
            const noIdbStore = new IndexedDbJisyoStore({
                dbName: "unsupported_test",
                indexedDB: undefined,
            });
            // Temporarily hide global indexedDB
            const orig = globalThis.indexedDB;
            // @ts-expect-error test simulation
            delete globalThis.indexedDB;

            try {
                await expect(noIdbStore.init()).rejects.toThrow(
                    "IndexedDB is not supported in this environment"
                );
            } finally {
                globalThis.indexedDB = orig;
            }
        });
    });

    describe("Query Latency Verification", () => {
        it("operates lookup in < 5ms on a populated dataset", async () => {
            const total = 1000;
            const entries: JisyoEntry[] = [];
            for (let i = 0; i < total; i++) {
                entries.push({
                    key: `latency_key_${i}`,
                    candidates: [new Candidate(`candidate_${i}`)],
                });
            }
            await store.importEntries(entries);

            // Warm up
            await store.lookup("latency_key_0");

            // Measure lookup latency over multiple keys
            const testKeys = ["latency_key_100", "latency_key_500", "latency_key_900", "non_existent"];
            for (const key of testKeys) {
                const start = performance.now();
                await store.lookup(key);
                const duration = performance.now() - start;

                expect(duration).toBeLessThan(5); // Must be strictly under 5ms
            }
        });
    });

    describe("Import Status Metadata", () => {
        it("saves and retrieves import status record", async () => {
            const status = {
                dictId: "SKK-JISYO.S",
                version: "1.0.0",
                completed: true,
                entryCount: 3000,
                timestamp: Date.now(),
            };

            await store.setImportStatus(status);
            const retrieved = await store.getImportStatus("SKK-JISYO.S");

            expect(retrieved).toEqual(status);
        });

        it("returns undefined for non-existent dictId", async () => {
            const retrieved = await store.getImportStatus("unknown_dict");
            expect(retrieved).toBeUndefined();
        });

        it("isImportCompleted returns true only when status completed is true, version matches, and store is not empty", async () => {
            const dictId = "test_dict";
            expect(await store.isImportCompleted(dictId, "1.0.0")).toBe(false);

            // Incomplete status
            await store.setImportStatus({
                dictId,
                version: "1.0.0",
                completed: false,
                entryCount: 0,
                timestamp: Date.now(),
            });
            expect(await store.isImportCompleted(dictId, "1.0.0")).toBe(false);

            // Completed status but empty store
            await store.setImportStatus({
                dictId,
                version: "1.0.0",
                completed: true,
                entryCount: 10,
                timestamp: Date.now(),
            });
            expect(await store.isImportCompleted(dictId, "1.0.0")).toBe(false);

            // Populated store with matching completed status
            await store.importEntries([{ key: "t1", candidates: [new Candidate("テスト")] }]);
            expect(await store.isImportCompleted(dictId, "1.0.0")).toBe(true);

            // Version mismatch returns false
            expect(await store.isImportCompleted(dictId, "2.0.0")).toBe(false);
        });

        it("deletes import status via deleteImportStatus", async () => {
            await store.setImportStatus({
                dictId: "to_delete",
                version: "1.0.0",
                completed: true,
                entryCount: 50,
                timestamp: Date.now(),
            });

            expect(await store.getImportStatus("to_delete")).toBeDefined();
            await store.deleteImportStatus("to_delete");
            expect(await store.getImportStatus("to_delete")).toBeUndefined();
        });

        it("clears metadata when clear(dictId) is called", async () => {
            await store.importEntries([{ key: "k", candidates: [new Candidate("v")] }]);
            await store.setImportStatus({
                dictId: "dict1",
                version: "1.0.0",
                completed: true,
                entryCount: 1,
                timestamp: Date.now(),
            });

            await store.clear("dict1");
            expect(await store.getImportStatus("dict1")).toBeUndefined();
            expect(await store.count()).toBe(0);
        });
    });
});
