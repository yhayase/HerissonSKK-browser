import type { IJisyoStorage } from "../../core/skk/jisyo/IJisyoStorage";
import { Candidate } from "../../core/skk/jisyo/candidate";
import { Entry } from "../../core/skk/jisyo/entry";
import type { EntryData } from "../rpc/messages";
import { isRuntimeAvailable, sendRuntimeMessage, type IRuntimeClient } from "../rpc/runtimeClient";

/**
 * Options for configuring RemoteJisyoStore.
 */
export interface RemoteJisyoStoreOptions {
    /**
     * Optional custom RPC client (useful for unit testing without browser globals).
     */
    client?: IRuntimeClient;

    /**
     * Optional fallback store to use when browser runtime is not available (e.g. Node tests).
     */
    fallbackStore?: IJisyoStorage;
}

/**
 * Remote proxy implementation of IJisyoStorage for Content Scripts.
 * Proxies read-only dictionary queries (lookup, lookupPrefix) to the Extension Background Service Worker
 * over WebExtension runtime messaging.
 */
export class RemoteJisyoStore implements IJisyoStorage {
    private readonly client?: IRuntimeClient;
    private readonly fallbackStore?: IJisyoStorage;

    constructor(options?: RemoteJisyoStoreOptions) {
        this.client = options?.client;
        this.fallbackStore = options?.fallbackStore;
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
     * Looks up candidates for an exact dictionary key (midashigo) via background service worker.
     */
    public async lookup(key: string): Promise<Entry | undefined> {
        if (!this.hasRuntime) {
            if (this.fallbackStore) {
                return this.fallbackStore.lookup(key);
            }
            return undefined;
        }

        try {
            const data = await this.callRpc<EntryData | null>({
                type: "SKK_JISYO_LOOKUP",
                key,
            });

            if (!data || !data.candidates || data.candidates.length === 0) {
                return undefined;
            }

            const candidates = data.candidates.map((c) => new Candidate(c.word, c.annotation));
            return new Entry(data.midashigo || key, candidates, "");
        } catch (err) {
            if (this.fallbackStore) {
                return this.fallbackStore.lookup(key);
            }
            console.error(`[RemoteJisyoStore] Error looking up key "${key}":`, err);
            return undefined;
        }
    }

    /**
     * Looks up entries starting with the specified prefix via background service worker.
     */
    public async lookupPrefix(prefix: string, limit?: number): Promise<Entry[]> {
        if (!this.hasRuntime) {
            if (this.fallbackStore?.lookupPrefix) {
                return this.fallbackStore.lookupPrefix(prefix);
            }
            return [];
        }

        try {
            const list = await this.callRpc<EntryData[]>({
                type: "SKK_JISYO_LOOKUP_PREFIX",
                prefix,
                limit,
            });

            if (!list || list.length === 0) {
                return [];
            }

            return list.map((item) => {
                const candidates = item.candidates.map((c) => new Candidate(c.word, c.annotation));
                return new Entry(item.midashigo, candidates, "");
            });
        } catch (err) {
            if (this.fallbackStore?.lookupPrefix) {
                return this.fallbackStore.lookupPrefix(prefix);
            }
            console.error(`[RemoteJisyoStore] Error looking up prefix "${prefix}":`, err);
            return [];
        }
    }
}
