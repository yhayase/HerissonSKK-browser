import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CompositeJisyoProvider } from "../../src/core/skk/jisyo/CompositeJisyoProvider";
import { Candidate } from "../../src/core/skk/jisyo/candidate";
import { Entry } from "../../src/core/skk/jisyo/entry";
import type { IJisyoStorage, IUserJisyoStorage } from "../../src/core/skk/jisyo/IJisyoStorage";
import { BroadcastChannelSync } from "../../src/storage/sync/BroadcastChannelSync";

/**
 * In-memory implementation of IUserJisyoStorage for unit tests.
 */
class MockUserStorage implements IUserJisyoStorage {
    public entries: Map<string, Candidate[]> = new Map();

    async loadUserEntries(): Promise<Map<string, Candidate[]>> {
        const copy = new Map<string, Candidate[]>();
        for (const [k, v] of this.entries) {
            copy.set(k, [...v]);
        }
        return copy;
    }

    async saveCandidate(key: string, candidate: Candidate): Promise<boolean> {
        const list = this.entries.get(key) ?? [];
        const idx = list.findIndex((c) => c.word === candidate.word);
        if (idx !== -1) {
            list.splice(idx, 1);
        }
        list.unshift(candidate);
        this.entries.set(key, list);
        return true;
    }

    async reorderCandidate(key: string, target: Candidate | string | number): Promise<boolean> {
        const list = this.entries.get(key);
        if (!list || list.length === 0) {
            return false;
        }
        let index = -1;
        if (typeof target === "number") {
            if (target >= 0 && target < list.length) {
                index = target;
            }
        } else {
            const targetWord = typeof target === "string" ? target : target.word;
            index = list.findIndex((c) => c.word === targetWord);
        }
        if (index === -1) {
            return false;
        }
        const [selected] = list.splice(index, 1);
        if (selected) {
            list.unshift(selected);
        }
        return true;
    }

    async deleteCandidate(key: string, candidate: Candidate): Promise<boolean> {
        const list = this.entries.get(key);
        if (!list) return false;
        const idx = list.findIndex((c) => c.word === candidate.word);
        if (idx === -1) return false;
        list.splice(idx, 1);
        if (list.length === 0) {
            this.entries.delete(key);
        }
        return true;
    }
}

/**
 * In-memory implementation of IJisyoStorage for unit tests.
 */
class MockSystemStorage implements IJisyoStorage {
    private dict: Map<string, Candidate[]>;

    constructor(entries: Record<string, Candidate[]>) {
        this.dict = new Map(Object.entries(entries));
    }

    async lookup(key: string): Promise<Entry | undefined> {
        const cands = this.dict.get(key);
        if (!cands || cands.length === 0) {
            return undefined;
        }
        return new Entry(key, [...cands], "");
    }
}

describe("CompositeJisyoProvider", () => {
    let userStorage: MockUserStorage;
    let systemStorage1: MockSystemStorage;
    let systemStorage2: MockSystemStorage;
    let provider: CompositeJisyoProvider;

    beforeEach(async () => {
        userStorage = new MockUserStorage();
        // User dictionary initially has some learned words
        userStorage.entries.set("とうきょう", [new Candidate("東京-user")]);
        userStorage.entries.set("へんかん", [new Candidate("変換-user")]);

        // System storage 1 (e.g. main SKK-JISYO.L)
        systemStorage1 = new MockSystemStorage({
            とうきょう: [new Candidate("東京"), new Candidate("とうきょう")],
            かんじ: [new Candidate("漢字"), new Candidate("感じ")],
            いk: [new Candidate("行"), new Candidate("逝")],
        });

        // System storage 2 (e.g. supplemental dictionary)
        systemStorage2 = new MockSystemStorage({
            かんじ: [new Candidate("幹事")],
            "だい>": [new Candidate("大")],
        });

        provider = new CompositeJisyoProvider(userStorage, [systemStorage1, systemStorage2]);
        await provider.init();
    });

    afterEach(() => {
        provider.destroy();
    });

    describe("lookupCandidates (Priority & Deduplication)", () => {
        it("puts user dictionary candidates before system dictionary candidates", async () => {
            const entry = await provider.lookupCandidates("とうきょう");
            expect(entry).toBeDefined();

            const candidates = entry!.getCandidateList();
            expect(candidates).toHaveLength(3);
            // User candidate comes first
            expect(candidates[0]!.word).toBe("東京-user");
            // Followed by system dictionary candidates
            expect(candidates[1]!.word).toBe("東京");
            expect(candidates[2]!.word).toBe("とうきょう");
        });

        it("combines multiple system storages in order when not in user dictionary", async () => {
            const entry = await provider.lookupCandidates("かんじ");
            expect(entry).toBeDefined();

            const words = entry!.getCandidateList().map((c) => c.word);
            // systemStorage1 followed by systemStorage2
            expect(words).toEqual(["漢字", "感じ", "幹事"]);
        });

        it("deduplicates candidates preserving the first occurrence", async () => {
            // Register a candidate into user storage that also exists in system storage
            await provider.registerCandidate("かんじ", new Candidate("漢字"));

            const entry = await provider.lookupCandidates("かんじ");
            expect(entry).toBeDefined();

            const words = entry!.getCandidateList().map((c) => c.word);
            // "漢字" is from user dictionary; the duplicate "漢字" from systemStorage1 is omitted
            expect(words).toEqual(["漢字", "感じ", "幹事"]);
        });

        it("returns undefined when key is not found in user or system storages", async () => {
            const entry = await provider.lookupCandidates("non_existent_key");
            expect(entry).toBeUndefined();
        });
    });

    describe("Candidate Learning & Promotion (reorderCandidate)", () => {
        it("promotes a selected system dictionary candidate to index 0 in the user dictionary", async () => {
            // Initial lookup for "かんじ": ["漢字", "感じ", "幹事"]
            let entry = await provider.lookupCandidates("かんじ");
            expect(entry!.getCandidateList().map((c) => c.word)).toEqual(["漢字", "感じ", "幹事"]);

            // User selects candidate at index 1 ("感じ")
            const reordered = await provider.reorderCandidate("かんじ", 1);
            expect(reordered).toBe(true);

            // Verify it was persisted to user storage
            const userEntries = await userStorage.loadUserEntries();
            expect(userEntries.get("かんじ")?.[0]?.word).toBe("感じ");

            // Subsequent lookup has the promoted candidate at index 0
            entry = await provider.lookupCandidates("かんじ");
            expect(entry!.getCandidateList().map((c) => c.word)).toEqual(["感じ", "漢字", "幹事"]);
        });

        it("promotes candidate when onCandidateSelected is triggered on Entry", async () => {
            const entry = await provider.lookupCandidates("とうきょう");
            expect(entry).toBeDefined();

            // Select candidate at index 2 ("とうきょう")
            entry!.onCandidateSelected(provider, 2);

            // Wait for promise tick
            await new Promise((resolve) => setTimeout(resolve, 10));

            const updated = await provider.lookupCandidates("とうきょう");
            expect(updated!.getCandidateList()[0]!.word).toBe("とうきょう");
        });

        it("reordering candidate 0 is a no-op", async () => {
            const spy = vi.spyOn(userStorage, "saveCandidate");
            const entry = await provider.lookupCandidates("とうきょう");
            entry!.onCandidateSelected(provider, 0);

            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });

        it("returns false on invalid selectedIndex", async () => {
            expect(await provider.reorderCandidate("とうきょう", -1)).toBe(false);
            expect(await provider.reorderCandidate("とうきょう", 99)).toBe(false);
            expect(await provider.reorderCandidate("unknown", 0)).toBe(false);
        });

        it("promotes candidate by Candidate object", async () => {
            const reordered = await provider.reorderCandidate("かんじ", new Candidate("幹事"));
            expect(reordered).toBe(true);

            const userEntries = await userStorage.loadUserEntries();
            expect(userEntries.get("かんじ")?.[0]?.word).toBe("幹事");

            const entry = await provider.lookupCandidates("かんじ");
            expect(entry!.getCandidateList()[0]!.word).toBe("幹事");
        });

        it("promotes candidate by word string", async () => {
            const reordered = await provider.reorderCandidate("かんじ", "感じ");
            expect(reordered).toBe(true);

            const userEntries = await userStorage.loadUserEntries();
            expect(userEntries.get("かんじ")?.[0]?.word).toBe("感じ");

            const entry = await provider.lookupCandidates("かんじ");
            expect(entry!.getCandidateList()[0]!.word).toBe("感じ");
        });
    });

    describe("registerCandidate & deleteCandidate", () => {
        it("registers candidate to front of user dictionary and persists", async () => {
            const success = await provider.registerCandidate(
                "あたらしい",
                new Candidate("新しい", "あたらしい")
            );
            expect(success).toBe(true);

            const userMap = provider.getUserDictionary();
            expect(userMap.get("あたらしい")?.[0]?.word).toBe("新しい");
            expect(userMap.get("あたらしい")?.[0]?.annotation).toBe("あたらしい");

            const persisted = await userStorage.loadUserEntries();
            expect(persisted.get("あたらしい")?.[0]?.word).toBe("新しい");
        });

        it("deletes candidate from user dictionary and persists", async () => {
            expect(provider.getUserDictionary().has("へんかん")).toBe(true);

            const success = await provider.deleteCandidate(
                "へんかん",
                new Candidate("変換-user")
            );
            expect(success).toBe(true);

            expect(provider.getUserDictionary().has("へんかん")).toBe(false);
            const persisted = await userStorage.loadUserEntries();
            expect(persisted.has("へんかん")).toBe(false);
        });
    });

    describe("候補削除の永続化結果", () => {
        it("永続化を待つ間と失敗時はキャッシュを保持し、再試行できる", async () => {
            let rejectDeletion!: (error: Error) => void;
            const deleting = vi.spyOn(userStorage, "deleteCandidate").mockImplementationOnce(
                () => new Promise<boolean>((_resolve, reject) => { rejectDeletion = reject; }),
            );
            const operation = provider.deleteCandidate("へんかん", new Candidate("変換-user"));
            await vi.waitFor(() => expect(deleting).toHaveBeenCalledOnce());
            expect(provider.getUserDictionary().get("へんかん")?.[0]?.word).toBe("変換-user");
            rejectDeletion(new Error("保存失敗"));
            await expect(operation).rejects.toThrow("保存失敗");
            expect(provider.getUserDictionary().get("へんかん")?.[0]?.word).toBe("変換-user");
            expect(userStorage.entries.get("へんかん")?.[0]?.word).toBe("変換-user");

            await expect(provider.deleteCandidate("へんかん", new Candidate("変換-user"))).resolves.toBe(true);
            expect(provider.getUserDictionary().has("へんかん")).toBe(false);
        });

        it("保存先に対象がなければ成功扱いにせず、古いキャッシュを取り除く", async () => {
            userStorage.entries.delete("へんかん");
            expect(provider.getUserDictionary().has("へんかん")).toBe(true);
            await expect(provider.deleteCandidate("へんかん", new Candidate("変換-user"))).resolves.toBe(false);
            expect(provider.getUserDictionary().has("へんかん")).toBe(false);
        });
    });

    describe("Multi-tab Synchronization (BroadcastChannelSync)", () => {
        let channelName: string;
        let syncA: BroadcastChannelSync;
        let syncB: BroadcastChannelSync;
        let userStorageB: MockUserStorage;
        let providerA: CompositeJisyoProvider;
        let providerB: CompositeJisyoProvider;

        beforeEach(async () => {
            channelName = `test_sync_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
            syncA = new BroadcastChannelSync({ channelName });
            syncB = new BroadcastChannelSync({ channelName });

            userStorageB = new MockUserStorage();
            providerA = new CompositeJisyoProvider(userStorage, [], syncA);
            providerB = new CompositeJisyoProvider(userStorageB, [], syncB);

            await providerA.init();
            await providerB.init();
        });

        afterEach(() => {
            providerA.destroy();
            providerB.destroy();
            syncA.close();
            syncB.close();
        });

        it("updates tab B user cache when tab A registers a candidate", async () => {
            expect(providerB.getUserDictionary().has("sync_test")).toBe(false);

            // Tab A registers a new candidate
            await providerA.registerCandidate("sync_test", new Candidate("同期テスト"));

            // Wait for BroadcastChannel delivery
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Tab B should have updated its in-memory user cache
            const bUserDict = providerB.getUserDictionary();
            expect(bUserDict.has("sync_test")).toBe(true);
            expect(bUserDict.get("sync_test")?.[0]?.word).toBe("同期テスト");
        });

        it("updates tab B user cache when tab A deletes a candidate", async () => {
            // First register into both
            await providerA.registerCandidate("delete_test", new Candidate("削除対象"));
            await providerB.registerCandidate("delete_test", new Candidate("削除対象"));

            expect(providerB.getUserDictionary().has("delete_test")).toBe(true);

            // Tab A deletes candidate
            await providerA.deleteCandidate("delete_test", new Candidate("削除対象"));

            // Wait for BroadcastChannel delivery
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Tab B should reflect deletion
            expect(providerB.getUserDictionary().has("delete_test")).toBe(false);
        });

        it("ignores self messages within the same tab", async () => {
            const spyB = vi.fn();
            syncA.onRemoteMutation(spyB);

            syncA.broadcastMutation({ type: "MUTATED" });

            await new Promise((resolve) => setTimeout(resolve, 30));
            // Handler on syncA should NOT have been called for its own broadcast
            expect(spyB).not.toHaveBeenCalled();
        });

        it("eliminates duplicate sync broadcasts with identical mutationId", async () => {
            const spyHandler = vi.fn();
            syncB.onRemoteMutation(spyHandler);

            const duplicateEvent = {
                type: "CANDIDATE_SAVED" as const,
                key: "dedup_test",
                candidate: { word: "重複テスト" },
                mutationId: "mut_test_12345",
                timestamp: Date.now(),
            };

            // Broadcast the same mutationId twice
            syncA.broadcastMutation(duplicateEvent);
            syncA.broadcastMutation(duplicateEvent);

            await new Promise((resolve) => setTimeout(resolve, 50));

            // Handler on tab B must be called only once
            expect(spyHandler).toHaveBeenCalledTimes(1);
        });

        it("automatically generates mutationId, senderId, and timestamp on local mutation", async () => {
            let capturedEvent: any = null;
            syncB.onRemoteMutation((event) => {
                capturedEvent = event;
            });

            await providerA.registerCandidate("id_test", new Candidate("IDテスト"));

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(capturedEvent).toBeDefined();
            expect(capturedEvent.mutationId).toBeDefined();
            expect(typeof capturedEvent.mutationId).toBe("string");
            expect(capturedEvent.mutationId.length).toBeGreaterThan(0);
            expect(capturedEvent.senderId).toBe(providerA.getSenderId());
            expect(capturedEvent.timestamp).toBeDefined();
            expect(typeof capturedEvent.timestamp).toBe("number");
        });

        it("ignores incoming mutations matching provider's own senderId", async () => {
            const spySave = vi.spyOn(userStorageB, "loadUserEntries");

            // Manually inject a message whose senderId matches providerB's senderId
            syncA.broadcastMutation({
                type: "MUTATED",
                senderId: providerB.getSenderId(),
                mutationId: "self_sender_mut_999",
            });

            await new Promise((resolve) => setTimeout(resolve, 50));

            // providerB should ignore the event because it matches its own senderId
            expect(spySave).not.toHaveBeenCalled();
        });
    });
});
