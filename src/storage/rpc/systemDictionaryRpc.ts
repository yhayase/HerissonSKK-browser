import type { SystemDictionaryManager } from '../jisyo/SystemDictionaryManager';

/** 設定変更は拡張機能のトップレベル画面に限定します。 */
export function assertSystemSettingsSender(sender: unknown, extensionId: string, extensionRoot: string): void {
    if (!sender || typeof sender !== 'object') throw new Error('拡張機能の設定画面から操作してください。');
    const value = sender as { id?: unknown; url?: unknown; frameId?: unknown; tab?: { url?: unknown } };
    if (value.id !== extensionId || typeof value.url !== 'string' || (value.frameId !== undefined && value.frameId !== 0)) {
        throw new Error('拡張機能の設定画面から操作してください。');
    }
    const allowed = ['options.html', 'popup.html'].map((path) => extensionRoot + path);
    const clean = (url: string) => url.split(/[?#]/)[0];
    if (!allowed.includes(clean(value.url)!) || (value.tab && (typeof value.tab.url !== 'string' || !allowed.includes(clean(value.tab.url)!)))) {
        throw new Error('拡張機能の設定画面から操作してください。');
    }
}

export async function handleSystemDictionaryRpc(manager: SystemDictionaryManager, message: Record<string, unknown>, sender: unknown, extensionId: string, extensionRoot: string): Promise<unknown> {
    assertSystemSettingsSender(sender, extensionId, extensionRoot);
    switch (message.type) {
        case 'SKK_SYSTEM_STATUS': return manager.status();
        case 'SKK_SYSTEM_CONFIGURE': return manager.configure(message.dictionaries);
        case 'SKK_SYSTEM_IMPORT': return manager.importDictionary(message.dictionary, message.bytes);
        case 'SKK_SYSTEM_UPDATE': return manager.update(message.dictId);
        default: throw new Error('未対応の辞書設定操作です。');
    }
}
