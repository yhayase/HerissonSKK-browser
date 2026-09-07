import { IndexedDbJisyoStore } from '@/src/storage/jisyo/IndexedDbJisyoStore';
import { IndexedDbUserStore } from '@/src/storage/user-jisyo/IndexedDbUserStore';
import { DictionaryLoader } from '@/src/storage/jisyo/DictionaryLoader';
import { Candidate } from '@/src/core/skk/jisyo/candidate';
import type { SkkRpcRequest, CandidateData } from '@/src/storage/rpc/messages';
import type { IUserJisyoSyncEvent } from '@/src/core/skk/jisyo/CompositeJisyoProvider';

export default defineBackground(() => {
  console.log('[SKK Background] Service worker initialized on extension origin:', browser.runtime.id);

  const systemStore = new IndexedDbJisyoStore();
  const userStore = new IndexedDbUserStore();

  let initPromise: Promise<void> | null = null;

  function ensureDictionaryReady(): Promise<void> {
    if (!initPromise) {
      initPromise = DictionaryLoader.ensureInitialized(systemStore)
        .then((count) => {
          console.log(`[SKK Background] System dictionary loaded successfully (${count} entries).`);
        })
        .catch((err) => {
          console.error('[SKK Background] Failed to load starter dictionary:', err);
          initPromise = null; // allow retry on next attempt
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
        const success = await userStore.saveCandidate(message.key, cand);
        if (success) {
          await broadcastToAllTabs({
            type: 'CANDIDATE_SAVED',
            key: message.key,
            candidate: { word: cand.word, annotation: cand.annotation },
            senderId: message.senderId,
          });
        }
        return success;
      }

      case 'SKK_USER_REORDER': {
        const success = await userStore.reorderCandidate(message.key, message.selectedIndex);
        if (success) {
          await broadcastToAllTabs({
            type: 'CANDIDATE_REORDERED',
            key: message.key,
            selectedIndex: message.selectedIndex,
            senderId: message.senderId,
          });
        }
        return success;
      }

      case 'SKK_USER_DELETE': {
        const cand = new Candidate(message.candidate.word, message.candidate.annotation);
        const success = await userStore.deleteCandidate(message.key, cand);
        if (success) {
          await broadcastToAllTabs({
            type: 'CANDIDATE_DELETED',
            key: message.key,
            candidate: { word: cand.word, annotation: cand.annotation },
            senderId: message.senderId,
          });
        }
        return success;
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
