import { validateCustomDictionaryUrl, type SystemDictionaryDefinition, type SystemDictionaryStatus } from '../storage/jisyo/SystemDictionaryConfiguration';

export interface OptionalHostPermissions {
    request(permissions: { origins: string[] }): Promise<boolean>;
}

export interface CustomDictionaryEditToken {
    savedRevision: number;
    baseRevision: number;
    dictId: string;
    source: string;
}

export function customDictionaryPermissionOrigins(sources: readonly string[]): string[] {
    return [...new Set(sources.map((source) => {
        const url = new URL(validateCustomDictionaryUrl(source));
        // WebExtension の match pattern はポート番号を表現できないため、同じスキームとホストに限定します。
        return `${url.protocol}//${url.hostname}/*`;
    }))];
}

/** ユーザー操作中に、指定された取得先だけの任意権限を要求します。 */
export async function requestCustomDictionaryPermission(sources: readonly string[], permissions: OptionalHostPermissions): Promise<void> {
    const origins = customDictionaryPermissionOrigins(sources);
    if (!origins.length) return;
    let granted = false;
    try { granted = await permissions.request({ origins }); } catch {
        throw new Error(`カスタム辞書の取得先（${origins.join('、')}）へのアクセス許可を確認できませんでした。もう一度試してください。`);
    }
    if (!granted) throw new Error(`カスタム辞書の取得先（${origins.join('、')}）へのアクセスが許可されませんでした。許可してからもう一度試してください。`);
}

export function definitions(status: SystemDictionaryStatus): SystemDictionaryDefinition[] {
    return status.dictionaries.map(({ dictId, name, kind, format, source, enabled }) => ({ dictId, name, kind, format, source, enabled }));
}
export class SettingsDraft {
    saved?: SystemDictionaryStatus;
    dictionaries: SystemDictionaryDefinition[] = [];
    baseRevision = 0;
    dirty = false;
    get published(): boolean { return (this.saved?.revision ?? 0) > 0; }
    get canEdit(): boolean { return this.published && this.saved?.operation.state !== 'updating'; }
    get conflict(): boolean { return !!this.saved && this.dirty && this.baseRevision !== this.saved.revision; }
    receive(status: SystemDictionaryStatus): boolean {
        if (this.saved && status.revision < this.saved.revision) return false;
        const changed = !this.saved || this.saved.revision !== status.revision;
        this.saved = status;
        if (!this.dirty && changed) this.reset();
        return true;
    }
    reset(): void {
        if (!this.saved) return;
        this.dictionaries = this.published ? definitions(this.saved) : [];
        this.baseRevision = this.saved.revision;
        this.dirty = false;
    }
    move(index: number, delta: number): void {
        if (!this.canEdit) return;
        const destination = index + delta;
        if (index < 0 || index >= this.dictionaries.length || destination < 0 || destination >= this.dictionaries.length) return;
        const [item] = this.dictionaries.splice(index, 1);
        this.dictionaries.splice(destination, 0, item!);
        this.dirty = true;
    }
    remove(index: number): void {
        if (!this.canEdit || index < 0 || index >= this.dictionaries.length) return;
        this.dictionaries.splice(index, 1);
        this.dirty = true;
    }
    captureCustomDictionaryEdit(definition: SystemDictionaryDefinition): CustomDictionaryEditToken {
        if (definition.kind !== 'custom' || !this.dictionaries.some((current) => current.dictId === definition.dictId && current.source === definition.source)) {
            throw new Error('編集するカスタム辞書が見つかりません。最新の構成からやり直してください。');
        }
        return { savedRevision: this.saved?.revision ?? 0, baseRevision: this.baseRevision,
            dictId: definition.dictId, source: definition.source };
    }
    assertCustomDictionaryEdit(token: CustomDictionaryEditToken): SystemDictionaryDefinition {
        if ((this.saved?.revision ?? 0) !== token.savedRevision || this.baseRevision !== token.baseRevision || this.conflict) {
            throw new Error('アクセス許可の確認中に構成が変更されました。最新の構成を確認してもう一度試してください。');
        }
        const index = this.dictionaries.findIndex((current) => current.kind === 'custom'
            && current.dictId === token.dictId && current.source === token.source);
        if (index < 0) throw new Error('編集対象が変更されました。最新の構成を確認してもう一度試してください。');
        return this.dictionaries[index]!;
    }
    applyCustomDictionaryEdit(token: CustomDictionaryEditToken, changes: Pick<SystemDictionaryDefinition, 'name' | 'format' | 'source'>): void {
        const current = this.assertCustomDictionaryEdit(token);
        const index = this.dictionaries.indexOf(current);
        this.dictionaries[index] = { ...current, ...changes };
        this.dirty = true;
    }
}
export function variants(catalog: SystemDictionaryDefinition[], kind: string, format: string): SystemDictionaryDefinition[] {
    return catalog.filter((d) => d.kind === kind && d.format === format);
}
export function validateLocalFile(size: number): void {
    if (size === 0 || size > 64 * 1024 * 1024) throw new Error('空でない 64 MiB 以下のファイルを選択してください。');
}
export function sizeLabel(size?: number): string {
    return size === undefined ? '不明' : `${size.toLocaleString('ja-JP')} バイト（${(size / 1024 / 1024).toFixed(2)} MiB）`;
}

/** 保存応答を先に反映し、その後の状態取得失敗と保存失敗を区別します。 */
export async function publishSettings(
    model: SettingsDraft,
    publish: () => Promise<SystemDictionaryStatus>,
    renderPublished: () => void,
    refresh: () => Promise<void>,
): Promise<{ refreshError?: unknown }> {
    const published = await publish();
    model.receive(published);
    model.reset();
    renderPublished();
    try {
        await refresh();
        return {};
    } catch (refreshError) {
        return { refreshError };
    }
}

/** リビジョン 0 の既定値は公開済みの構成として表示しません。 */
export function startupMessage(status?: SystemDictionaryStatus): string | undefined {
    if (status && status.revision > 0) return undefined;
    if (status?.operation.state === 'error') {
        return `初期化失敗：${status.operation.error ?? '不明なエラー'}。まだ構成は保存されていません。設定画面で初期化を再試行してください。`;
    }
    return '初期化中です。構成はまだ保存されていません。完了まで辞書の編集はできません。';
}
