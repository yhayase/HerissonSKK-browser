import { parseDictionaryCooperatively, yieldImport } from './CooperativeDictionaryParser';
import { DictionaryLoader } from './DictionaryLoader';
import { IndexedDbJisyoStore, type IndexedDbJisyoStoreOptions } from './IndexedDbJisyoStore';
import {
    DEFAULT_SYSTEM_DICTIONARIES, SYSTEM_CONFIGURATION_ID, SYSTEM_OPERATION_ID, SYSTEM_DICTIONARY_CATALOG,
    sameDictionarySource, validateSystemDictionaries,
    type CachedSystemDictionary, type SystemDictionaryConfiguration, type SystemDictionaryDefinition, type SystemDictionaryStatus,
} from './SystemDictionaryConfiguration';

export const MAX_DICTIONARY_BYTES = 64 * 1024 * 1024;
const configurationLock = '__system_configuration__';
export interface DictionaryDownload { bytes: Uint8Array; sourceDate?: string }
export interface SystemDictionaryManagerOptions extends IndexedDbJisyoStoreOptions {
    download?: (definition: SystemDictionaryDefinition) => Promise<DictionaryDownload>;
}

async function downloadDictionary(definition: SystemDictionaryDefinition): Promise<DictionaryDownload> {
    if (definition.source.startsWith('local:')) throw new Error('ローカル辞書ファイルを選択してください。');
    if (!/^https?:/.test(definition.source)) {
        return { bytes: await DictionaryLoader.fetchDictionaryBuffer(DictionaryLoader.getDictionaryUrl(definition.source), definition.source) };
    }
    const response = await fetch(definition.source, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`辞書の取得に失敗しました（HTTP ${response.status}）。`);
    if (Number(response.headers.get('content-length')) > MAX_DICTIONARY_BYTES) throw new Error('辞書ファイルが大きすぎます。');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('辞書データを読み取れません。');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_DICTIONARY_BYTES) throw new Error('辞書ファイルが大きすぎます。');
            chunks.push(value);
        }
    } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { bytes, sourceDate: response.headers.get('last-modified') ?? undefined };
}

export class SystemDictionaryManager {
    public readonly store: IndexedDbJisyoStore;
    private readonly download: (definition: SystemDictionaryDefinition) => Promise<DictionaryDownload>;
    private initialization?: Promise<void>;
    private recoveryScheduled = false;

    constructor(options: SystemDictionaryManagerOptions = {}) {
        this.store = new IndexedDbJisyoStore({ ...options, useSystemConfiguration: true });
        this.download = options.download ?? downloadDictionary;
    }

    /** キャッシュがある起動ではネットワークを待ちません。 */
    public async initialize(): Promise<void> {
        if (await this.store.getSystemConfiguration()) {
            if (!this.recoveryScheduled) {
                this.recoveryScheduled = true;
                void this.recover().catch(() => undefined);
            }
            return;
        }
        if (!this.initialization) {
            this.initialization = this.store.runImportExclusive(configurationLock, async () => {
                if (await this.store.getSystemConfiguration()) return;
                const active = await this.store.getActiveDictionary(DEFAULT_SYSTEM_DICTIONARIES[0]!.dictId);
                if (active) {
                    const bundled = SYSTEM_DICTIONARY_CATALOG.find((d) => d.source === (active.version.startsWith('official-s-') ? 'dict/SKK-JISYO.S.json' : 'dict/SKK-JISYO.S'))!;
                    const config: SystemDictionaryConfiguration = {
                        dictId: SYSTEM_CONFIGURATION_ID, revision: 1,
                        dictionaries: [{ ...bundled }],
                        cache: [{ definition: { ...bundled }, active }],
                    };
                    if (!await this.store.publishSystemConfiguration(config, 0)) throw new Error('辞書設定が変更されました。再試行してください。');
                } else {
                    await this.apply(DEFAULT_SYSTEM_DICTIONARIES);
                }
            }).catch((error) => { this.initialization = undefined; throw error; });
        }
        return this.initialization;
    }

    public async recover(): Promise<void> {
        await this.store.runImportExclusive(configurationLock, () => this.recoverOperation());
    }

    private async recoverOperation(): Promise<void> {
        const config = await this.store.getSystemConfiguration();
        const operation = await this.store.getSystemOperation();
        for (const item of operation?.generations ?? []) {
            if (!config?.cache.some((c) => c.active.dictId === item.dictId && c.active.activeGeneration === item.generation)) {
                await this.store.deleteGeneration(item.dictId, item.generation);
            }
        }
        if (operation?.state === 'updating') {
            await this.store.setSystemOperation({ dictId: SYSTEM_OPERATION_ID, state: 'error', error: '辞書更新が中断されました。前の構成を使用しています。' });
        } else if (operation?.generations?.length) {
            await this.store.setSystemOperation({ ...operation, generations: [] });
        }
    }

    public async status(): Promise<SystemDictionaryStatus> {
        const [config, operation] = await Promise.all([this.store.getSystemConfiguration(), this.store.getSystemOperation()]);
        return {
            revision: config?.revision ?? 0,
            dictionaries: (config?.dictionaries ?? DEFAULT_SYSTEM_DICTIONARIES).map((definition) => {
                const cached = config?.cache.find((c) => sameDictionarySource(c.definition, definition));
                return { ...definition, state: cached ? 'ready' : 'not-loaded',
                    version: cached?.active.version, importedAt: cached?.active.timestamp,
                    sourceDate: cached?.sourceDate, byteSize: cached?.byteSize, entryCount: cached?.active.entryCount };
            }),
            operation: operation ?? { dictId: SYSTEM_OPERATION_ID, state: 'idle' },
            catalog: structuredClone([...SYSTEM_DICTIONARY_CATALOG]),
        };
    }

    public async configure(value: unknown): Promise<SystemDictionaryStatus> {
        const definitions = validateSystemDictionaries(value);
        await this.initialize();
        return this.store.runImportExclusive(configurationLock, () => this.apply(definitions));
    }

    public async importDictionary(value: unknown, input: unknown): Promise<SystemDictionaryStatus> {
        const [definition] = validateSystemDictionaries([value]);
        if (definition!.kind !== 'local') throw new Error('ローカル辞書を指定してください。');
        if (!Array.isArray(input) || input.length === 0 || input.length > MAX_DICTIONARY_BYTES) throw new Error('辞書ファイルのバイト列が正しくありません。');
        const bytes = new Uint8Array(input.length);
        for (let offset = 0; offset < input.length; offset += 65536) {
            const end = Math.min(offset + 65536, input.length);
            for (let i = offset; i < end; i++) {
                const byte = input[i];
                if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new Error('辞書ファイルのバイト列が正しくありません。');
                bytes[i] = byte;
            }
            await yieldImport();
        }
        return this.importDictionaryBytes(definition!, bytes);
    }

    public async importDictionaryBytes(value: unknown, bytes: Uint8Array): Promise<SystemDictionaryStatus> {
        const [definition] = validateSystemDictionaries([value]);
        if (definition!.kind !== 'local' || !bytes.length || bytes.length > MAX_DICTIONARY_BYTES) throw new Error('ローカル辞書のサイズまたは種類が正しくありません。');
        await this.initialize();
        return this.store.runImportExclusive(configurationLock, async () => {
            const config = (await this.store.getSystemConfiguration())!;
            const definitions = config.dictionaries.filter((d) => d.dictId !== definition!.dictId);
            const oldIndex = config.dictionaries.findIndex((d) => d.dictId === definition!.dictId);
            definitions.splice(oldIndex < 0 ? definitions.length : oldIndex, 0, definition!);
            return this.apply(validateSystemDictionaries(definitions), definition!.dictId, bytes);
        });
    }

    public async update(dictId: unknown): Promise<SystemDictionaryStatus> {
        if (typeof dictId !== 'string') throw new Error('辞書 ID が正しくありません。');
        await this.initialize();
        return this.store.runImportExclusive(configurationLock, async () => {
            const config = (await this.store.getSystemConfiguration())!;
            const definition = config.dictionaries.find((d) => d.dictId === dictId);
            if (!definition) throw new Error('辞書が見つかりません。');
            if (definition.kind === 'local') throw new Error('ローカル辞書はファイルを再インポートしてください。');
            return this.apply(config.dictionaries, dictId);
        });
    }

    private async apply(definitions: readonly SystemDictionaryDefinition[], forceId?: string, localBytes?: Uint8Array): Promise<SystemDictionaryStatus> {
        await this.recoverOperation();
        const previous = await this.store.getSystemConfiguration();
        const cache = structuredClone(previous?.cache ?? []);
        const staged: Array<{ dictId: string; generation: string }> = [];
        let dictionaryId: string | undefined;
        try {
            await this.store.setSystemOperation({ dictId: SYSTEM_OPERATION_ID, state: 'updating' });
            for (const definition of definitions) {
                const existing = cache.find((c) => sameDictionarySource(c.definition, definition));
                if (definition.dictId !== forceId && (!definition.enabled || existing)) continue;
                dictionaryId = definition.dictId;
                await this.store.setSystemOperation({ dictId: SYSTEM_OPERATION_ID, state: 'updating', dictionaryId, generations: staged });
                const downloaded = localBytes && definition.dictId === forceId ? { bytes: localBytes } : await this.download(definition);
                if (downloaded.bytes.byteLength === 0 || downloaded.bytes.byteLength > MAX_DICTIONARY_BYTES) throw new Error('辞書ファイルのサイズが正しくありません。');
                const parsed = await parseDictionaryCooperatively(downloaded.bytes, { dictId: definition.dictId, dictPath: definition.source, version: 'pending', format: definition.format });
                if (parsed.size === 0) throw new Error('辞書に候補がありません。');
                const generation = `config-${crypto.randomUUID()}`;
                staged.push({ dictId: definition.dictId, generation });
                await this.store.setSystemOperation({ dictId: SYSTEM_OPERATION_ID, state: 'updating', dictionaryId: definition.dictId, generations: staged });
                const entryCount = await this.store.stageGeneration(definition.dictId, generation,
                    (function* () { for (const [key, candidates] of parsed) yield { key, candidates }; })(), 250);
                const hash = await crypto.subtle.digest('SHA-256', downloaded.bytes as Uint8Array<ArrayBuffer>);
                const version = 'sha256:' + Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
                const cached: CachedSystemDictionary = {
                    definition: { ...definition }, byteSize: downloaded.bytes.byteLength, sourceDate: downloaded.sourceDate,
                    active: { dictId: definition.dictId, version, activeGeneration: generation, entryCount,
                        revision: 0, storage: 'generation', timestamp: Date.now() },
                };
                const index = cache.findIndex((c) => sameDictionarySource(c.definition, definition));
                if (index < 0) cache.push(cached); else cache[index] = cached;
            }
            const config: SystemDictionaryConfiguration = { dictId: SYSTEM_CONFIGURATION_ID,
                revision: (previous?.revision ?? 0) + 1, dictionaries: structuredClone([...definitions]), cache };
            const garbage = (previous?.cache ?? []).filter((old) => old.active.activeGeneration
                && !cache.some((c) => c.active.dictId === old.active.dictId && c.active.activeGeneration === old.active.activeGeneration))
                .map((old) => ({ dictId: old.active.dictId, generation: old.active.activeGeneration! }));
            if (!await this.store.publishSystemConfiguration(config, previous?.revision ?? 0, garbage)) throw new Error('辞書設定が変更されました。再試行してください。');
        } catch (error) {
            for (const item of staged) await this.store.deleteGeneration(item.dictId, item.generation).catch(() => undefined);
            await this.store.setSystemOperation({ dictId: SYSTEM_OPERATION_ID, state: 'error', dictionaryId, error: error instanceof Error ? error.message : String(error), generations: staged });
            throw error;
        }
        return this.status();
    }
}
