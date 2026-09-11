import { MAX_DICTIONARY_BYTES, type SystemDictionaryManager } from '../jisyo/SystemDictionaryManager';
import { validateSystemDictionaries, type SystemDictionaryDefinition } from '../jisyo/SystemDictionaryConfiguration';

export const UPLOAD_CHUNK_BYTES = 64 * 1024;
const uploads = new WeakMap<SystemDictionaryManager, { token: string; owner: string; definition: SystemDictionaryDefinition; bytes: Uint8Array; offset: number; finishing?: boolean; timer: ReturnType<typeof setTimeout> }>();

/** 認証済み設定画面の転送を一件だけ保持し、未完了の転送は期限切れで破棄します。 */
export async function handleDictionaryUpload(manager: SystemDictionaryManager, message: Record<string, unknown>, sender: unknown): Promise<unknown> {
    const source = sender as { url: string; documentId?: string; tab?: { id?: number } };
    const owner = JSON.stringify([source.url, source.documentId, source.tab?.id]);
    const clear = () => { const upload = uploads.get(manager); if (upload) clearTimeout(upload.timer); uploads.delete(manager); };
    if (message.type === 'SKK_SYSTEM_IMPORT_BEGIN') {
        if (uploads.has(manager)) throw new Error('別のファイルを転送中です。');
        const [definition] = validateSystemDictionaries([message.dictionary]);
        if (definition!.kind !== 'local' || !Number.isInteger(message.size) || (message.size as number) <= 0 || (message.size as number) > MAX_DICTIONARY_BYTES) throw new Error('辞書ファイルのサイズまたは種類が正しくありません。');
        const token = crypto.randomUUID();
        uploads.set(manager, { token, owner, definition: definition!, bytes: new Uint8Array(message.size as number), offset: 0, timer: setTimeout(clear, 60_000) });
        return token;
    }
    const upload = uploads.get(manager);
    if (!upload || upload.token !== message.token || upload.owner !== owner) throw new Error('ファイル転送が見つかりません。');
    if (upload.finishing) throw new Error('辞書をインポート中です。');
    if (message.type === 'SKK_SYSTEM_IMPORT_CANCEL') { clear(); return; }
    try {
        if (message.type === 'SKK_SYSTEM_IMPORT_CHUNK') {
            const bytes = message.bytes;
            if (message.offset !== upload.offset || !Array.isArray(bytes) || !bytes.length || bytes.length > UPLOAD_CHUNK_BYTES || upload.offset + bytes.length > upload.bytes.length) throw new Error('ファイル転送の順序またはサイズが正しくありません。');
            for (let i = 0; i < bytes.length; i++) {
                const byte = bytes[i];
                if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new Error('辞書ファイルのバイト列が正しくありません。');
                upload.bytes[upload.offset + i] = byte;
            }
            upload.offset += bytes.length;
            clearTimeout(upload.timer);
            upload.timer = setTimeout(clear, 60_000);
            return;
        }
        if (message.type !== 'SKK_SYSTEM_IMPORT_FINISH' || upload.offset !== upload.bytes.length) throw new Error('ファイル転送が完了していません。');
        upload.finishing = true;
        clearTimeout(upload.timer);
        try { return await manager.importDictionaryBytes(upload.definition, upload.bytes); }
        finally { clear(); }
    } catch (error) { clear(); throw error; }
}
