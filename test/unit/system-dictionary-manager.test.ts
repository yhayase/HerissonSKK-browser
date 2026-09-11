import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemDictionaryManager } from '../../src/storage/jisyo/SystemDictionaryManager';
import { SYSTEM_DICTIONARY_CATALOG, DEFAULT_SYSTEM_DICTIONARIES, SYSTEM_OPERATION_ID, validateSystemDictionaries, type SystemDictionaryDefinition } from '../../src/storage/jisyo/SystemDictionaryConfiguration';
import { IndexedDbJisyoStore } from '../../src/storage/jisyo/IndexedDbJisyoStore';
import { Candidate } from '../../src/core/skk/jisyo/candidate';
import { handleSystemDictionaryRpc } from '../../src/storage/rpc/systemDictionaryRpc';

const managers: SystemDictionaryManager[] = [];
const names = new Set<string>();
const bytes = (word: string) => new TextEncoder().encode(`かな /${word}/\n`);
const local = (id: string, enabled = true): SystemDictionaryDefinition => ({ dictId: `local-${id}`, name: id, kind: 'local', format: 'text', source: `local:${id}`, enabled });
const custom = (id: string, source = `https://dictionary.example/${id}.txt`, enabled = true): SystemDictionaryDefinition => ({ dictId: `custom-${id}`, name: id, kind: 'custom', format: 'text', source, enabled });
function create(download = vi.fn(async () => ({ bytes: new TextEncoder().encode(JSON.stringify({ copyright: 'test', license: 'test', okuri_ari: {}, okuri_nasi: { 'かな': ['基本'] } })) })), name = `manager-${crypto.randomUUID()}`) {
    names.add(name);
    const manager = new SystemDictionaryManager({ dbName: name, download });
    managers.push(manager);
    return { manager, download, name };
}
async function words(manager: SystemDictionaryManager) {
    return (await manager.store.lookup('かな'))?.getCandidateList().map((c) => c.word);
}
afterEach(async () => {
    for (const manager of managers.splice(0)) manager.store.close();
    for (const name of names) await IndexedDbJisyoStore.deleteDatabase(name);
    names.clear();
});

describe('system dictionary configuration', () => {
    it('基本辞書 M の公式テキスト版と JSON 版をカタログに掲載します', () => {
        expect(SYSTEM_DICTIONARY_CATALOG.filter((d) => d.kind === 'm')).toEqual([
            expect.objectContaining({ dictId: 'skk-jisyo-m', format: 'text', source: 'https://raw.githubusercontent.com/skk-dev/dict/master/SKK-JISYO.M' }),
            expect.objectContaining({ dictId: 'skk-jisyo-m', format: 'json', source: 'https://raw.githubusercontent.com/skk-dev/dict/master/json/SKK-JISYO.M.json' }),
        ]);
    });

    it('カスタム辞書の HTTP(S) URL を正規化し、危険な URL を拒否します', () => {
        expect(validateSystemDictionaries([custom('valid', 'http://example.test/a/../dict#part')])[0]!.source).toBe('http://example.test/dict#part');
        for (const source of [
            'ftp://example.test/dict', 'https://user@example.test/dict', 'https://user:secret@example.test/dict', 'not a url',
            'https://*/dictionary', 'https://*.example.test/dictionary', 'https://%2A.example.test/dictionary',
        ]) {
            expect(() => validateSystemDictionaries([custom('invalid', source)])).toThrow();
        }
        expect(() => validateSystemDictionaries([{ ...custom('invalid'), dictId: 'catalog-shaped' }])).toThrow();
    });

    it('カスタム辞書を保存して再利用し、取得失敗時は直前の構成を維持します', async () => {
        const { manager, download, name } = create();
        await manager.initialize();
        const first = custom('shared', 'http://dictionary.example/first.txt');
        download.mockResolvedValueOnce({ bytes: bytes('共有候補') });
        const imported = await manager.configure([...(await manager.status()).dictionaries, first]);
        expect(imported.dictionaries.at(-1)).toMatchObject(first);
        expect(await words(manager)).toEqual(['基本', '共有候補']);

        const before = await manager.store.getSystemConfiguration();
        const replacement = { ...first, source: 'https://dictionary.example/replacement.json', format: 'json' as const };
        download.mockRejectedValueOnce(new Error('取得失敗'));
        await expect(manager.configure([replacement])).rejects.toThrow('取得失敗');
        expect(await manager.store.getSystemConfiguration()).toEqual(before);
        expect(await words(manager)).toEqual(['基本', '共有候補']);

        await manager.configure([{ ...first, enabled: false }]);
        expect(download).toHaveBeenCalledTimes(3);
        expect(await words(manager)).toBeUndefined();
        const offline = vi.fn(async () => { throw new Error('オフライン'); });
        const restarted = create(offline, name).manager;
        await restarted.initialize();
        await restarted.configure([first]);
        expect(offline).not.toHaveBeenCalled();
        expect(await words(restarted)).toEqual(['共有候補']);
    });

    it('persists ordering, disabled bytes and an empty enabled set across restart', async () => {
        const { manager, name } = create();
        await manager.importDictionary(local('a'), [...bytes('追加')]);
        const status = await manager.status();
        await manager.configure([status.dictionaries[1], status.dictionaries[0]]);
        expect(await words(manager)).toEqual(['追加', '基本']);
        await manager.configure([{ ...status.dictionaries[1], enabled: false }, { ...status.dictionaries[0], enabled: false }]);
        expect(await words(manager)).toBeUndefined();
        const offline = vi.fn(async () => { throw new Error('offline'); });
        const restarted = create(offline, name).manager;
        await restarted.initialize();
        await restarted.configure([local('a'), status.dictionaries[0]]);
        expect(await words(restarted)).toEqual(['追加', '基本']);
        expect(offline).not.toHaveBeenCalled();
    });

    it('空の構成を再起動後も維持し、削除した辞書のキャッシュを再利用します', async () => {
        const { manager, name } = create();
        await manager.initialize();
        const bundled = (await manager.status()).dictionaries[0]!;
        const empty = await manager.configure([]);
        expect(empty.dictionaries).toEqual([]);
        expect(await words(manager)).toBeUndefined();

        const offline = vi.fn(async () => { throw new Error('offline'); });
        const restarted = create(offline, name).manager;
        await restarted.initialize();
        expect((await restarted.status()).dictionaries).toEqual([]);
        expect(await words(restarted)).toBeUndefined();
        await restarted.configure([bundled]);
        expect(await words(restarted)).toEqual(['基本']);
        expect(offline).not.toHaveBeenCalled();
    });

    it('switches the same dictionary between mixed formats and restores each cached source offline', async () => {
        const { manager, download } = create();
        await manager.initialize();
        const original = (await manager.status()).dictionaries[0]!;
        const text = SYSTEM_DICTIONARY_CATALOG.find((d) => d.source === 'dict/SKK-JISYO.S')!;
        download.mockResolvedValueOnce({ bytes: bytes('テキスト') });
        await manager.configure([text]);
        expect(await words(manager)).toEqual(['テキスト']);
        download.mockRejectedValue(new Error('offline'));
        await manager.configure([original]);
        expect(await words(manager)).toEqual(['基本']);
        expect((await manager.status()).dictionaries[0]?.source).toBe(original.source);
        await manager.configure([text]);
        expect(await words(manager)).toEqual(['テキスト']);
        await manager.importDictionary(local('extra'), [...bytes('追加')]);
        expect(await words(manager)).toEqual(['テキスト', '追加']);
    });

    it('keeps the full prior configuration on a later staging failure and permits retry', async () => {
        const { manager, download } = create();
        await manager.initialize();
        const old = await manager.status();
        const l = { ...SYSTEM_DICTIONARY_CATALOG.find((d) => d.kind === 'l' && d.format === 'text')!, enabled: true };
        const person = { ...SYSTEM_DICTIONARY_CATALOG.find((d) => d.kind === 'person' && d.format === 'text')!, enabled: true };
        download.mockResolvedValueOnce({ bytes: bytes('大辞書') }).mockRejectedValueOnce(new Error('failed person'));
        await expect(manager.configure([l, person])).rejects.toThrow('failed person');
        expect((await manager.status()).dictionaries).toEqual(old.dictionaries);
        expect(await words(manager)).toEqual(['基本']);
        download.mockResolvedValue({ bytes: bytes('再試行') });
        await manager.configure([l, person]);
        expect((await manager.status()).dictionaries.map((d) => d.dictId)).toEqual([l.dictId, person.dictId]);
    });

    it('does not block lookups or status while a download is pending; metadata stays published', async () => {
        const { manager, download } = create();
        await manager.initialize();
        const before = await manager.status();
        let release!: (value: { bytes: Uint8Array<ArrayBuffer> }) => void;
        download.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
        const updating = manager.update(DEFAULT_SYSTEM_DICTIONARIES[0]!.dictId);
        await vi.waitFor(() => expect(release).toBeDefined());
        expect(await words(manager)).toEqual(['基本']);
        const status = await manager.status();
        expect(status.operation.state).toBe('updating');
        expect(status.dictionaries).toEqual(before.dictionaries);
        release({ bytes: new TextEncoder().encode(JSON.stringify({ copyright: 'test', license: 'test', okuri_ari: {}, okuri_nasi: { 'かな': ['更新'] } })) });
        await updating;
        expect(await words(manager)).toEqual(['更新']);
        expect((await manager.status()).dictionaries[0]?.version).not.toBe(before.dictionaries[0]?.version);
    });

    it('serializes concurrent imports from different manager instances without losing either', async () => {
        const { manager, name } = create();
        const second = create(undefined, name).manager;
        await Promise.all([manager.importDictionary(local('a'), [...bytes('甲')]), second.importDictionary(local('b'), [...bytes('乙')])]);
        expect((await manager.status()).dictionaries).toHaveLength(3);
        expect(await words(manager)).toEqual(['基本', '甲', '乙']);
    });

    it('recovers an interrupted stage without deleting cached active generations', async () => {
        const { manager, name } = create();
        await manager.initialize();
        await manager.store.stageGeneration('local-abandoned', 'config-abandoned', [{ key: 'かな', candidates: [new Candidate('未公開')] }]);
        await manager.store.setSystemOperation({ dictId: SYSTEM_OPERATION_ID, state: 'updating', generations: [{ dictId: 'local-abandoned', generation: 'config-abandoned' }] });
        const restarted = create(undefined, name).manager;
        await restarted.recover();
        expect(await words(restarted)).toEqual(['基本']);
        expect((await restarted.status()).operation.state).toBe('error');
        await expect(restarted.store.publishGeneration({ dictId: 'local-abandoned', activeGeneration: 'config-abandoned', version: 'x', entryCount: 1 }, 0)).rejects.toThrow();
    });

    it('rolls back a failed publication transaction and rejects a stale revision', async () => {
        const { manager } = create();
        await manager.importDictionary(local('a'), [...bytes('追加')]);
        const before = (await manager.store.getSystemConfiguration())!;
        const changed = structuredClone(before);
        changed.revision++;
        changed.cache[1]!.active.entryCount++;
        changed.dictionaries.reverse();
        await expect(manager.store.publishSystemConfiguration(changed, before.revision)).rejects.toThrow();
        expect(await manager.store.getSystemConfiguration()).toEqual(before);
        expect(await words(manager)).toEqual(['基本', '追加']);
        expect(await manager.store.publishSystemConfiguration(before, before.revision - 1)).toBe(false);
    });

    it('adopts an existing text generation offline without mislabelling its format', async () => {
        const { manager, download } = create();
        await manager.store.stageGeneration('skk-jisyo-s', 'old', [{ key: 'かな', candidates: [new Candidate('旧辞書')] }]);
        await manager.store.publishGeneration({ dictId: 'skk-jisyo-s', activeGeneration: 'old', entryCount: 1, version: '1.0.0' }, 0);
        download.mockRejectedValue(new Error('offline'));
        await manager.initialize();
        expect(await words(manager)).toEqual(['旧辞書']);
        expect((await manager.status()).dictionaries[0]).toMatchObject({ source: 'dict/SKK-JISYO.S', format: 'text', version: '1.0.0' });
        expect(download).not.toHaveBeenCalled();
    });

    it('preserves the old configuration if a staged database write fails', async () => {
        const { manager, download } = create();
        await manager.initialize();
        const before = await manager.status();
        const l = { ...SYSTEM_DICTIONARY_CATALOG.find((d) => d.kind === 'l' && d.format === 'text')!, enabled: true };
        download.mockResolvedValue({ bytes: bytes('大辞書') });
        vi.spyOn(manager.store, 'stageGeneration').mockRejectedValueOnce(new Error('quota'));
        await expect(manager.configure([l])).rejects.toThrow('quota');
        expect((await manager.status()).dictionaries).toEqual(before.dictionaries);
        expect(await words(manager)).toEqual(['基本']);
        await manager.configure([l]);
        expect(await words(manager)).toEqual(['大辞書']);
    });

    it('rejects a 101st dictionary without mutation but permits replacement at the limit', async () => {
        const { manager } = create();
        await manager.importDictionary(local('existing'), [...bytes('元候補')]);
        const initial = (await manager.status()).dictionaries;
        await manager.configure([...initial, ...Array.from({ length: 98 }, (_, i) => local(`disabled-${i}`, false))]);
        const before = (await manager.store.getSystemConfiguration())!;
        const operation = await manager.store.getSystemOperation();
        const stage = vi.spyOn(manager.store, 'stageGeneration');

        await expect(manager.importDictionary(local('overflow'), [...bytes('追加不可')])).rejects.toThrow();
        expect(await manager.store.getSystemConfiguration()).toEqual(before);
        expect(await manager.store.getSystemOperation()).toEqual(operation);
        expect(await manager.store.getActiveDictionary('local-overflow')).toBeUndefined();
        expect(stage).not.toHaveBeenCalled();
        expect(await words(manager)).toEqual(['基本', '元候補']);

        const replaced = await manager.importDictionary(local('existing'), [...bytes('置換候補')]);
        expect(replaced.revision).toBe(before.revision + 1);
        expect(replaced.dictionaries).toHaveLength(100);
        expect(replaced.dictionaries.map((d) => d.dictId)).toEqual(before.dictionaries.map((d) => d.dictId));
        expect(await words(manager)).toEqual(['基本', '置換候補']);
    });

    it('rejects malformed settings and import bytes before modifying the database', async () => {
        const { manager } = create();
        await expect(manager.configure([{ ...DEFAULT_SYSTEM_DICTIONARIES[0], source: 'https://evil.test/dict' }])).rejects.toThrow();
        await expect(manager.configure([custom('credentials', 'https://user:secret@evil.test/dict')])).rejects.toThrow();
        await expect(manager.configure([local('a'), local('a')])).rejects.toThrow();
        await expect(manager.configure([{ ...local('a'), enabled: 'yes' }])).rejects.toThrow();
        await expect(manager.importDictionary(local('a'), [256])).rejects.toThrow();
        await expect(manager.importDictionary(local('a'), [-1])).rejects.toThrow();
        expect((await manager.status()).revision).toBe(0);
    });

    it('rejects content script, foreign extension, subframe and forged settings URLs', async () => {
        const { manager } = create();
        const request = { type: 'SKK_SYSTEM_CONFIGURE', dictionaries: [] };
        for (const sender of [
            { id: 'id', url: 'https://site.test/', tab: { url: 'https://site.test/' } },
            { id: 'other', url: 'chrome-extension://id/options.html' },
            { id: 'id', url: 'chrome-extension://id/options.html', frameId: 1 },
            { id: 'id', url: 'chrome-extension://id/options.html', tab: { url: 'https://site.test/' } },
            { id: 'id', url: 'chrome-extension://id/options.html.evil' },
        ]) await expect(handleSystemDictionaryRpc(manager, request, sender, 'id', 'chrome-extension://id/')).rejects.toThrow();
        const status = await handleSystemDictionaryRpc(manager, { type: 'SKK_SYSTEM_STATUS' }, { id: 'id', url: 'chrome-extension://id/options.html', frameId: 0 }, 'id', 'chrome-extension://id/');
        expect(status).toHaveProperty('revision', 0);
    });
});
