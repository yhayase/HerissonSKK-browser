import type { ActiveDictionaryRecord } from '../indexedDbSchema';

export const SYSTEM_CONFIGURATION_ID = 'system-dictionary-configuration';
export const SYSTEM_OPERATION_ID = 'system-dictionary-operation';
export type SystemDictionaryKind = 's' | 'm' | 'l' | 'postal' | 'person' | 'place' | 'custom' | 'local';
export type SystemDictionaryFormat = 'text' | 'json';
export interface SystemDictionaryDefinition {
    dictId: string;
    name: string;
    kind: SystemDictionaryKind;
    format: SystemDictionaryFormat;
    source: string;
    enabled: boolean;
}
export interface CachedSystemDictionary {
    definition: SystemDictionaryDefinition;
    active: ActiveDictionaryRecord;
    byteSize?: number;
    sourceDate?: string;
}
export interface SystemDictionaryConfiguration {
    dictId: typeof SYSTEM_CONFIGURATION_ID;
    revision: number;
    dictionaries: SystemDictionaryDefinition[];
    cache: CachedSystemDictionary[];
}
export interface SystemDictionaryOperation {
    dictId: typeof SYSTEM_OPERATION_ID;
    state: 'updating' | 'error' | 'idle';
    dictionaryId?: string;
    error?: string;
    generations?: Array<{ dictId: string; generation: string }>;
}
export interface SystemDictionaryStatus {
    revision: number;
    dictionaries: Array<SystemDictionaryDefinition & {
        state: 'ready' | 'not-loaded';
        version?: string;
        importedAt?: number;
        sourceDate?: string;
        byteSize?: number;
        entryCount?: number;
    }>;
    operation: SystemDictionaryOperation;
    catalog: SystemDictionaryDefinition[];
}

const remoteRoot = 'https://raw.githubusercontent.com/skk-dev/dict/master/';
export const SYSTEM_DICTIONARY_CATALOG: readonly SystemDictionaryDefinition[] = [
    { dictId: 'skk-jisyo-s', name: '基本辞書 S（同梱）', kind: 's', format: 'json', source: 'dict/SKK-JISYO.S.json', enabled: true },
    { dictId: 'skk-jisyo-s', name: '基本辞書 S（同梱）', kind: 's', format: 'text', source: 'dict/SKK-JISYO.S', enabled: true },
    ...(['s', 'm', 'l', 'person', 'place', 'postal'] as const).flatMap((kind) => {
        const file = { s: 'SKK-JISYO.S', m: 'SKK-JISYO.M', l: 'SKK-JISYO.L', person: 'SKK-JISYO.jinmei', place: 'SKK-JISYO.geo', postal: 'zipcode/SKK-JISYO.zipcode' }[kind];
        const name = { s: '基本辞書 S', m: '基本辞書 M', l: '基本辞書 L', person: '人名辞書', place: '地名辞書', postal: '郵便番号辞書' }[kind];
        return (kind === 'postal' ? ['text'] as const : ['text', 'json'] as const).map((format) => ({
            dictId: `skk-jisyo-${kind}`, name, kind, format,
            source: remoteRoot + (format === 'json' ? `json/${file}.json` : file), enabled: false,
        }));
    }),
];
export const DEFAULT_SYSTEM_DICTIONARIES = [SYSTEM_DICTIONARY_CATALOG[0]!];

export function sameDictionarySource(a: SystemDictionaryDefinition, b: SystemDictionaryDefinition): boolean {
    return a.dictId === b.dictId && a.source === b.source && a.format === b.format && a.kind === b.kind;
}

/** カスタム辞書の取得元を正規化し、安全にネットワーク取得できる URL だけを返します。 */
export function validateCustomDictionaryUrl(value: string): string {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('カスタム辞書の URL が正しくありません。'); }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.hostname.includes('*')) {
        throw new Error('カスタム辞書にはワイルドカードや認証情報を含まない HTTP または HTTPS の URL を指定してください。');
    }
    return url.href;
}

/** RPC 由来の設定を検証し、永続化するフィールドだけをコピーします。 */
export function validateSystemDictionaries(value: unknown): SystemDictionaryDefinition[] {
    if (!Array.isArray(value) || value.length > 100) throw new Error('辞書設定の形式が正しくありません。');
    const ids = new Set<string>();
    return value.map((item: unknown) => {
        if (!item || typeof item !== 'object') throw new Error('辞書設定の形式が正しくありません。');
        const d = item as Record<string, unknown>;
        if (typeof d.dictId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(d.dictId)
            || ids.has(d.dictId) || typeof d.name !== 'string' || !d.name.trim() || d.name.length > 200
            || typeof d.kind !== 'string' || !['s', 'm', 'l', 'postal', 'person', 'place', 'custom', 'local'].includes(String(d.kind))
            || (d.format !== 'text' && d.format !== 'json') || typeof d.enabled !== 'boolean'
            || typeof d.source !== 'string' || !d.source || d.source.length > 1000) {
            throw new Error('辞書設定の形式が正しくありません。');
        }
        const definition: SystemDictionaryDefinition = { dictId: d.dictId, name: d.name, kind: d.kind as SystemDictionaryKind,
            format: d.format, source: d.source, enabled: d.enabled };
        if (definition.kind === 'local') {
            if (!definition.dictId.startsWith('local-') || !definition.source.startsWith('local:')) throw new Error('ローカル辞書の指定が正しくありません。');
        } else if (definition.kind === 'custom') {
            if (!definition.dictId.startsWith('custom-')) throw new Error('カスタム辞書の指定が正しくありません。');
            definition.source = validateCustomDictionaryUrl(definition.source);
        } else if (!SYSTEM_DICTIONARY_CATALOG.some((known) => sameDictionarySource(known, definition))) {
            throw new Error('対応していない辞書の取得元または形式です。');
        }
        ids.add(definition.dictId);
        return definition;
    });
}
