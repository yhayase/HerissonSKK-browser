import '../options/style.css';
import { sendRuntimeMessage as rpc } from '@/src/storage/rpc/runtimeClient';
import type { CandidateData, SystemDictionaryPreview } from '@/src/storage/rpc/messages';
import type { SystemDictionaryStatus } from '@/src/storage/jisyo/SystemDictionaryConfiguration';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
let ready = false;
let busy = false;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text: string): HTMLElementTagNameMap[K] {
    const result = document.createElement(tag);
    result.textContent = text;
    return result;
}

function controls(): void {
    element<HTMLFieldSetElement>('diagnostic-controls').disabled = !ready || busy;
    element<HTMLButtonElement>('refresh').disabled = busy;
}

function candidates(id: string, values: CandidateData[]): void {
    const list = element(id);
    list.replaceChildren();
    if (!values.length) {
        list.append(node('li', '候補なし'));
        return;
    }
    for (const candidate of values) {
        const item = node('li', candidate.word);
        item.append(node('p', `表示注釈：${candidate.annotation ?? 'なし'} / 送り条件：${candidate.okuri === undefined ? '指定なし' : candidate.okuri || '空文字'}`));
        const sources = node('ul', '');
        for (const source of candidate.sources ?? []) {
            sources.append(node('li', `${source.kind === 'learned' ? '学習' : 'システム'}：${source.name ?? source.dictId ?? '名称なし'} / 注釈：${source.annotation ?? 'なし'}`));
        }
        item.append(sources);
        list.append(item);
    }
}

async function refresh(): Promise<void> {
    busy = true;
    ready = false;
    controls();
    element('error').textContent = '';
    element('notice').textContent = '保存済み構成を確認中…';
    try {
        await rpc({ type: 'SKK_WAIT_READY' });
        const status = await rpc<SystemDictionaryStatus>({ type: 'SKK_SYSTEM_STATUS' });
        ready = status.revision > 0;
        element('notice').textContent = ready
            ? `前回確認した保存済み構成：リビジョン ${status.revision}（有効な辞書 ${status.dictionaries.filter((dictionary) => dictionary.enabled).length} 個）`
            : '辞書の初期化が完了していません。再取得してください。';
    } catch (error) {
        element('notice').textContent = '保存済み構成を取得できませんでした。';
        element('error').textContent = errorText(error);
    } finally {
        busy = false;
        controls();
    }
}

input('preview-all').onchange = () => { input('preview-okuri').disabled = input('preview-all').checked; };
element<HTMLFormElement>('preview-form').onsubmit = (event) => {
    event.preventDefault();
    if (busy || !ready) return;
    busy = true;
    controls();
    const key = input('preview-key').value;
    const okuri = input('preview-all').checked ? undefined : input('preview-okuri').value;
    element('preview-status').textContent = '候補を取得中…';
    void rpc<SystemDictionaryPreview>({ type: 'SKK_SYSTEM_PREVIEW', key, okuri }).then((result) => {
        candidates('system-candidates', result.systemCandidates);
        candidates('effective-candidates', result.effectiveCandidates);
        element('preview-status').textContent = `取得時点の候補：${result.key} / ${result.okuri === undefined ? '全条件' : `送り仮名「${result.okuri}」`}`;
    }).catch((error) => {
        element('preview-status').textContent = `取得失敗：${errorText(error)}（前の結果を保持しています）`;
    }).finally(() => {
        busy = false;
        controls();
    });
};
element('refresh').onclick = () => { if (!busy) void refresh(); };

controls();
void refresh();
