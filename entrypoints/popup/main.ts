import './style.css';
import { browser } from 'wxt/browser';
import { sendRuntimeMessage } from '@/src/storage/rpc/runtimeClient';
import type { SystemDictionaryStatus } from '@/src/storage/jisyo/SystemDictionaryConfiguration';
import { startupMessage } from '@/src/settings/model';
const status = document.getElementById('status')!;
document.getElementById('open-options')!.onclick = () => {
    void browser.runtime.openOptionsPage().catch((error: unknown) => { status.textContent = `設定画面を開けませんでした：${String(error)}`; });
};
void sendRuntimeMessage<SystemDictionaryStatus>({ type: 'SKK_SYSTEM_STATUS' }).then((result) => {
    status.textContent = startupMessage(result) ?? `使用中の構成（${result.revision}）：有効な辞書 ${result.dictionaries.filter((d) => d.enabled).length} 個。${result.operation.state === 'updating' ? '更新中…' : result.operation.state === 'error' ? `更新失敗：${result.operation.error}` : ''}`;
    const list = document.getElementById('dictionaries')!;
    for (const d of result.revision > 0 ? result.dictionaries : []) { const item = document.createElement('li'); item.textContent = `${d.name} / ${d.format} / ${d.enabled ? '有効' : '無効'} / ${d.state === 'ready' ? '取得済み・オフライン利用可能' : '未取得'}`; list.append(item); }
}).catch((error: unknown) => { status.textContent = `構成を取得できませんでした：${String(error)}`; });
