import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Candidate } from '../../src/core/skk/jisyo/candidate';
import { parseJisyoText, formatJisyoText } from '../../src/core/skk/jisyo/JisyoParser';
import { CompositeJisyoProvider, type IUserJisyoSyncEvent } from '../../src/core/skk/jisyo/CompositeJisyoProvider';
import { SystemDictionaryManager } from '../../src/storage/jisyo/SystemDictionaryManager';
import { IndexedDbUserStore } from '../../src/storage/user-jisyo/IndexedDbUserStore';
import { RemoteUserStore } from '../../src/storage/user-jisyo/RemoteUserStore';
import { RemoteJisyoStore } from '../../src/storage/jisyo/RemoteJisyoStore';
import { handleSystemDictionaryRpc } from '../../src/storage/rpc/systemDictionaryRpc';
import type { SystemDictionaryPreview } from '../../src/storage/rpc/messages';
import type { SystemDictionaryDefinition } from '../../src/storage/jisyo/SystemDictionaryConfiguration';
import { MockEditor } from './mocks/MockEditor';
import { HiraganaMode } from '../../src/core/skk/input-mode/HiraganaMode';
import { EditorFactory } from '../../src/core/skk/editor/EditorFactory';

const close: Array<() => void> = [];
afterEach(() => { close.splice(0).forEach((f) => f()); EditorFactory.reset(); });
const local = (id: string): SystemDictionaryDefinition => ({ dictId: `local-${id}`, name: id, kind: 'local', source: `local:${id}`, format: 'text', enabled: true });
async function setup() {
    const dbName = `metadata-${crypto.randomUUID()}`;
    const manager = new SystemDictionaryManager({ dbName, download: async () => ({ bytes: new TextEncoder().encode(JSON.stringify({ copyright: '', license: '', okuri_ari: {}, okuri_nasi: { 'かな': ['JSON;literal', '(concat "literal")'] } })) }) });
    const user = new IndexedDbUserStore({ dbName });
    close.push(() => manager.store.close(), () => user.close());
    await manager.importDictionary(local('a'), Array.from(new TextEncoder().encode('かな /先/共通;上位/後/\nおおk /[く/多;多い/]/[き/大/]/\n')));
    await manager.importDictionary(local('b'), Array.from(new TextEncoder().encode('かな /共通;下位/末尾/\nおおk /[く/多;下位/大/]/\n')));
    const definitions = (await manager.status()).dictionaries;
    await manager.configure([definitions[1], definitions[2], definitions[0]]);
    return { manager, user, provider: new CompositeJisyoProvider(user, [manager.store]), definitions };
}

describe('候補の条件と出典', () => {
    it('辞書順と内部順、下位注釈、JSON の文字列を保持する', async () => {
        const { provider } = await setup();
        const list = (await provider.lookupCandidates('かな'))!.getCandidateList();
        expect(list.map((c) => c.word)).toEqual(['先', '共通', '後', '末尾', 'JSON;literal', '(concat "literal")']);
        expect(list[1]?.annotation).toBe('上位');
        expect(list[1]?.sources).toEqual([
            { kind: 'system', dictId: 'local-a', name: 'a', annotation: '上位' },
            { kind: 'system', dictId: 'local-b', name: 'b', annotation: '下位' },
        ]);
    });

    it('送り仮名条件をパース、保存、RPC、学習、同期で維持する', async () => {
        const { manager, user } = await setup();
        const events: IUserJisyoSyncEvent[] = [];
        let receiver!: (event: IUserJisyoSyncEvent) => void;
        const remote = new RemoteJisyoStore({ client: { sendMessage: async (request: any) => JSON.parse(JSON.stringify({ midashigo: request.key, candidates: (await manager.store.lookup(request.key))?.getCandidateList() })) } });
        const remoteUser = new RemoteUserStore({ client: { sendMessage: async (request: any) => {
            const data = JSON.parse(JSON.stringify(request));
            if (data.type === 'SKK_USER_LOAD') return Object.fromEntries(await user.loadUserEntries()) as any;
            return await user.saveCandidate(data.key, data.candidate) as any;
        } } });
        const provider = new CompositeJisyoProvider(remoteUser, [remote], { broadcastMutation: (e) => events.push(e!), onRemoteMutation: () => () => {} });
        const other = new CompositeJisyoProvider(user, [remote], { broadcastMutation: () => {}, onRemoteMutation: (f) => { receiver = f; return () => {}; } });
        await other.init();
        const entry = (await provider.lookupCandidates('おおk'))!;
        expect(entry.getCandidateList().map((c) => [c.word, c.okuri])).toEqual([['多', 'く'], ['大', 'き'], ['大', 'く']]);
        const applicable = entry.forOkuri('く')!;
        expect(applicable.getCandidateList().map((c) => c.word)).toEqual(['多', '大']);
        await provider.reorderCandidate('おおk', applicable.getRawCandidateList()[1]!);
        receiver(JSON.parse(JSON.stringify(events[0])));
        expect((await other.lookupCandidates('おおk'))!.forOkuri('き')!.getCandidateList().map((c) => c.word)).toEqual(['大']);
        const learned = (await new CompositeJisyoProvider(user, [remote]).lookupCandidates('おおk'))!;
        expect(learned.getCandidateList()[0]?.okuri).toBe('く');
        expect(learned.getCandidateList()[0]?.sources?.map((s) => s.kind)).toEqual(['learned', 'system']);
        expect(learned.forOkuri('け')).toBeUndefined();
        const parsed = parseJisyoText('おおk /共通/[く/多/]/[き/大/]/');
        expect(parseJisyoText(formatJisyoText(parsed))).toEqual(parsed);
    });

    it('実際の送りあり変換は一致する候補だけを表示する', async () => {
        const { provider } = await setup();
        const editor = new MockEditor();
        vi.spyOn(editor, 'getJisyoProvider').mockReturnValue(provider);
        EditorFactory.setInstance(editor);
        const mode = HiraganaMode.getInstance();
        editor.setInputMode(mode);
        await mode.upperAlphabetInput('O');
        await mode.lowerAlphabetInput('o');
        await mode.upperAlphabetInput('K');
        await mode.lowerAlphabetInput('i');
        expect(editor.getCurrentText()).toContain('大');
        expect(editor.getCurrentText()).not.toContain('多');
        const entry = (await provider.lookupCandidates('おおk'))!;
        const duplicate = new Candidate('多', '無条件', { sources: [{ kind: 'system', dictId: 'unconditional' }] });
        const { Entry } = await import('../../src/core/skk/jisyo/entry');
        const filtered = new Entry('おおk', [...entry.getRawCandidateList(), duplicate], '').forOkuri('く')!;
        expect(filtered.getCandidateList().map((c) => c.word)).toEqual(['多', '大']);
        expect(filtered.getCandidateList()[0]?.sources).toHaveLength(3);
        expect(filtered.getRawCandidateList()[0]?.okuri).toBe('く');
    });

    it('設定プレビューは同じシステム候補に学習順位を重ね、送り仮名で絞る', async () => {
        const { manager, user, provider } = await setup();
        await provider.registerCandidate('かな', new Candidate('末尾'));
        const preview = await handleSystemDictionaryRpc(manager, { type: 'SKK_SYSTEM_PREVIEW', key: 'かな', okuri: '' }, { id: 'ext', url: 'chrome-extension://ext/options.html' }, 'ext', 'chrome-extension://ext/', user) as SystemDictionaryPreview;
        expect(preview.systemCandidates[0]?.word).toBe('先');
        expect(preview.effectiveCandidates[0]?.word).toBe('末尾');
        expect(preview.effectiveCandidates[0]?.sources?.map((s) => s.kind)).toEqual(['learned', 'system']);
        await expect(handleSystemDictionaryRpc(manager, { type: 'SKK_SYSTEM_PREVIEW', key: 'かな' }, { id: 'ext', url: 'https://example.com' }, 'ext', 'chrome-extension://ext/', user)).rejects.toThrow();
    });

    it('変換中の候補を維持し、次の変換から新しい辞書順を使う', async () => {
        const { manager, provider, definitions } = await setup();
        const editor = new MockEditor();
        vi.spyOn(editor, 'getJisyoProvider').mockReturnValue(provider);
        EditorFactory.setInstance(editor);
        const mode = HiraganaMode.getInstance();
        editor.setInputMode(mode);
        const convert = async () => {
            await mode.upperAlphabetInput('K');
            for (const c of 'ana') await mode.lowerAlphabetInput(c);
            await mode.spaceInput();
        };
        await convert();
        expect(editor.getCurrentText()).toContain('先');
        await manager.configure([definitions[2], definitions[1], definitions[0]]);
        await mode.spaceInput();
        expect(editor.getCurrentText()).toContain('共通');
        await mode.spaceInput();
        expect(editor.getCurrentText()).toContain('後');
        await mode.spaceInput();
        expect(editor.getCandidateList().candidates.map((c) => c.word)).toEqual(['末尾', 'JSON;literal', '(concat "literal")']);
        await mode.ctrlGInput();
        await mode.ctrlGInput();
        await mode.ctrlGInput();
        await convert();
        expect(editor.getCurrentText()).toContain('共通');
    });
});
