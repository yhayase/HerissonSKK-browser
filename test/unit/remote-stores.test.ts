import { describe, it, expect, vi } from "vitest";
import { RemoteJisyoStore } from "../../src/storage/jisyo/RemoteJisyoStore";
import { RemoteUserStore } from "../../src/storage/user-jisyo/RemoteUserStore";
import { RuntimeMessageSync } from "../../src/storage/sync/RuntimeMessageSync";
import { Candidate } from "../../src/core/skk/jisyo/candidate";
import type { IRuntimeClient } from "../../src/storage/rpc/runtimeClient";
import type { SkkRpcRequest } from "../../src/storage/rpc/messages";

describe("RemoteJisyoStore", () => {
    it("delegates lookup to IRuntimeClient when provided", async () => {
        const mockClient: IRuntimeClient = {
            sendMessage: vi.fn().mockImplementation(async (req: SkkRpcRequest) => {
                if (req.type === "SKK_JISYO_LOOKUP" && req.key === "とうきょう") {
                    return {
                        midashigo: "とうきょう",
                        candidates: [{ word: "東京", annotation: "日本の首都" }],
                    };
                }
                return null;
            }),
        };

        const store = new RemoteJisyoStore({ client: mockClient });
        const entry = await store.lookup("とうきょう");

        expect(mockClient.sendMessage).toHaveBeenCalledWith({
            type: "SKK_JISYO_LOOKUP",
            key: "とうきょう",
        });
        expect(entry).toBeDefined();
        expect(entry?.getMidashigo()).toBe("とうきょう");
        expect(entry?.getCandidateList()).toHaveLength(1);
        expect(entry?.getCandidateList()[0]?.word).toBe("東京");
        expect(entry?.getCandidateList()[0]?.annotation).toBe("日本の首都");
    });

    it("returns undefined when lookup returns no candidates or null", async () => {
        const mockClient: IRuntimeClient = {
            sendMessage: vi.fn().mockResolvedValue(null),
        };

        const store = new RemoteJisyoStore({ client: mockClient });
        const entry = await store.lookup("unknown");
        expect(entry).toBeUndefined();
    });

    it("delegates lookupPrefix to IRuntimeClient", async () => {
        const mockClient: IRuntimeClient = {
            sendMessage: vi.fn().mockResolvedValue([
                {
                    midashigo: "とうきょう",
                    candidates: [{ word: "東京" }],
                },
                {
                    midashigo: "とうきょうと",
                    candidates: [{ word: "東京都" }],
                },
            ]),
        };

        const store = new RemoteJisyoStore({ client: mockClient });
        const entries = await store.lookupPrefix("とうきょう", 5);

        expect(mockClient.sendMessage).toHaveBeenCalledWith({
            type: "SKK_JISYO_LOOKUP_PREFIX",
            prefix: "とうきょう",
            limit: 5,
        });
        expect(entries).toHaveLength(2);
        expect(entries[0]?.getMidashigo()).toBe("とうきょう");
        expect(entries[1]?.getMidashigo()).toBe("とうきょうと");
    });

    it("falls back gracefully when runtime is unavailable and fallbackStore is provided", async () => {
        const mockFallback = {
            lookup: vi.fn().mockResolvedValue(undefined),
            lookupPrefix: vi.fn().mockResolvedValue([]),
        };

        const store = new RemoteJisyoStore({ fallbackStore: mockFallback });
        await store.lookup("test");
        expect(mockFallback.lookup).toHaveBeenCalledWith("test");
    });
});

describe("RemoteUserStore", () => {
    it("delegates loadUserEntries, saveCandidate, reorderCandidate, and deleteCandidate to RPC", async () => {
        const mockClient: IRuntimeClient = {
            sendMessage: vi.fn().mockImplementation(async (req: SkkRpcRequest) => {
                switch (req.type) {
                    case "SKK_USER_LOAD":
                        return {
                            にほん: [{ word: "日本" }],
                        };
                    case "SKK_USER_SAVE":
                    case "SKK_USER_REORDER":
                    case "SKK_USER_DELETE":
                    case "SKK_USER_CLEAR":
                        return true;
                    default:
                        return null;
                }
            }),
        };

        const store = new RemoteUserStore({ client: mockClient, senderId: "tab_1" });

        // Load
        const entries = await store.loadUserEntries();
        expect(mockClient.sendMessage).toHaveBeenCalledWith({ type: "SKK_USER_LOAD" });
        expect(entries.has("にほん")).toBe(true);
        expect(entries.get("にほん")?.[0]?.word).toBe("日本");

        // Save
        const saveOk = await store.saveCandidate("かわさき", new Candidate("川崎"));
        expect(saveOk).toBe(true);
        expect(mockClient.sendMessage).toHaveBeenCalledWith({
            type: "SKK_USER_SAVE",
            key: "かわさき",
            candidate: { word: "川崎", annotation: undefined },
            senderId: "tab_1",
        });

        // Reorder by index
        const reorderOk = await store.reorderCandidate("にほん", 1);
        expect(reorderOk).toBe(true);
        expect(mockClient.sendMessage).toHaveBeenCalledWith({
            type: "SKK_USER_REORDER",
            key: "にほん",
            candidate: undefined,
            selectedIndex: 1,
            senderId: "tab_1",
        });

        // Reorder by Candidate object
        const reorderCandOk = await store.reorderCandidate("にほん", new Candidate("日本"));
        expect(reorderCandOk).toBe(true);
        expect(mockClient.sendMessage).toHaveBeenCalledWith({
            type: "SKK_USER_REORDER",
            key: "にほん",
            candidate: { word: "日本", annotation: undefined },
            selectedIndex: undefined,
            senderId: "tab_1",
        });

        // Delete
        const deleteOk = await store.deleteCandidate("にほん", new Candidate("日本"));
        expect(deleteOk).toBe(true);
        expect(mockClient.sendMessage).toHaveBeenCalledWith({
            type: "SKK_USER_DELETE",
            key: "にほん",
            candidate: { word: "日本", annotation: undefined },
            senderId: "tab_1",
        });

        // Clear
        const clearOk = await store.clear();
        expect(clearOk).toBe(true);
        expect(mockClient.sendMessage).toHaveBeenCalledWith({
            type: "SKK_USER_CLEAR",
            senderId: "tab_1",
        });
    });

    it("uses in-memory fallback when runtime is absent", async () => {
        const store = new RemoteUserStore();
        await store.saveCandidate("とうきょう", new Candidate("とうきょう"));
        await store.saveCandidate("とうきょう", new Candidate("東京"));
        // Current: ["東京", "とうきょう"]

        // Reorder by Candidate object
        await store.reorderCandidate("とうきょう", new Candidate("とうきょう"));
        const afterReorder = await store.loadUserEntries();
        expect(afterReorder.get("とうきょう")?.map((c) => c.word)).toEqual(["とうきょう", "東京"]);

        await store.deleteCandidate("とうきょう", new Candidate("東京"));
        await store.deleteCandidate("とうきょう", new Candidate("とうきょう"));
        const afterDelete = await store.loadUserEntries();
        expect(afterDelete.has("とうきょう")).toBe(false);
    });

    it("returns false on RPC failure instead of silently falling back to in-memory store", async () => {
        const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const failingClient: IRuntimeClient = {
            sendMessage: vi.fn().mockRejectedValue(new Error("Extension context invalidated")),
        };

        const store = new RemoteUserStore({ client: failingClient, senderId: "tab_err" });

        const saveResult = await store.saveCandidate("とうきょう", new Candidate("東京"));
        expect(saveResult).toBe(false);

        const reorderResult = await store.reorderCandidate("とうきょう", 0);
        expect(reorderResult).toBe(false);

        const deleteResult = await store.deleteCandidate("とうきょう", new Candidate("東京"));
        expect(deleteResult).toBe(false);

        const saveEntriesResult = await store.saveUserEntries(new Map([["test", [new Candidate("試験")]]]));
        expect(saveEntriesResult).toBe(false);

        const clearResult = await store.clear();
        expect(clearResult).toBe(false);

        consoleErrorSpy.mockRestore();
    });
});

describe("RuntimeMessageSync", () => {
    it("generates senderId and receives remote sync notifications while ignoring self-broadcasts", () => {
        const handlers: Array<(msg: any) => void> = [];
        const mockBrowser = {
            runtime: {
                onMessage: {
                    addListener: (fn: any) => {
                        handlers.push(fn);
                    },
                    removeListener: vi.fn(),
                },
            },
        };

        const origBrowser = (globalThis as any).browser;
        (globalThis as any).browser = mockBrowser;

        try {
            const sync = new RuntimeMessageSync({ senderId: "tab_self" });
            expect(sync.getSenderId()).toBe("tab_self");
            expect(handlers.length).toBeGreaterThan(0);

            const handler = vi.fn();
            sync.onRemoteMutation(handler);

            // Self message should be ignored
            for (const h of handlers) {
                h({
                    type: "SKK_USER_SYNC",
                    event: {
                        type: "CANDIDATE_SAVED",
                        key: "test",
                        senderId: "tab_self",
                    },
                });
            }
            expect(handler).not.toHaveBeenCalled();

            // Remote message should be processed
            for (const h of handlers) {
                h({
                    type: "SKK_USER_SYNC",
                    event: {
                        type: "CANDIDATE_SAVED",
                        key: "test",
                        senderId: "tab_other",
                    },
                });
            }
            expect(handler).toHaveBeenCalledWith({
                type: "CANDIDATE_SAVED",
                key: "test",
                senderId: "tab_other",
            });

            sync.close();
            expect(mockBrowser.runtime.onMessage.removeListener).toHaveBeenCalled();
        } finally {
            (globalThis as any).browser = origBrowser;
        }
    });

    it("suppresses duplicate broadcasts when receiving multiple messages with identical mutationId", () => {
        const handlers: Array<(msg: any) => void> = [];
        const mockBrowser = {
            runtime: {
                onMessage: {
                    addListener: (fn: any) => {
                        handlers.push(fn);
                    },
                    removeListener: vi.fn(),
                },
            },
        };

        const origBrowser = (globalThis as any).browser;
        (globalThis as any).browser = mockBrowser;

        try {
            const sync = new RuntimeMessageSync({ senderId: "tab_receiver" });
            const handler = vi.fn();
            sync.onRemoteMutation(handler);

            const duplicateMessage = {
                type: "SKK_USER_SYNC",
                event: {
                    type: "CANDIDATE_SAVED",
                    key: "test",
                    senderId: "tab_sender",
                    mutationId: "mut_duplicate_123",
                    timestamp: Date.now(),
                },
            };

            // Dispatch identical message twice
            for (const h of handlers) {
                h(duplicateMessage);
                h(duplicateMessage);
            }

            // Callback should only be triggered once
            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith(duplicateMessage.event);

            sync.close();
        } finally {
            (globalThis as any).browser = origBrowser;
        }
    });
});
