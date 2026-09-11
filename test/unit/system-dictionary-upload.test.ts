import { describe, expect, it, vi } from 'vitest';
import type { SystemDictionaryManager } from '../../src/storage/jisyo/SystemDictionaryManager';
import { handleSystemDictionaryRpc } from '../../src/storage/rpc/systemDictionaryRpc';
const root = 'moz-extension://test/';
const sender = { id: 'test', url: root + 'options.html', tab: { id: 1, url: root + 'options.html' } };
const dictionary = { dictId: 'local-test', name: 'test', kind: 'local', format: 'text', source: 'local:test', enabled: true };
function setup() {
    const commit = vi.fn(async () => 'saved');
    const manager = { importDictionaryBytes: commit } as unknown as SystemDictionaryManager;
    const rpc = (message: Record<string, unknown>, source: unknown = sender) => handleSystemDictionaryRpc(manager, message, source, 'test', root);
    const begin = () => rpc({ type: 'SKK_SYSTEM_IMPORT_BEGIN', dictionary, size: 2 });
    return { commit, rpc, begin };
}
describe('bounded system dictionary upload', () => {
    it('requires ordered complete bytes and publishes only on finish', async () => {
        const { commit, rpc, begin } = setup();
        const token = await begin();
        await rpc({ type: 'SKK_SYSTEM_IMPORT_CHUNK', token, offset: 0, bytes: [1, 255] });
        expect(commit).not.toHaveBeenCalled();
        await expect(rpc({ type: 'SKK_SYSTEM_IMPORT_FINISH', token })).resolves.toBe('saved');
        expect(commit).toHaveBeenCalledWith(dictionary, new Uint8Array([1, 255]));
    });
    it('binds transfers to sender and rejects parallel begin without erasing the owner', async () => {
        const { rpc, begin } = setup();
        const token = await begin();
        await expect(begin()).rejects.toThrow();
        await expect(rpc({ type: 'SKK_SYSTEM_IMPORT_CANCEL', token }, { ...sender, tab: { ...sender.tab, id: 2 } })).rejects.toThrow();
        await expect(rpc({ type: 'SKK_SYSTEM_IMPORT_CANCEL', token }, { ...sender, id: 'other' })).rejects.toThrow();
        await rpc({ type: 'SKK_SYSTEM_IMPORT_CANCEL', token });
    });
    it.each([{ offset: 1, bytes: [1] }, { offset: 0, bytes: [256] }, { offset: 0, bytes: Array(65537).fill(0) }])('discards an invalid transfer', async (chunk) => {
        const { rpc, begin, commit } = setup();
        const token = await begin();
        await expect(rpc({ type: 'SKK_SYSTEM_IMPORT_CHUNK', token, ...chunk })).rejects.toThrow();
        await expect(rpc({ type: 'SKK_SYSTEM_IMPORT_FINISH', token })).rejects.toThrow();
        expect(commit).not.toHaveBeenCalled();
        const next = await begin();
        await rpc({ type: 'SKK_SYSTEM_IMPORT_CANCEL', token: next });
    });
    it('keeps the memory slot reserved during publication and releases it on failure', async () => {
        const { rpc, begin, commit } = setup();
        let fail!: (reason: Error) => void;
        commit.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
        const token = await begin();
        await rpc({ type: 'SKK_SYSTEM_IMPORT_CHUNK', token, offset: 0, bytes: [1, 2] });
        const finishing = rpc({ type: 'SKK_SYSTEM_IMPORT_FINISH', token });
        const rejected = expect(finishing).rejects.toThrow('quota');
        await expect(begin()).rejects.toThrow();
        await expect(rpc({ type: 'SKK_SYSTEM_IMPORT_FINISH', token })).rejects.toThrow();
        await expect(rpc({ type: 'SKK_SYSTEM_IMPORT_CANCEL', token })).rejects.toThrow();
        fail(new Error('quota'));
        await rejected;
        const next = await begin();
        await rpc({ type: 'SKK_SYSTEM_IMPORT_CANCEL', token: next });
    });
    it('expires abandoned transfers and rejects incomplete finish', async () => {
        vi.useFakeTimers();
        try {
            const { rpc, begin } = setup();
            const token = await begin();
            await vi.advanceTimersByTimeAsync(60_000);
            await expect(rpc({ type: 'SKK_SYSTEM_IMPORT_FINISH', token })).rejects.toThrow();
            const next = await begin();
            await expect(rpc({ type: 'SKK_SYSTEM_IMPORT_FINISH', token: next })).rejects.toThrow();
        } finally { vi.useRealTimers(); }
    });
});
