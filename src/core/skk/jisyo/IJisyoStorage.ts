import type { Candidate } from "./candidate";
import type { Entry } from "./entry";

/**
 * Read-only storage interface for querying dictionary entries (e.g. system dictionary).
 * Implementations may back this with in-memory structures, IndexedDB, or precompiled trie/index.
 */
export interface IJisyoStorage {
    /**
     * Looks up candidates for an exact dictionary key (midashigo).
     *
     * @param key The dictionary key to look up (e.g., "とうきょう", "いk", "だい>")
     * @returns An Entry object if found, or undefined if no matching key exists
     */
    lookup(key: string): Promise<Entry | undefined>;

    /**
     * Optional prefix lookup for incremental search, completion, or suggestion.
     *
     * @param prefix The key prefix to search
     * @returns Array of matching entries
     */
    lookupPrefix?(prefix: string): Promise<Entry[]>;
}

/**
 * Read/write storage interface for user dictionary persistence.
 * Implementations manage user learning, LRU candidate ordering, and persistence (e.g. IndexedDB, Chrome storage, or memory).
 */
export interface IUserJisyoStorage {
    /**
     * Loads all user entries from storage.
     *
     * @returns Map of midashigo to candidate lists
     */
    loadUserEntries(): Promise<Map<string, Candidate[]>>;

    /**
     * Saves or registers a candidate for a given key.
     * If the candidate already exists, it should be moved to the front (LRU).
     *
     * @param key The dictionary key
     * @param candidate The candidate to save
     * @returns True if successfully saved
     */
    saveCandidate(key: string, candidate: Candidate): Promise<boolean>;

    /**
     * Reorders candidates for a key by moving the specified candidate to the front.
     * Supports passing a Candidate object, candidate word string, or numeric index (for backward compatibility).
     *
     * @param key The dictionary key
     * @param target The Candidate object, candidate word, or 0-based index of the candidate
     * @returns True if successfully reordered
     */
    reorderCandidate(key: string, target: Candidate | string | number): Promise<boolean>;

    /**
     * Deletes a candidate for a given key.
     * If all candidates for the key are deleted, the entry should be removed.
     *
     * @param key The dictionary key
     * @param candidate The candidate to delete
     * @returns True if candidate was found and deleted
     */
    deleteCandidate(key: string, candidate: Candidate): Promise<boolean>;

    /**
     * Optional bulk save of user dictionary entries (e.g. during import or flush).
     *
     * @param entries Map of dictionary keys to candidate lists
     * @returns True if successfully saved
     */
    saveUserEntries?(entries: Map<string, Candidate[]>): Promise<boolean>;

    /**
     * Optional clear of all user entries.
     *
     * @returns True if successfully cleared
     */
    clear?(): Promise<boolean>;
}
