import type { SystemDictionaryDefinition, SystemDictionaryStatus } from '../storage/jisyo/SystemDictionaryConfiguration';

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
