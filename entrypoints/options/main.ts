import './style.css';
import { sendRuntimeMessage as rpc } from '@/src/storage/rpc/runtimeClient';
import type { SkkRpcRequest, SystemDictionaryPreview, CandidateData } from '@/src/storage/rpc/messages';
import type { SystemDictionaryDefinition, SystemDictionaryStatus } from '@/src/storage/jisyo/SystemDictionaryConfiguration';
import { SettingsDraft, variants, sizeLabel, validateLocalFile, publishSettings, startupMessage } from '@/src/settings/model';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
const select = (id: string) => element<HTMLSelectElement>(id);
const model = new SettingsDraft();
let busy = false;
let polling = false;
let previewBusy = false;
let requestSequence = 0;
let receivedSequence = 0;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text: string): HTMLElementTagNameMap[K] {
    const result = document.createElement(tag); result.textContent = text; return result;
}
function button(text: string, action: () => void, disabled = false): HTMLButtonElement {
    const result = node('button', text); result.type = 'button'; result.disabled = disabled; result.onclick = action; return result;
}
function controls(): void {
    const unavailable = busy || !model.canEdit;
    element<HTMLButtonElement>('refresh').disabled = busy;
    element('refresh').textContent = model.published ? '状態を再取得' : '初期化を再試行・状態を再取得';
    element<HTMLButtonElement>('preview').disabled = previewBusy || !model.published;
    element<HTMLFieldSetElement>('draft-controls').disabled = unavailable;
    element<HTMLFieldSetElement>('import-controls').disabled = unavailable || model.dirty;
    element<HTMLButtonElement>('save').disabled = unavailable || !model.dirty || model.conflict;
    element<HTMLButtonElement>('reset').disabled = unavailable || !model.dirty;
    element('draft-state').textContent = !model.published ? startupMessage(model.saved)! : model.conflict
        ? '別の画面で構成が変更されました。編集内容は保持しています。保存するには編集を破棄して最新の構成からやり直してください。'
        : model.dirty ? '未保存の編集です。現在の変換にはまだ反映されていません。' : '現在使用中の構成と同じです。';
    for (const control of document.querySelectorAll<HTMLButtonElement>('[data-update]')) control.disabled = unavailable || model.dirty;
}
function sourceChoices(): void {
    const source = select('source'); source.replaceChildren();
    for (const d of variants(model.saved?.catalog ?? [], select('kind').value, select('format').value)) {
        const option = node('option', d.source); option.value = d.source; source.append(option);
    }
    element<HTMLButtonElement>('add').disabled = !source.options.length;
}
function drawDraft(): void {
    const list = element('draft-list'); list.replaceChildren();
    model.dictionaries.forEach((d, index) => {
        const item = node('li', ''); item.dataset.dictId = d.dictId;
        const row = node('div', ''); row.className = 'row';
        const label = node('label', ''); const check = document.createElement('input'); check.type = 'checkbox'; check.checked = d.enabled;
        check.setAttribute('aria-label', `${d.name}を有効にする`); check.onchange = () => { d.enabled = check.checked; model.dirty = true; controls(); };
        label.append(check, document.createTextNode(d.name)); row.append(label);
        if (d.kind !== 'local') {
            const formatLabel = node('label', '形式・取得元'); const choices = document.createElement('select');
            for (const variant of model.saved!.catalog.filter((v) => v.dictId === d.dictId)) {
                const option = node('option', `${variant.format === 'json' ? 'JSON' : 'テキスト'} — ${variant.source}`);
                option.value = variant.source; option.selected = variant.source === d.source && variant.format === d.format; choices.append(option);
            }
            choices.onchange = () => {
                const variant = model.saved!.catalog.find((v) => v.dictId === d.dictId && v.source === choices.value)!;
                model.dictionaries[index] = { ...variant, enabled: d.enabled }; model.dirty = true; drawDraft();
            };
            formatLabel.append(choices); row.append(formatLabel);
        } else row.append(node('span', `形式：${d.format}（変更は再インポート）`));
        const up = button('上へ', () => { model.move(index, -1); drawDraft(); }, index === 0); up.setAttribute('aria-label', `${d.name}を上へ`);
        const down = button('下へ', () => { model.move(index, 1); drawDraft(); }, index === model.dictionaries.length - 1); down.setAttribute('aria-label', `${d.name}を下へ`);
        row.append(up, down); item.append(row); list.append(item);
    }); controls();
}
function drawSaved(): void {
    const status = model.saved!;
    element('notice').textContent = startupMessage(status) ?? `保存済み構成：リビジョン ${status.revision}`;
    element('operation').textContent = startupMessage(status) ?? (status.operation.state === 'updating'
        ? `取得・検証・保存中… ${status.operation.dictionaryId ?? ''}（完了までは現在の構成を使用します）`
        : status.operation.state === 'error' ? `更新失敗：${status.operation.error ?? '不明なエラー'}。前の構成を使用しています。` : '更新待機中');
    const list = element('saved-list'); list.replaceChildren();
    for (const d of model.published ? status.dictionaries : []) {
        const item = node('li', `${d.name} — ${d.enabled ? '有効' : '無効'} / ${d.format === 'json' ? 'JSON' : 'テキスト'}`); item.dataset.dictId = d.dictId;
        const metadata = node('p', `取得元：${d.source}\n状態：${d.state === 'ready' ? '取得済み・オフライン利用可能' : '未取得'}\nサイズ：${sizeLabel(d.byteSize)}\nバージョン／ハッシュ：${d.version ?? '未取得'}\nインポート日時：${d.importedAt === undefined ? '不明' : new Date(d.importedAt).toLocaleString('ja-JP')}\n取得元の更新日時：${d.sourceDate ?? '不明'}\n見出し数：${d.entryCount?.toLocaleString('ja-JP') ?? '不明'}`);
        metadata.className = 'metadata'; item.append(metadata);
        if (d.kind !== 'local') {
            const update = button('この辞書を更新', () => void mutate({ type: 'SKK_SYSTEM_UPDATE', dictId: d.dictId })); update.dataset.update = d.dictId; item.append(update);
        }
        list.append(item);
    }
    const target = select('import-target'); const previous = target.value; target.replaceChildren(node('option', '新しい辞書')); target.options[0]!.value = '';
    for (const d of status.dictionaries.filter((d) => d.kind === 'local')) { const option = node('option', `${d.name}を再インポート`); option.value = d.dictId; target.append(option); }
    target.value = previous; if (target.selectedIndex < 0) target.value = '';
    controls();
}
async function refresh(): Promise<void> {
    const sequence = ++requestSequence;
    const status = await rpc<SystemDictionaryStatus>({ type: 'SKK_SYSTEM_STATUS' });
    if (sequence < receivedSequence) return;
    receivedSequence = sequence;
    const previous = model.saved;
    if (!model.receive(status)) return;
    if (!previous || JSON.stringify(previous) !== JSON.stringify(status)) drawSaved();
    if (!previous || (!model.dirty && previous.revision !== status.revision)) drawDraft();
    if (!previous || JSON.stringify(previous.catalog) !== JSON.stringify(status.catalog)) sourceChoices();
}
async function mutate(request: SkkRpcRequest, file?: File): Promise<void> {
    if (busy || !model.saved || !model.canEdit) return;
    if (request.type !== 'SKK_SYSTEM_CONFIGURE' && model.dirty) return;
    busy = true; controls(); element('error').textContent = ''; element('notice').textContent = '操作中…';
    try {
        await refresh();
        if ((model.saved as SystemDictionaryStatus).operation.state === 'updating') throw new Error('別の操作が進行中です。完了後に再試行してください。');
        if (model.conflict) throw new Error('構成が変更されています。編集内容を確認してください。');
        if (file && request.type === 'SKK_SYSTEM_IMPORT') { validateLocalFile(file.size); request.bytes = Array.from(new Uint8Array(await file.arrayBuffer())); }
        const result = await publishSettings(model, () => rpc<SystemDictionaryStatus>(request), () => {
            drawSaved(); drawDraft(); sourceChoices();
            element('notice').textContent = `保存完了（リビジョン ${model.saved!.revision}）`;
        }, refresh);
        element('notice').textContent = `保存完了（リビジョン ${model.saved.revision}）`;
        if ('refreshError' in result) {
            element('error').textContent = `保存は完了しました。最新状態の再取得に失敗したため、確認済みの構成を表示しています：${errorText(result.refreshError)}`;
        }
    } catch (error) { element('error').textContent = errorText(error); await refresh().catch(() => undefined); }
    finally { busy = false; controls(); }
}
element('refresh').onclick = () => {
    if (busy) return;
    busy = true; controls();
    void (async () => {
        try {
            if (!model.published) await rpc({ type: 'SKK_WAIT_READY' });
            await refresh();
            element('error').textContent = '';
        } catch (error) {
            element('error').textContent = errorText(error);
            await refresh().catch(() => undefined);
        } finally { busy = false; controls(); }
    })();
};
element('reset').onclick = () => { model.reset(); drawDraft(); };
select('kind').onchange = sourceChoices; select('format').onchange = sourceChoices;
element('add').onclick = () => {
    const d = variants(model.saved?.catalog ?? [], select('kind').value, select('format').value).find((v) => v.source === select('source').value);
    if (!d) return;
    if (model.dictionaries.some((v) => v.dictId === d.dictId)) { element('error').textContent = 'この辞書は構成にあります。一覧で形式・取得元を変更してください。'; return; }
    model.dictionaries.push({ ...d, enabled: true }); model.dirty = true; drawDraft();
};
element('save').onclick = () => void mutate({ type: 'SKK_SYSTEM_CONFIGURE', dictionaries: structuredClone(model.dictionaries) });
select('import-target').onchange = () => {
    const d = model.saved?.dictionaries.find((d) => d.dictId === select('import-target').value);
    input('import-name').value = d?.name ?? ''; select('import-format').value = d?.format ?? 'text';
};
input('import-file').onchange = () => { const file = input('import-file').files?.[0]; element('file-size').textContent = file ? `${file.name}：${sizeLabel(file.size)}` : 'ファイル未選択'; };
element('import').onclick = () => {
    const file = input('import-file').files?.[0]; const name = input('import-name').value.trim();
    if (!file || !name) { element('error').textContent = '辞書名とファイルを指定してください。'; return; }
    const old = model.saved?.dictionaries.find((d) => d.dictId === select('import-target').value);
    const dictionary: SystemDictionaryDefinition = { dictId: old?.dictId ?? `local-${crypto.randomUUID()}`, name, kind: 'local', format: select('import-format').value as 'text' | 'json', source: `local:${file.name}`, enabled: old?.enabled ?? true };
    void mutate({ type: 'SKK_SYSTEM_IMPORT', dictionary, bytes: [] }, file);
};
function candidates(id: string, values: CandidateData[]): void {
    const list = element(id); list.replaceChildren();
    if (!values.length) { list.append(node('li', '候補なし')); return; }
    for (const candidate of values) {
        const item = node('li', candidate.word);
        item.append(node('p', `表示注釈：${candidate.annotation ?? 'なし'} / 送り条件：${candidate.okuri === undefined ? '指定なし' : candidate.okuri || '空文字'}`));
        const sources = node('ul', '');
        for (const source of candidate.sources ?? []) sources.append(node('li', `${source.kind === 'learned' ? '学習' : 'システム'}：${source.name ?? source.dictId ?? '名称なし'} / 注釈：${source.annotation ?? 'なし'}`));
        item.append(sources); list.append(item);
    }
}
input('preview-all').onchange = () => { input('preview-okuri').disabled = input('preview-all').checked; };
element<HTMLFormElement>('preview-form').onsubmit = (event) => {
    event.preventDefault(); if (previewBusy || !model.published) return;
    previewBusy = true; element<HTMLButtonElement>('preview').disabled = true;
    const key = input('preview-key').value; const okuri = input('preview-all').checked ? undefined : input('preview-okuri').value;
    element('preview-status').textContent = '候補を取得中…';
    void rpc<SystemDictionaryPreview>({ type: 'SKK_SYSTEM_PREVIEW', key, okuri }).then((result) => {
        candidates('system-candidates', result.systemCandidates); candidates('effective-candidates', result.effectiveCandidates);
        element('preview-status').textContent = `取得時点の候補：${result.key} / ${result.okuri === undefined ? '全条件' : `送り仮名「${result.okuri}」`}`;
    }).catch((error) => { element('preview-status').textContent = `取得失敗：${errorText(error)}（前の結果を保持しています）`; })
        .finally(() => { previewBusy = false; controls(); });
};
controls();
void refresh().catch((error) => { element('notice').textContent = '構成を読み込めませんでした。状態を再取得してください。'; element('error').textContent = errorText(error); });
const timer = window.setInterval(() => {
    if (polling || document.hidden) return; polling = true;
    void refresh().catch((error) => { element('error').textContent = `状態の取得失敗：${errorText(error)}`; }).finally(() => { polling = false; });
}, 2000);
window.addEventListener('pagehide', () => clearInterval(timer));
window.addEventListener('beforeunload', (event) => { if (model.dirty) { event.preventDefault(); event.returnValue = ''; } });
