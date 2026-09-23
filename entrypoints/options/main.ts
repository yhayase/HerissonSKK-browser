import './style.css';
import { sendRuntimeMessage as rpc } from '@/src/storage/rpc/runtimeClient';
import type { SkkRpcRequest } from '@/src/storage/rpc/messages';
import { validateSystemDictionaries, validateCustomDictionaryUrl, type SystemDictionaryDefinition, type SystemDictionaryStatus } from '@/src/storage/jisyo/SystemDictionaryConfiguration';
import { SettingsDraft, variants, sizeLabel, validateLocalFile, publishSettings, startupMessage, requestCustomDictionaryPermission } from '@/src/settings/model';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
const select = (id: string) => element<HTMLSelectElement>(id);
const model = new SettingsDraft();
let busy = false;
let polling = false;
let requestSequence = 0;
let receivedSequence = 0;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text: string): HTMLElementTagNameMap[K] {
    const result = document.createElement(tag); result.textContent = text; return result;
}
function button(text: string, action: () => void, disabled = false): HTMLButtonElement {
    const result = node('button', text); result.type = 'button'; result.disabled = disabled; result.onclick = action; return result;
}
function authorizeCustomSources(sources: readonly string[], action: () => void): void {
    if (busy) return;
    busy = true; controls(); element('error').textContent = ''; element('notice').textContent = '取得先へのアクセス許可を確認中…';
    const permission = requestCustomDictionaryPermission(sources, browser.permissions);
    void permission.then(() => {
        busy = false; controls(); action();
    }).catch((error) => {
        busy = false; controls(); element('error').textContent = errorText(error); element('notice').textContent = '操作を完了できませんでした。内容を確認してもう一度試してください。';
    });
}
function controls(): void {
    const unavailable = busy || !model.canEdit;
    element<HTMLButtonElement>('refresh').disabled = busy;
    element('refresh').textContent = model.published ? '再取得' : '初期化を再試行';
    element<HTMLFieldSetElement>('draft-controls').disabled = unavailable;
    element<HTMLFieldSetElement>('import-controls').disabled = unavailable || model.dirty;
    element<HTMLButtonElement>('save').disabled = unavailable || !model.dirty || model.conflict;
    element<HTMLButtonElement>('reset').disabled = unavailable || !model.dirty;
    element('draft-state').textContent = !model.published ? startupMessage(model.saved)! : model.conflict
        ? '別の画面で構成が変更されました。編集内容は保持しています。保存するには編集を破棄して最新の構成からやり直してください。'
        : model.dirty ? '未保存' : '';
    element('import-state').textContent = model.dirty ? '未保存の変更があります。保存または破棄してください。' : '';
    for (const control of document.querySelectorAll<HTMLButtonElement>('[data-update]')) control.disabled = unavailable || model.dirty;
}
function sourceChoices(): void {
    const source = select('source'); source.replaceChildren();
    for (const d of variants(model.saved?.catalog ?? [], select('kind').value, select('format').value)) {
        const option = node('option', sourceLabel(d.source)); option.title = d.source; option.value = d.source; source.append(option);
    }
    element<HTMLButtonElement>('add').disabled = !source.options.length;
}
function sourceLabel(source: string): string {
    if (source.startsWith('dict/')) return '旧同梱辞書（移行待ち）';
    try { const url = new URL(source); return `${url.hostname}/${url.pathname.split('/').pop()}`; }
    catch { return source; }
}
function drawDraft(): void {
    const list = element('draft-list');
    const active = document.activeElement as HTMLInputElement | null;
    const activeRow = active?.closest<HTMLElement>('[data-dict-id]');
    const focus = activeRow ? { id: activeRow.dataset.dictId, control: active?.dataset.control,
        index: [...list.children].indexOf(activeRow), start: active?.selectionStart, end: active?.selectionEnd } : undefined;
    const expanded = new Set([...list.querySelectorAll<HTMLDetailsElement>('details[open]')].map((details) => details.closest<HTMLElement>('[data-dict-id]')!.dataset.dictId));
    list.replaceChildren();
    element('configuration-empty').hidden = model.dictionaries.length > 0;
    model.dictionaries.forEach((d, index) => {
        const item = node('li', ''); item.dataset.dictId = d.dictId;
        const row = node('div', ''); row.className = 'row';
        const label = node('label', ''); label.className = 'dictionary-name';
        const check = document.createElement('input'); check.type = 'checkbox'; check.checked = d.enabled; check.dataset.control = 'enabled';
        check.setAttribute('aria-label', `${d.name}を有効にする`);
        check.onchange = () => { d.enabled = check.checked; model.dirty = true; controls(); };
        label.append(check);
        if (d.kind !== 'custom') label.append(document.createTextNode(d.name));
        row.append(label);
        if (d.kind === 'custom') {
            const nameLabel = node('label', '辞書名'); nameLabel.className = 'custom-name';
            const nameInput = document.createElement('input'); nameInput.value = d.name; nameInput.maxLength = 200; nameInput.dataset.control = 'name'; nameLabel.append(nameInput);
            nameInput.oninput = () => { d.name = nameInput.value; model.dirty = true; controls(); };
            const formatLabel = node('label', '形式'); const formatSelect = document.createElement('select'); formatSelect.dataset.control = 'format';
            for (const [value, text] of [['text', 'テキスト'], ['json', 'JSON']] as const) {
                const option = node('option', text); option.value = value; option.selected = d.format === value; formatSelect.append(option);
            }
            formatSelect.onchange = () => { d.format = formatSelect.value as 'text' | 'json'; model.dirty = true; controls(); };
            formatLabel.append(formatSelect);
            const urlLabel = node('label', 'URL'); urlLabel.className = 'custom-source';
            const sourceInput = document.createElement('input'); sourceInput.type = 'url'; sourceInput.maxLength = 1000; sourceInput.value = d.source; sourceInput.dataset.control = 'source'; urlLabel.append(sourceInput);
            sourceInput.oninput = () => { d.source = sourceInput.value; model.dirty = true; controls(); };
            row.append(nameLabel, formatLabel, urlLabel);
        } else if (d.kind !== 'local') {
            const formatLabel = node('label', '形式・取得元'); const choices = document.createElement('select'); choices.dataset.control = 'format';
            for (const variant of model.saved!.catalog.filter((v) => v.dictId === d.dictId)) {
                const option = node('option', `${variant.format === 'json' ? 'JSON' : 'テキスト'} — ${sourceLabel(variant.source)}`);
                option.value = variant.source; option.title = variant.source; option.selected = variant.source === d.source && variant.format === d.format; choices.append(option);
            }
            choices.onchange = () => {
                const variant = model.saved!.catalog.find((v) => v.dictId === d.dictId && v.source === choices.value)!;
                model.dictionaries[index] = { ...variant, enabled: d.enabled }; model.dirty = true; drawDraft();
            };
            formatLabel.append(choices); row.append(formatLabel);
        } else row.append(node('span', d.format === 'json' ? 'JSON' : 'テキスト'));
        const actions = node('div', ''); actions.className = 'row-actions';
        const up = button('↑', () => { model.move(index, -1); drawDraft(); }); up.dataset.control = 'up'; up.setAttribute('aria-label', `${d.name}を上へ`); up.setAttribute('aria-disabled', String(index === 0));
        const down = button('↓', () => { model.move(index, 1); drawDraft(); }); down.dataset.control = 'down'; down.setAttribute('aria-label', `${d.name}を下へ`); down.setAttribute('aria-disabled', String(index === model.dictionaries.length - 1));
        const remove = button('削除', () => { model.remove(index); drawDraft(); }); remove.dataset.control = 'remove'; remove.setAttribute('aria-label', `${d.name}を構成から削除`);
        actions.append(up, down, remove);
        const current = model.saved?.dictionaries.find((saved) => saved.dictId === d.dictId && saved.kind === d.kind && saved.format === d.format && saved.source === d.source);
        if (current && current.kind !== 'local') {
            const update = button('更新（即時）', () => {
                if (current.kind !== 'custom') { void mutate({ type: 'SKK_SYSTEM_UPDATE', dictId: current.dictId }); return; }
                const token = model.captureCustomDictionaryEdit(current);
                authorizeCustomSources([current.source], () => { model.assertCustomDictionaryEdit(token); void mutate({ type: 'SKK_SYSTEM_UPDATE', dictId: current.dictId }); });
            });
            update.dataset.update = current.dictId; update.dataset.control = 'update'; actions.append(update);
        }
        row.append(actions); item.append(row);
        const details = document.createElement('details'); details.open = expanded.has(d.dictId);
        const summary = node('summary', '詳細'); summary.dataset.control = 'details'; details.append(summary);
        const metadata = current
            ? node('p', `取得元：${current.source}\n状態：${current.state === 'ready' ? '取得済み' : '未取得'}\nサイズ：${sizeLabel(current.byteSize)}\nバージョン／ハッシュ：${current.version ?? '未取得'}\nインポート日時：${current.importedAt === undefined ? '不明' : new Date(current.importedAt).toLocaleString('ja-JP')}\n取得元の更新日時：${current.sourceDate ?? '不明'}\n見出し数：${current.entryCount?.toLocaleString('ja-JP') ?? '不明'}`)
            : node('p', `取得元：${d.source}\n状態：未保存`);
        metadata.className = 'metadata'; details.append(metadata); item.append(details); list.append(item);
    });
    controls();
    // 再描画後も同じ辞書・操作に戻します。削除時は隣の辞書を選びます。
    if (focus) {
        const rows = [...list.querySelectorAll<HTMLElement>(':scope > li')];
        const row = rows.find((row) => row.dataset.dictId === focus.id) ?? rows[Math.min(focus.index, rows.length - 1)];
        const target = [...(row?.querySelectorAll<HTMLElement>('[data-control]') ?? [])].find((control) => control.dataset.control === focus.control);
        if (target) {
            target.focus({ preventScroll: true });
            if (target instanceof HTMLInputElement && focus.start != null && focus.end != null) target.setSelectionRange(focus.start, focus.end);
        } else element('save').focus();
    }
}
function drawSaved(): void {
    const status = model.saved!;
    element('notice').dataset.revision = String(status.revision);
    element('notice').textContent = startupMessage(status) ?? '';
    element('operation').textContent = startupMessage(status) ?? (status.operation.state === 'updating'
        ? `取得・検証・保存中… ${status.operation.dictionaryId ?? ''}（完了までは現在の構成を使用します）`
        : status.operation.state === 'error' ? `更新失敗：${status.operation.error ?? '不明なエラー'}。前の構成を使用しています。` : '');
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
    if (!previous || JSON.stringify(previous) !== JSON.stringify(status)) { drawSaved(); drawDraft(); }
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
        if (file) validateLocalFile(file.size);
        const result = await publishSettings(model, async () => {
            if (!file || request.type !== 'SKK_SYSTEM_IMPORT') return rpc<SystemDictionaryStatus>(request);
            const token = await rpc<string>({ type: 'SKK_SYSTEM_IMPORT_BEGIN', dictionary: request.dictionary, size: file.size });
            try {
                for (let offset = 0; offset < file.size; offset += 65536) {
                    const bytes = Array.from(new Uint8Array(await file.slice(offset, offset + 65536).arrayBuffer()));
                    await rpc({ type: 'SKK_SYSTEM_IMPORT_CHUNK', token, offset, bytes });
                }
                return await rpc<SystemDictionaryStatus>({ type: 'SKK_SYSTEM_IMPORT_FINISH', token });
            } catch (error) {
                await rpc({ type: 'SKK_SYSTEM_IMPORT_CANCEL', token }).catch(() => undefined);
                throw error;
            }
        }, () => {
            drawSaved(); drawDraft(); sourceChoices();
            element('notice').textContent = '保存完了';
        }, refresh);
        element('notice').textContent = '保存完了';
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
element('add-custom').onclick = () => {
    try {
        const name = input('custom-name').value.trim();
        if (!name) throw new Error('辞書名を指定してください。');
        const source = validateCustomDictionaryUrl(input('custom-source').value);
        model.dictionaries.push({ dictId: `custom-${crypto.randomUUID()}`, name, kind: 'custom',
            format: select('custom-format').value as 'text' | 'json', source, enabled: true });
        model.dirty = true; element('error').textContent = ''; input('custom-name').value = ''; input('custom-source').value = ''; drawDraft();
    } catch (error) { element('error').textContent = errorText(error); }
};
element('save').onclick = () => {
    if (busy || !model.canEdit || !model.dirty || model.conflict) return;
    try {
        const dictionaries = validateSystemDictionaries(model.dictionaries.map((d) => ({ ...d, name: d.name.trim() })));
        const sources = dictionaries.filter((d) => d.kind === 'custom' && d.enabled
            && !model.saved?.dictionaries.some((saved) => saved.dictId === d.dictId && saved.source === d.source && saved.format === d.format && saved.state === 'ready')).map((d) => d.source);
        const save = () => { void mutate({ type: 'SKK_SYSTEM_CONFIGURE', dictionaries }); };
        // 権限要求はクリックの同期処理内で開始します。待機中も未保存状態を維持し、保存前に競合を確認します。
        if (sources.length) authorizeCustomSources(sources, save); else save();
    } catch (error) { element('error').textContent = errorText(error); }
};
select('import-target').onchange = () => {
    const d = model.saved?.dictionaries.find((d) => d.dictId === select('import-target').value);
    input('import-name').value = d?.name ?? ''; select('import-format').value = d?.format ?? 'text';
};
input('import-file').onchange = () => { const file = input('import-file').files?.[0]; element('file-size').textContent = file ? `${file.name}：${sizeLabel(file.size)}` : ''; };
element('import').onclick = () => {
    const file = input('import-file').files?.[0]; const name = input('import-name').value.trim();
    if (!file || !name) { element('error').textContent = '辞書名とファイルを指定してください。'; return; }
    const old = model.saved?.dictionaries.find((d) => d.dictId === select('import-target').value);
    const dictionary: SystemDictionaryDefinition = { dictId: old?.dictId ?? `local-${crypto.randomUUID()}`, name, kind: 'local', format: select('import-format').value as 'text' | 'json', source: `local:${file.name}`, enabled: old?.enabled ?? true };
    void mutate({ type: 'SKK_SYSTEM_IMPORT', dictionary, bytes: [] }, file);
};
controls();
void refresh().catch((error) => { element('notice').textContent = '構成を読み込めませんでした。状態を再取得してください。'; element('error').textContent = errorText(error); });
const timer = window.setInterval(() => {
    if (polling || document.hidden) return; polling = true;
    void refresh().catch((error) => { element('error').textContent = `状態の取得失敗：${errorText(error)}`; }).finally(() => { polling = false; });
}, 2000);
window.addEventListener('pagehide', () => clearInterval(timer));
window.addEventListener('beforeunload', (event) => { if (model.dirty) { event.preventDefault(); event.returnValue = ''; } });

for (const hint of document.querySelectorAll<HTMLElement>('.hint')) {
    const trigger = hint.querySelector<HTMLButtonElement>('button')!;
    const tooltip = hint.querySelector<HTMLElement>('[role=tooltip]')!;
    const show = () => {
        tooltip.hidden = false;
        const anchor = trigger.getBoundingClientRect();
        const box = tooltip.getBoundingClientRect();
        tooltip.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - box.width - 12))}px`;
        tooltip.style.top = `${anchor.bottom + box.height + 8 <= window.innerHeight ? anchor.bottom : Math.max(8, anchor.top - box.height)}px`;
    };
    hint.onmouseenter = show;
    hint.onmouseleave = () => { if (document.activeElement !== trigger) tooltip.hidden = true; };
    trigger.onfocus = show;
    trigger.onblur = () => { tooltip.hidden = true; };
    trigger.onclick = show;
    trigger.onkeydown = (event) => { if (event.key === 'Escape') { tooltip.hidden = true; event.stopPropagation(); } };
}
