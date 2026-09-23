import type { IUserJisyoStorage } from "../../core/skk/jisyo/IJisyoStorage";
import { Candidate, copyCandidate, candidateIdentity } from "../../core/skk/jisyo/candidate";
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
        const filtered = list.filter((c) => candidateIdentity(c) !== candidateIdentity(candidate));
        filtered.unshift(copyCandidate(candidate));
        this.map.set(key, filtered);
        return true;
    }

    async reorderCandidate(key: string, target: Candidate | string | number): Promise<boolean> {
        const list = this.map.get(key);
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
            index = list.findIndex((c) => c.word === targetWord && (typeof target === "string" || candidateIdentity(c) === candidateIdentity(target)));
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
        const list = this.map.get(key);
        if (!list) return false;
        const filtered = list.filter((c) => candidateIdentity(c) !== candidateIdentity(candidate));
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
                            cands.map((c) => copyCandidate(c))
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
                candidate: copyCandidate(candidate),
                senderId: this.senderId,
            });
            return Boolean(success);
        } catch (err) {
            console.error(`[RemoteUserStore] Failed to save candidate for "${key}":`, err);
            return false;
        }
    }

    /**
     * Reorders candidates for a key by moving the candidate to the front via background.
     * Supports passing Candidate object, candidate word string, or numeric index.
     */
    public async reorderCandidate(key: string, target: Candidate | string | number): Promise<boolean> {
        if (!this.hasRuntime) {
            return this.fallbackStore.reorderCandidate(key, target);
        }

        try {
            const candidateData =
                typeof target === "object"
                    ? copyCandidate(target)
                    : typeof target === "string"
                    ? { word: target }
                    : undefined;
            const selectedIndex = typeof target === "number" ? target : undefined;

            const success = await this.callRpc<boolean>({
                type: "SKK_USER_REORDER",
                key,
                candidate: candidateData,
                selectedIndex,
                senderId: this.senderId,
            });
            return Boolean(success);
        } catch (err) {
            console.error(`[RemoteUserStore] Failed to reorder candidate for "${key}":`, err);
            return false;
        }
    }

    /**
     * Deletes a candidate for a given key via background service worker.
     */
    public async deleteCandidate(key: string, candidate: Candidate): Promise<boolean> {
        if (!this.hasRuntime) {
            return this.fallbackStore.deleteCandidate(key, candidate);
        }

        // 対象なしと通信・保存の失敗を区別し、失敗時は呼び出し側で再試行できます。
        const success = await this.callRpc<boolean>({
            type: "SKK_USER_DELETE",
            key,
            candidate: copyCandidate(candidate),
            senderId: this.senderId,
        });
        return Boolean(success);
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
                obj[key] = list.map((c) => (copyCandidate(c)));
            }
            const success = await this.callRpc<boolean>({
                type: "SKK_USER_SAVE_ENTRIES",
                entries: obj,
                senderId: this.senderId,
            });
            return Boolean(success);
        } catch (err) {
            console.error("[RemoteUserStore] Failed to bulk save entries via RPC:", err);
            return false;
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
            return false;
        }
    }
}
