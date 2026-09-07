import type { IUserJisyoStorage } from "../../core/skk/jisyo/IJisyoStorage";
import { Candidate } from "../../core/skk/jisyo/candidate";
import type { CandidateData } from "../rpc/messages";
import { isRuntimeAvailable, sendRuntimeMessage, type IRuntimeClient } from "../rpc/runtimeClient";

/**
 * Options for configuring RemoteUserStore.
 */
export interface RemoteUserStoreOptions {
    /**
     * Unique sender ID for this content script session to prevent self-sync echo.
     */
    senderId?: string;

    /**
     * Optional custom RPC client (useful for unit testing without browser globals).
     */
    client?: IRuntimeClient;

    /**
     * Optional fallback store when browser runtime is not available (e.g. Node tests).
     */
    fallbackStore?: IUserJisyoStorage;
}

/**
 * In-memory user dictionary storage used as default fallback when neither runtime nor custom fallback is provided.
 */
class InMemoryUserStoreFallback implements IUserJisyoStorage {
    private map = new Map<string, Candidate[]>();

    async loadUserEntries(): Promise<Map<string, Candidate[]>> {
        const copy = new Map<string, Candidate[]>();
        for (const [k, v] of this.map.entries()) {
            copy.set(k, [...v]);
        }
        return copy;
    }

    async saveCandidate(key: string, candidate: Candidate): Promise<boolean> {
        const list = this.map.get(key) ?? [];
        const filtered = list.filter((c) => c.word !== candidate.word);
        filtered.unshift(new Candidate(candidate.word, candidate.annotation));
        this.map.set(key, filtered);
        return true;
    }

    async reorderCandidate(key: string, selectedIndex: number): Promise<boolean> {
        const list = this.map.get(key);
        if (!list || selectedIndex < 0 || selectedIndex >= list.length) {
            return false;
        }
        const [target] = list.splice(selectedIndex, 1);
        if (target) {
            list.unshift(target);
        }
        return true;
    }

    async deleteCandidate(key: string, candidate: Candidate): Promise<boolean> {
        const list = this.map.get(key);
        if (!list) return false;
        const filtered = list.filter((c) => c.word !== candidate.word);
        if (filtered.length === 0) {
            this.map.delete(key);
        } else {
            this.map.set(key, filtered);
        }
        return true;
    }

    async saveUserEntries(entries: Map<string, Candidate[]>): Promise<boolean> {
        for (const [k, v] of entries.entries()) {
            this.map.set(k, [...v]);
        }
        return true;
    }

    async clear(): Promise<boolean> {
        this.map.clear();
        return true;
    }
}

/**
 * Remote proxy implementation of IUserJisyoStorage for Content Scripts.
 * Proxies user dictionary mutations and queries to the Extension Background Service Worker
 * over WebExtension runtime messaging.
 */
export class RemoteUserStore implements IUserJisyoStorage {
    private readonly senderId?: string;
    private readonly client?: IRuntimeClient;
    private fallbackStore: IUserJisyoStorage;

    constructor(options?: RemoteUserStoreOptions) {
        this.senderId = options?.senderId;
        this.client = options?.client;
        this.fallbackStore = options?.fallbackStore ?? new InMemoryUserStoreFallback();
    }

    private get hasRuntime(): boolean {
        return this.client !== undefined || isRuntimeAvailable();
    }

    private async callRpc<T = any>(req: any): Promise<T> {
        if (this.client) {
            return this.client.sendMessage<T>(req);
        }
        return sendRuntimeMessage<T>(req);
    }

    /**
     * Loads all user entries from the background service worker.
     */
    public async loadUserEntries(): Promise<Map<string, Candidate[]>> {
        if (!this.hasRuntime) {
            return this.fallbackStore.loadUserEntries();
        }

        try {
            const raw = await this.callRpc<Record<string, CandidateData[]>>({
                type: "SKK_USER_LOAD",
            });

            const result = new Map<string, Candidate[]>();
            if (raw && typeof raw === "object") {
                for (const [key, cands] of Object.entries(raw)) {
                    if (Array.isArray(cands)) {
                        result.set(
                            key,
                            cands.map((c) => new Candidate(c.word, c.annotation))
                        );
                    }
                }
            }
            return result;
        } catch (err) {
            console.error("[RemoteUserStore] Failed to load user entries via RPC, falling back:", err);
            return this.fallbackStore.loadUserEntries();
        }
    }

    /**
     * Saves or registers a candidate for a given key via background service worker.
     */
    public async saveCandidate(key: string, candidate: Candidate): Promise<boolean> {
        if (!this.hasRuntime) {
            return this.fallbackStore.saveCandidate(key, candidate);
        }

        try {
            const success = await this.callRpc<boolean>({
                type: "SKK_USER_SAVE",
                key,
                candidate: { word: candidate.word, annotation: candidate.annotation },
                senderId: this.senderId,
            });
            return Boolean(success);
        } catch (err) {
            console.error(`[RemoteUserStore] Failed to save candidate for "${key}":`, err);
            return this.fallbackStore.saveCandidate(key, candidate);
        }
    }

    /**
     * Reorders candidates for a key by moving the candidate at selectedIndex to the front via background.
     */
    public async reorderCandidate(key: string, selectedIndex: number): Promise<boolean> {
        if (!this.hasRuntime) {
            return this.fallbackStore.reorderCandidate(key, selectedIndex);
        }

        try {
            const success = await this.callRpc<boolean>({
                type: "SKK_USER_REORDER",
                key,
                selectedIndex,
                senderId: this.senderId,
            });
            return Boolean(success);
        } catch (err) {
            console.error(`[RemoteUserStore] Failed to reorder candidate for "${key}":`, err);
            return this.fallbackStore.reorderCandidate(key, selectedIndex);
        }
    }

    /**
     * Deletes a candidate for a given key via background service worker.
     */
    public async deleteCandidate(key: string, candidate: Candidate): Promise<boolean> {
        if (!this.hasRuntime) {
            return this.fallbackStore.deleteCandidate(key, candidate);
        }

        try {
            const success = await this.callRpc<boolean>({
                type: "SKK_USER_DELETE",
                key,
                candidate: { word: candidate.word, annotation: candidate.annotation },
                senderId: this.senderId,
            });
            return Boolean(success);
        } catch (err) {
            console.error(`[RemoteUserStore] Failed to delete candidate for "${key}":`, err);
            return this.fallbackStore.deleteCandidate(key, candidate);
        }
    }

    /**
     * Bulk save of user entries via background.
     */
    public async saveUserEntries(entries: Map<string, Candidate[]>): Promise<boolean> {
        if (!this.hasRuntime) {
            return this.fallbackStore.saveUserEntries
                ? this.fallbackStore.saveUserEntries(entries)
                : false;
        }

        try {
            const obj: Record<string, CandidateData[]> = {};
            for (const [key, list] of entries.entries()) {
                obj[key] = list.map((c) => ({ word: c.word, annotation: c.annotation }));
            }
            const success = await this.callRpc<boolean>({
                type: "SKK_USER_SAVE_ENTRIES",
                entries: obj,
                senderId: this.senderId,
            });
            return Boolean(success);
        } catch (err) {
            console.error("[RemoteUserStore] Failed to bulk save entries via RPC:", err);
            return this.fallbackStore.saveUserEntries
                ? this.fallbackStore.saveUserEntries(entries)
                : false;
        }
    }

    /**
     * Clears all user entries via background.
     */
    public async clear(): Promise<boolean> {
        if (!this.hasRuntime) {
            return this.fallbackStore.clear ? this.fallbackStore.clear() : false;
        }

        try {
            const success = await this.callRpc<boolean>({
                type: "SKK_USER_CLEAR",
                senderId: this.senderId,
            });
            return Boolean(success);
        } catch (err) {
            console.error("[RemoteUserStore] Failed to clear user store via RPC:", err);
            return this.fallbackStore.clear ? this.fallbackStore.clear() : false;
        }
    }
}
