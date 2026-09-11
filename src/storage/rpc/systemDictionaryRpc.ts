import { handleDictionaryUpload } from './systemDictionaryUpload';
import type { IUserJisyoStorage } from '../../core/skk/jisyo/IJisyoStorage';
import { CompositeJisyoProvider } from '../../core/skk/jisyo/CompositeJisyoProvider';
import { copyCandidate } from '../../core/skk/jisyo/candidate';
import type { SystemDictionaryPreview } from './messages';
import type { SystemDictionaryManager } from '../jisyo/SystemDictionaryManager';

/** 辞書管理 RPC は許可した拡張機能のトップレベル画面に限定します。 */
export function assertSystemSettingsSender(sender: unknown, extensionId: string, extensionRoot: string): void {
    if (!sender || typeof sender !== 'object') throw new Error('拡張機能の設定画面から操作してください。');
    const value = sender as { id?: unknown; url?: unknown; frameId?: unknown; tab?: { url?: unknown } };
    if (value.id !== extensionId || typeof value.url !== 'string' || (value.frameId !== undefined && value.frameId !== 0)) {
        throw new Error('拡張機能の設定画面から操作してください。');
    }
    const allowed = ['options.html', 'popup.html', 'diagnostics.html'].map((path) => extensionRoot + path);
    const clean = (url: string) => url.split(/[?#]/)[0];
    if (!allowed.includes(clean(value.url)!) || (value.tab && (typeof value.tab.url !== 'string' || !allowed.includes(clean(value.tab.url)!)))) {
        throw new Error('拡張機能の設定画面から操作してください。');
    }
}

/** 候補診断からは初期化待機と表示に必要な読み取りだけを許可します。 */
export function assertDiagnosticsReadOnly(message: Record<string, unknown>, sender: unknown, extensionId: string, extensionRoot: string): void {
    const url = sender && typeof sender === 'object' && 'url' in sender ? sender.url : undefined;
    if (typeof url !== 'string' || url.split(/[?#]/)[0] !== extensionRoot + 'diagnostics.html') return;
    assertSystemSettingsSender(sender, extensionId, extensionRoot);
    if (!['SKK_WAIT_READY', 'SKK_SYSTEM_STATUS', 'SKK_SYSTEM_PREVIEW'].includes(message.type as string)) {
        throw new Error('候補診断画面では読み取り操作だけを使用できます。');
    }
}

export async function handleSystemDictionaryRpc(manager: SystemDictionaryManager, message: Record<string, unknown>, sender: unknown, extensionId: string, extensionRoot: string, userStore?: IUserJisyoStorage): Promise<unknown> {
    assertSystemSettingsSender(sender, extensionId, extensionRoot);
    assertDiagnosticsReadOnly(message, sender, extensionId, extensionRoot);
    switch (message.type) {
        case 'SKK_SYSTEM_PREVIEW': {
            if (typeof message.key !== 'string' || !message.key || message.key.length > 1024
                || (message.okuri !== undefined && (typeof message.okuri !== 'string' || message.okuri.length > 1024))) {
                throw new Error('読みと送り仮名を正しく指定してください。');
            }
            if (!userStore) throw new Error('ユーザー辞書を読み取れません。');
            await manager.initialize();
            const system = await manager.store.lookup(message.key);
            const provider = new CompositeJisyoProvider(userStore, [{ lookup: async () => system }]);
            const effective = await provider.lookupCandidates(message.key);
            const okuri = message.okuri as string | undefined;
            const select = (entry: typeof system) => (okuri === undefined ? entry : entry?.forOkuri(okuri))?.getCandidateList().map(copyCandidate) ?? [];
            return { key: message.key, okuri, systemCandidates: select(system), effectiveCandidates: select(effective) } satisfies SystemDictionaryPreview;
        }
        case 'SKK_SYSTEM_IMPORT_BEGIN':
        case 'SKK_SYSTEM_IMPORT_CHUNK':
        case 'SKK_SYSTEM_IMPORT_FINISH':
        case 'SKK_SYSTEM_IMPORT_CANCEL': return handleDictionaryUpload(manager, message, sender);
        case 'SKK_SYSTEM_STATUS': return manager.status();
        case 'SKK_SYSTEM_CONFIGURE': return manager.configure(message.dictionaries);
        case 'SKK_SYSTEM_IMPORT': return manager.importDictionary(message.dictionary, message.bytes);
        case 'SKK_SYSTEM_UPDATE': return manager.update(message.dictId);
        default: throw new Error('未対応の辞書設定操作です。');
    }
}
