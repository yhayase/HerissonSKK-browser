import { describe, expect, it, vi } from 'vitest';
import { SettingsDraft, variants, validateLocalFile, definitions, publishSettings, startupMessage } from '../../src/settings/model';
import { SYSTEM_DICTIONARY_CATALOG, SYSTEM_OPERATION_ID, type SystemDictionaryStatus } from '../../src/storage/jisyo/SystemDictionaryConfiguration';
function status(revision = 1): SystemDictionaryStatus {
    return { revision, dictionaries: [
        { ...SYSTEM_DICTIONARY_CATALOG[0]!, state: 'ready', version: 'hash' },
        { ...SYSTEM_DICTIONARY_CATALOG.find((d) => d.kind === 'person')!, enabled: true, state: 'ready' },
    ], catalog: [...SYSTEM_DICTIONARY_CATALOG], operation: { dictId: SYSTEM_OPERATION_ID, state: 'idle' } };
}
describe('設定画面の編集状態', () => {
    it('ポーリングで未保存の順序と有効状態を置き換えません', () => {
        const draft = new SettingsDraft(); draft.receive(status()); draft.move(0, 1);
        draft.dictionaries[0]!.enabled = false;
        draft.receive(status());
        expect(draft.dictionaries.map((d) => d.kind)).toEqual(['person', 's']);
        expect(draft.dictionaries[0]!.enabled).toBe(false);
        expect(draft.dirty).toBe(true); expect(draft.conflict).toBe(false);
    });
    it('別画面の変更は保存構成だけへ反映し、明示的な破棄で編集を更新します', () => {
        const draft = new SettingsDraft(); draft.receive(status()); draft.move(0, 1);
        const remote = status(2); remote.dictionaries[0]!.enabled = false; draft.receive(remote);
        expect(draft.saved).toBe(remote); expect(draft.conflict).toBe(true);
        expect(draft.dictionaries[0]!.kind).toBe('person');
        draft.reset(); expect(draft.conflict).toBe(false); expect(draft.dirty).toBe(false);
        expect(draft.dictionaries[0]!.enabled).toBe(false);
    });
    it('古い応答を無視し、同じリビジョンでは表示中の編集対象を維持します', () => {
        const draft = new SettingsDraft(); draft.receive(status(2)); const row = draft.dictionaries[0];
        draft.receive(status(2)); expect(draft.dictionaries[0]).toBe(row);
        expect(draft.receive(status(1))).toBe(false); expect(draft.saved!.revision).toBe(2);
    });
    it('未編集なら外部の新しい構成を反映し、基本辞書も順序変更できます', () => {
        const draft = new SettingsDraft(); draft.receive(status()); const remote = status(2); remote.dictionaries.reverse();
        draft.receive(remote); expect(draft.dictionaries[0]!.kind).toBe('person');
        draft.move(1, -1); expect(draft.dictionaries[0]!.kind).toBe('s');
        draft.move(0, -1); draft.move(1, 1); expect(draft.dictionaries.map((d) => d.kind)).toEqual(['s', 'person']);
    });
    it('基本辞書を含む全辞書を削除でき、空の編集内容も破棄できます', () => {
        const draft = new SettingsDraft(); draft.receive(status());
        draft.remove(0); draft.remove(0);
        expect(draft.dictionaries).toEqual([]); expect(draft.dirty).toBe(true);
        draft.reset();
        expect(draft.dictionaries).toEqual(definitions(status())); expect(draft.dirty).toBe(false);
    });
    it('保存用データに状態メタデータを混入しません', () => {
        expect(definitions(status())[0]).not.toHaveProperty('state');
        expect(definitions(status())[0]).not.toHaveProperty('version');
    });
});
describe('形式とファイルの選択', () => {
    it('形式と種類の両方で公開カタログを絞り込みます', () => {
        const catalog = [...SYSTEM_DICTIONARY_CATALOG];
        expect(variants(catalog, 's', 'json')).toHaveLength(2);
        expect(variants(catalog, 'person', 'text').every((d) => d.kind === 'person' && d.format === 'text')).toBe(true);
        expect(variants(catalog, 'postal', 'json')).toEqual([]);
    });
    it('空ファイルと上限超過を拒否します', () => {
        expect(() => validateLocalFile(0)).toThrow();
        expect(() => validateLocalFile(64 * 1024 * 1024 + 1)).toThrow();
        expect(() => validateLocalFile(64 * 1024 * 1024)).not.toThrow();
        expect(() => validateLocalFile(1)).not.toThrow();
    });
});

describe('保存と状態再取得', () => {
    it('保存直後の取得が失敗しても、成功応答の構成を表示して保存済みにします', async () => {
        const draft = new SettingsDraft(); draft.receive(status()); draft.move(0, 1);
        const published = status(2); published.dictionaries.reverse();
        const rpc = vi.fn().mockResolvedValueOnce(published).mockRejectedValue(new Error('通信失敗'));
        const render = vi.fn(() => {
            expect(draft.saved).toBe(published);
            expect(draft.dictionaries.map((d) => d.kind)).toEqual(['person', 's']);
            expect(draft.dirty).toBe(false);
        });
        const result = await publishSettings(draft, () => rpc('configure'), render, async () => {
            expect(render).toHaveBeenCalledOnce();
            draft.receive(await rpc('status'));
        });
        expect(result).toHaveProperty('refreshError');
        expect(draft.saved!.revision).toBe(2);
        expect(draft.baseRevision).toBe(2);
        // 後続のポーリングも失敗した場合、確認済みの構成を維持します。
        await expect(rpc('status')).rejects.toThrow('通信失敗');
        expect(draft.saved).toBe(published);
        expect(draft.dictionaries).toEqual(definitions(published));
    });
    it('保存自体が失敗した場合は前の構成と未保存の編集を維持します', async () => {
        const draft = new SettingsDraft(); const previous = status(); draft.receive(previous); draft.move(0, 1);
        const rpc = vi.fn().mockRejectedValue(new Error('保存失敗'));
        const render = vi.fn(); const refresh = vi.fn();
        await expect(publishSettings(draft, rpc, render, refresh)).rejects.toThrow('保存失敗');
        expect(draft.saved).toBe(previous); expect(draft.dirty).toBe(true);
        expect(draft.dictionaries[0]!.kind).toBe('person');
        expect(render).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
    });
});

describe('初回の未公開状態', () => {
    it('リビジョン 0 では編集を許可せず、初回公開を競合扱いしません', () => {
        const draft = new SettingsDraft();
        expect(draft.canEdit).toBe(false);
        draft.receive(status(0));
        expect(draft.published).toBe(false); expect(draft.canEdit).toBe(false);
        expect(draft.dictionaries).toEqual([]);
        draft.move(0, 1);
        expect(draft.dirty).toBe(false);
        expect(startupMessage(draft.saved)).toContain('構成はまだ保存されていません');
        const updating = status(0); updating.operation.state = 'updating'; draft.receive(updating);
        expect(draft.canEdit).toBe(false);
        draft.receive(status(1));
        expect(draft.published).toBe(true); expect(draft.canEdit).toBe(true);
        expect(draft.dirty).toBe(false); expect(draft.conflict).toBe(false);
        expect(draft.dictionaries).toEqual(definitions(status(1)));
        expect(startupMessage(draft.saved)).toBeUndefined();
    });
    it('初期化エラーを隠さず、再試行後の公開で編集を許可します', () => {
        const draft = new SettingsDraft(); const failed = status(0);
        failed.operation = { dictId: SYSTEM_OPERATION_ID, state: 'error', error: '辞書を読み込めません' };
        draft.receive(failed); draft.receive(structuredClone(failed));
        expect(draft.canEdit).toBe(false);
        expect(startupMessage(draft.saved)).toContain('初期化失敗：辞書を読み込めません');
        expect(startupMessage(draft.saved)).toContain('再試行');
        expect(startupMessage(draft.saved)).not.toContain('前の構成');
        draft.receive(status(1));
        expect(draft.canEdit).toBe(true); expect(draft.conflict).toBe(false);
    });
});
