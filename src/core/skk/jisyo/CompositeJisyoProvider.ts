import type { IJisyoProvider } from "./IJisyoProvider";
import type { IJisyoStorage, IUserJisyoStorage } from "./IJisyoStorage";
import { Candidate, copyCandidate, candidateIdentity, mergeCandidates, type CandidateData } from "./candidate";
import { Entry } from "./entry";

/**
 * Supported sync event types for user dictionary mutations.
 */
export type UserJisyoSyncEventType =
    | "CANDIDATE_SAVED"
    | "CANDIDATE_REORDERED"
    | "CANDIDATE_DELETED"
    | "MUTATED";

/**
 * Event payload structure for user dictionary sync notifications.
 */
export interface IUserJisyoSyncEvent {
    type?: UserJisyoSyncEventType;
    key?: string;
    candidate?: CandidateData;
    selectedIndex?: number;
    senderId?: string;
    mutationId?: string;
    timestamp?: number;
}

/**
 * Abstract sync notifier interface to keep core engine environment-agnostic.
 */
export interface IUserJisyoSyncNotifier {
    broadcastMutation(event?: IUserJisyoSyncEvent): void;
    onRemoteMutation(handler: (event: IUserJisyoSyncEvent) => void): () => void;
}

/**
 * Composite dictionary provider that combines:
 * 1. User dictionary (read/write, persisted in IUserJisyoStorage, LRU candidate learning)
 * 2. System dictionaries (read-only, IJisyoStorage instances)
 * 3. Multi-tab / cross-window synchronization via IUserJisyoSyncNotifier
 *
 * Adheres to standard SKK behavior:
 * - User dictionary candidates take precedence over system dictionary candidates.
 * - Duplicate candidates are deduplicated preserving the first occurrence.
 * - Selecting any candidate promotes it to the front of the user dictionary (LRU / MRU learning).
 */
export class CompositeJisyoProvider implements IJisyoProvider {
    private readonly userStorage: IUserJisyoStorage;
    private readonly systemStorages: IJisyoStorage[];
    private readonly syncNotifier?: IUserJisyoSyncNotifier;
    private readonly senderId: string;
    private readonly processedMutationIds: Set<string> = new Set();
    private readonly maxProcessedMutations = 100;

    private userDictionary: Map<string, Candidate[]> = new Map();
    private isLoaded = false;
    private loadPromise: Promise<void> | null = null;
    private unsubscribeSync?: () => void;

    constructor(
        userStorage: IUserJisyoStorage,
        systemStorages: IJisyoStorage[] = [],
        syncNotifier?: IUserJisyoSyncNotifier,
        senderId?: string
    ) {
        this.userStorage = userStorage;
        this.systemStorages = [...systemStorages];
        this.syncNotifier = syncNotifier;
        this.senderId = senderId ?? this.generateSenderId();

        if (this.syncNotifier) {
            this.unsubscribeSync = this.syncNotifier.onRemoteMutation((event) => {
                this.handleRemoteMutation(event).catch((err) => {
                    console.error("Failed to handle remote jisyo sync mutation:", err);
                });
            });
        }
    }

    private generateSenderId(): string {
        return (
            "cjp_" +
            Math.random().toString(36).substring(2, 10) +
            "_" +
            Date.now().toString(36)
        );
    }

    private generateMutationId(): string {
        return (
            this.senderId +
            "_" +
            Date.now().toString(36) +
            "_" +
            Math.random().toString(36).substring(2, 8)
        );
    }

    private markMutationProcessed(mutationId?: string): boolean {
        if (!mutationId) {
            return false;
        }
        if (this.processedMutationIds.has(mutationId)) {
            return true;
        }
        this.processedMutationIds.add(mutationId);
        if (this.processedMutationIds.size > this.maxProcessedMutations) {
            const first = this.processedMutationIds.values().next().value;
            if (first !== undefined) {
                this.processedMutationIds.delete(first);
            }
        }
        return false;
    }

    /**
     * Returns the sender ID associated with this provider instance.
     */
    public getSenderId(): string {
        return this.senderId;
    }

    /**
     * Initializes the provider by loading the user dictionary into the in-memory cache.
     */
    public async init(): Promise<void> {
        await this.ensureLoaded();
    }

    /**
     * Ensures user entries are loaded from storage into in-memory cache.
     * Concurrently dispatched calls share the same loading promise.
     */
    private async ensureLoaded(): Promise<void> {
        if (this.isLoaded) {
            return;
        }
        if (this.loadPromise) {
            return this.loadPromise;
        }

        this.loadPromise = (async () => {
            const entries = await this.userStorage.loadUserEntries();
            this.userDictionary = new Map(entries);
            this.isLoaded = true;
        })().finally(() => {
            this.loadPromise = null;
        });

        return this.loadPromise;
    }

    /**
     * Handles remote mutation events from other tabs or windows.
     */
    private async handleRemoteMutation(event?: IUserJisyoSyncEvent): Promise<void> {
        if (!event) return;

        // Ignore self-originated events
        if (event.senderId && event.senderId === this.senderId) {
            return;
        }

        // Ignore already processed duplicate mutations
        if (event.mutationId && this.markMutationProcessed(event.mutationId)) {
            return;
        }

        if (event.type === "CANDIDATE_SAVED" && event.key && event.candidate) {
            const list = this.userDictionary.get(event.key) ?? [];
            const idx = list.findIndex((c) => candidateIdentity(c) === candidateIdentity(event.candidate!));
            if (idx !== -1) {
                list.splice(idx, 1);
            }
            list.unshift(copyCandidate(event.candidate));
            this.userDictionary.set(event.key, list);
            return;
        }

        if (event.type === "CANDIDATE_DELETED" && event.key && event.candidate) {
            const list = this.userDictionary.get(event.key);
            if (list) {
                const idx = list.findIndex((c) => candidateIdentity(c) === candidateIdentity(event.candidate!));
                if (idx !== -1) {
                    list.splice(idx, 1);
                }
                if (list.length === 0) {
                    this.userDictionary.delete(event.key);
                }
            }
            return;
        }

        // Full reload fallback
        const entries = await this.userStorage.loadUserEntries();
        this.userDictionary = new Map(entries);
        this.isLoaded = true;
    }

    /**
     * Look up candidates for a given key.
     * Combines user candidates and system dictionary candidates.
     * User candidates come first. Duplicates are deduplicated preserving the first occurrence.
     *
     * @param key The dictionary key to look up
     * @returns Combined Entry or undefined if none found
     */
    public async lookupCandidates(key: string): Promise<Entry | undefined> {
        await this.ensureLoaded();

        const userCands = this.userDictionary.get(key) ?? [];

        // Query all system storages
        const systemCands: Candidate[] = [];
        for (const storage of this.systemStorages) {
            try {
                const entry = await storage.lookup(key);
                if (entry) {
                    for (const candidate of entry.getCandidateList()) {
                        systemCands.push(candidate);
                    }
                }
            } catch (err) {
                console.error(`Error querying system storage for "${key}":`, err);
            }
        }

        const combined = mergeCandidates([
            ...userCands.map((c) => new Candidate(c.word, c.annotation, { okuri: c.okuri, sources: [{ kind: "learned", annotation: c.annotation }] })),
            ...systemCands,
        ]);

        if (combined.length === 0) {
            return undefined;
        }

        return new Entry(key, combined, "");
    }

    /**
     * Registers a candidate for a given key.
     * Promotes or adds the candidate to the front of the user dictionary in cache and persists to storage.
     * Broadcasts sync notification.
     *
     * @param key The dictionary key
     * @param candidate The candidate to register
     * @returns True if successful
     */
    public async registerCandidate(key: string, candidate: Candidate): Promise<boolean> {
        await this.ensureLoaded();

        // Update in-memory user dictionary (unshift to front)
        const list = this.userDictionary.get(key) ?? [];
        const existingIdx = list.findIndex((c) => candidateIdentity(c) === candidateIdentity(candidate));
        if (existingIdx !== -1) {
            list.splice(existingIdx, 1);
        }
        list.unshift(candidate);
        this.userDictionary.set(key, list);

        // Persist to user storage
        const success = await this.userStorage.saveCandidate(key, candidate);

        if (success) {
            const mutationId = this.generateMutationId();
            this.markMutationProcessed(mutationId);

            // Broadcast to remote tabs
            this.syncNotifier?.broadcastMutation({
                type: "CANDIDATE_SAVED",
                key,
                candidate: copyCandidate(candidate),
                senderId: this.senderId,
                mutationId,
                timestamp: Date.now(),
            });
        }

        return success;
    }

    /**
     * Reorders candidates for a key by promoting the candidate to the front.
     * Supports passing a Candidate object, candidate word string, or selectedIndex (for backward compatibility).
     * If the selected candidate came from system dictionary, it is learned and registered in the user dictionary.
     *
     * @param key The dictionary key
     * @param target The Candidate object, word string, or numeric index of the selected candidate
     * @returns True if successful
     */
    public async reorderCandidate(key: string, target: Candidate | string | number): Promise<boolean> {
        await this.ensureLoaded();

        if (typeof target === "object" && target instanceof Candidate) {
            return this.registerCandidate(key, target);
        }

        const entry = await this.lookupCandidates(key);
        if (!entry) {
            return false;
        }

        const candidates = entry.getCandidateList();
        let selected: Candidate | undefined;

        if (typeof target === "number") {
            if (target >= 0 && target < candidates.length) {
                selected = candidates[target];
            }
        } else if (typeof target === "string") {
            selected = candidates.find((c) => c.word === target);
        } else if (typeof target === "object" && (target as any).word) {
            selected = copyCandidate(target as Candidate);
        }

        if (!selected) {
            return false;
        }

        return this.registerCandidate(key, selected);
    }

    /**
     * Deletes a candidate from the user dictionary and persists the deletion.
     * Broadcasts sync notification.
     *
     * @param key The dictionary key
     * @param candidate The candidate to delete
     * @returns True if candidate was found and deleted
     */
    public async deleteCandidate(key: string, candidate: Candidate): Promise<boolean> {
        await this.ensureLoaded();

        // 永続化に失敗した場合は、再試行できるようキャッシュを維持します。
        const success = await this.userStorage.deleteCandidate(key, candidate);

        // 対象が既に存在しない場合も、古いキャッシュから取り除きます。
        const list = this.userDictionary.get(key);
        if (list) {
            const idx = list.findIndex((c) => candidateIdentity(c) === candidateIdentity(candidate));
            if (idx !== -1) {
                list.splice(idx, 1);
            }
            if (list.length === 0) {
                this.userDictionary.delete(key);
            }
        }

        if (success) {
            const mutationId = this.generateMutationId();
            this.markMutationProcessed(mutationId);

            // Broadcast to remote tabs
            this.syncNotifier?.broadcastMutation({
                type: "CANDIDATE_DELETED",
                key,
                candidate: copyCandidate(candidate),
                senderId: this.senderId,
                mutationId,
                timestamp: Date.now(),
            });
        }

        return success;
    }

    /**
     * Returns a copy of the user dictionary map (useful for inspection or testing).
     */
    public getUserDictionary(): Map<string, Candidate[]> {
        const copy = new Map<string, Candidate[]>();
        for (const [k, v] of this.userDictionary) {
            copy.set(k, [...v]);
        }
        return copy;
    }

    /**
     * Cleans up sync listeners when the provider is destroyed.
     */
    public destroy(): void {
        this.unsubscribeSync?.();
        this.unsubscribeSync = undefined;
    }
}
