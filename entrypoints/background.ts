import { IndexedDbJisyoStore } from '@/src/storage/jisyo/IndexedDbJisyoStore';
import { IndexedDbUserStore } from '@/src/storage/user-jisyo/IndexedDbUserStore';
import { DictionaryLoader, type DictionaryDefinition } from '@/src/storage/jisyo/DictionaryLoader';
import { DEFAULT_STARTER_DICTIONARY_ID } from '@/src/storage/indexedDbSchema';
import { Candidate } from '@/src/core/skk/jisyo/candidate';
import type { SkkRpcRequest, CandidateData } from '@/src/storage/rpc/messages';
import type { IUserJisyoSyncEvent } from '@/src/core/skk/jisyo/CompositeJisyoProvider';

const SYSTEM_DICTIONARIES: readonly DictionaryDefinition[] = [
  {
    dictId: DEFAULT_STARTER_DICTIONARY_ID,
    dictPath: 'dict/SKK-JISYO.S.json',
    version: 'official-s-729e562f963e',
    format: 'json',
  },
];

export default defineBackground(() => {
  console.log('[SKK Background] Service worker initialized on extension origin:', browser.runtime.id);

  const systemStore = new IndexedDbJisyoStore({
    dictionaryIds: SYSTEM_DICTIONARIES.map((dictionary) => dictionary.dictId),
  });
  const userStore = new IndexedDbUserStore();

  let initPromise: Promise<void> | null = null;

  function ensureDictionaryReady(): Promise<void> {
    if (!initPromise) {
      initPromise = DictionaryLoader.ensureDictionaries(systemStore, SYSTEM_DICTIONARIES)
        .then((results) => {
          const count = results.reduce((sum, result) => sum + result.entryCount, 0);
          console.log(`[SKK Background] System dictionaries ready (${count} entries).`);
        })
        .catch(async (err) => {
          console.error('[SKK Background] Failed to load starter dictionary:', err);
          initPromise = null;
          const active = await Promise.all(
            SYSTEM_DICTIONARIES.map((dictionary) => systemStore.getActiveDictionary(dictionary.dictId))
          );
          if (active.some((dictionary) => dictionary !== undefined)) {
            console.warn('[SKK Background] Continuing with the previously active system dictionary.');
            return;
          }
          throw err;
        });
    }
    return initPromise;
  }

  // Initialize dictionary on extension install or update
  browser.runtime.onInstalled.addListener(() => {
    ensureDictionaryReady().catch(() => {});
  });

  // Also initiate initialization immediately upon startup
  ensureDictionaryReady().catch(() => {});

  /**
   * Broadcasts user dictionary mutation events to all open tabs.
   */
  async function broadcastToAllTabs(event: IUserJisyoSyncEvent): Promise<void> {
    try {
      const tabs = await browser.tabs.query({});
      for (const tab of tabs) {
        if (tab.id != null) {
          browser.tabs.sendMessage(tab.id, {
            type: 'SKK_USER_SYNC',
            event,
          }).catch(() => {
            // Ignore tab errors (tab might be internal or not listening yet)
          });
        }
      }
    } catch (err) {
      console.warn('[SKK Background] Failed to query tabs for broadcast:', err);
    }
  }

  /**
   * Dispatches RPC requests from Content Scripts.
   */
  async function handleRpc(message: SkkRpcRequest, _sender: any): Promise<any> {
    switch (message.type) {
      case 'SKK_WAIT_READY': {
        await ensureDictionaryReady();
        return { ready: true };
      }

      case 'SKK_JISYO_LOOKUP': {
        await ensureDictionaryReady();
        const entry = await systemStore.lookup(message.key);
        if (!entry) return null;
        return {
          midashigo: entry.getMidashigo(),
          candidates: entry.getCandidateList().map((c) => ({
            word: c.word,
            annotation: c.annotation,
          })),
        };
      }

      case 'SKK_JISYO_LOOKUP_PREFIX': {
        await ensureDictionaryReady();
        const entries = await systemStore.lookupPrefix(message.prefix, message.limit);
        return entries.map((e) => ({
          midashigo: e.getMidashigo(),
          candidates: e.getCandidateList().map((c) => ({
            word: c.word,
            annotation: c.annotation,
          })),
        }));
      }

      case 'SKK_USER_LOAD': {
        const entriesMap = await userStore.loadUserEntries();
        const result: Record<string, CandidateData[]> = {};
        for (const [key, candidates] of entriesMap.entries()) {
          result[key] = candidates.map((c) => ({
            word: c.word,
            annotation: c.annotation,
          }));
        }
        return result;
      }

      case 'SKK_USER_SAVE': {
        const cand = new Candidate(message.candidate.word, message.candidate.annotation);
        return await userStore.saveCandidate(message.key, cand);
      }

      case 'SKK_USER_REORDER': {
        const target = message.candidate ?? message.selectedIndex;
        if (target === undefined) {
          return false;
        }
        const cand =
          typeof target === 'object'
            ? new Candidate(target.word, target.annotation)
            : target;
        const success = await userStore.reorderCandidate(message.key, cand);
        if (success) {
          await broadcastToAllTabs({
            type: 'CANDIDATE_REORDERED',
            key: message.key,
            candidate: typeof message.candidate === 'object' ? message.candidate : undefined,
            selectedIndex: message.selectedIndex,
            senderId: message.senderId,
            mutationId: `bg_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`,
            timestamp: Date.now(),
          });
        }
        return success;
      }

      case 'SKK_USER_DELETE': {
        const cand = new Candidate(message.candidate.word, message.candidate.annotation);
        return await userStore.deleteCandidate(message.key, cand);
      }

      case 'SKK_USER_CLEAR': {
        const success = userStore.clear ? await userStore.clear() : false;
        if (success) {
          await broadcastToAllTabs({
            type: 'MUTATED',
            senderId: message.senderId,
          });
        }
        return success;
      }

      case 'SKK_USER_SAVE_ENTRIES': {
        const map = new Map<string, Candidate[]>();
        for (const [key, cands] of Object.entries(message.entries)) {
          map.set(
            key,
            cands.map((c) => new Candidate(c.word, c.annotation))
          );
        }
        const success = userStore.saveUserEntries ? await userStore.saveUserEntries(map) : false;
        if (success) {
          await broadcastToAllTabs({
            type: 'MUTATED',
            senderId: message.senderId,
          });
        }
        return success;
      }

      case 'SKK_USER_SYNC_BROADCAST': {
        await broadcastToAllTabs(message.event);
        return true;
      }

      default:
        throw new Error(`Unknown RPC message type: ${(message as any)?.type}`);
    }
  }

  // Register onMessage handler using the standard async response pattern
  browser.runtime.onMessage.addListener((message: any, sender: any, sendResponse: (res: any) => void) => {
    if (!message || typeof message !== 'object' || !message.type || !message.type.startsWith('SKK_')) {
      return false; // Not an SKK RPC message, do not handle
    }

    handleRpc(message, sender)
      .then((data) => {
        sendResponse({ ok: true, data });
      })
      .catch((err) => {
        console.error('[SKK Background] RPC handler error:', err);
        sendResponse({ ok: false, error: err?.message ?? String(err) });
      });

    return true; // Keep channel open for asynchronous sendResponse
  });
});
