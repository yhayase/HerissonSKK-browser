import { Candidate, candidateIdentity } from '../../core/skk/jisyo/candidate';
import { parseJisyoLine } from '../../core/skk/jisyo/JisyoParser';
import { parseJsonJisyo } from '../../core/skk/jisyo/JsonJisyoParser';
import type { DictionaryDefinition } from './DictionaryLoader';

export const yieldImport = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** 大きな辞書の走査中も変換要求を処理できるよう、一定量ごとに制御を返します。 */
async function run<T>(steps: Generator<void, T>): Promise<T> {
    let deadline = performance.now() + 8;
    while (true) {
        const step = steps.next();
        if (step.done) return step.value;
        if (performance.now() >= deadline) { await yieldImport(); deadline = performance.now() + 8; }
    }
}

async function decode(bytes: Uint8Array, encoding: string, fatal = false): Promise<string> {
    const decoder = new TextDecoder(encoding, { fatal });
    const parts: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 65536) {
        parts.push(decoder.decode(bytes.subarray(offset, offset + 65536), { stream: true }));
        await yieldImport();
    }
    parts.push(decoder.decode());
    return parts.join('');
}

/** JSON.parse の全体走査を避け、重複キーと構文を同時に検証します。 */
function* json(source: string): Generator<void, unknown> {
    let pos = 0;
    function* whitespace(): Generator<void> {
        while (/^[ \t\r\n]$/.test(source[pos] ?? '')) { pos++; if (pos % 4096 === 0) yield; }
    }
    function* string(): Generator<void, string> {
        const start = pos++;
        while (pos < source.length) {
            const char = source[pos++];
            if (char === '"') return JSON.parse(source.slice(start, pos)) as string;
            if (char === '\\') pos++;
            if (pos % 4096 < 2) yield;
        }
        throw new Error('JSON 文字列が閉じられていません。');
    }
    type Frame = { value: Record<string, unknown> | unknown[]; object: boolean; state: 'first' | 'next' | 'comma'; key?: string };
    const stack: Frame[] = [];
    let result: unknown;
    let complete = false;
    const accept = (item: unknown) => {
        const parent = stack.at(-1);
        if (!parent) { result = item; complete = true; }
        else {
            if (parent.object) (parent.value as Record<string, unknown>)[parent.key!] = item;
            else (parent.value as unknown[]).push(item);
            parent.state = 'comma';
        }
    };
    while (true) {
        yield* whitespace();
        yield;
        const frame = stack.at(-1);
        if (!frame && complete) break;
        if (frame) {
            const end = frame.object ? '}' : ']';
            if (frame.state === 'comma') {
                if (source[pos] === end) { pos++; stack.pop(); continue; }
                if (source[pos++] !== ',') throw new Error('JSON の区切りが正しくありません。');
                frame.state = 'next';
                continue;
            }
            if (frame.state === 'first' && source[pos] === end) { pos++; stack.pop(); continue; }
            if (frame.object) {
                if (source[pos] !== '"') throw new Error('JSON のキーが正しくありません。');
                const key = yield* string();
                if (Object.hasOwn(frame.value, key)) throw new Error('JSON のキーが重複しています。');
                frame.key = key;
                yield* whitespace();
                if (source[pos++] !== ':') throw new Error('JSON の区切りが正しくありません。');
                yield* whitespace();
            }
        }
        const char = source[pos];
        if (char === '{' || char === '[') {
            pos++;
            const object = char === '{';
            const item = object ? Object.create(null) as Record<string, unknown> : [];
            accept(item);
            stack.push({ value: item, object, state: 'first' });
        } else if (char === '"') accept(yield* string());
        else {
            const start = pos;
            while (pos < source.length && !/[\s,}\]]/.test(source[pos]!)) { pos++; if (pos % 4096 === 0) yield; }
            accept(JSON.parse(source.slice(start, pos)) as unknown);
        }
    }
    if (pos !== source.length) throw new Error('JSON の末尾が正しくありません。');
    return result;
}

export async function parseDictionaryCooperatively(bytes: Uint8Array, definition: DictionaryDefinition): Promise<Map<string, Candidate[]>> {
    let text: string;
    let utf8 = true;
    try { text = await decode(bytes, 'utf-8', true); }
    catch { utf8 = false; text = await decode(bytes, 'euc-jp'); }
    const format = definition.format && definition.format !== 'auto' ? definition.format
        : definition.dictPath.toLowerCase().endsWith('.json') || (utf8 && text.trimStart().startsWith('{')) ? 'json' : 'text';
    const entries = new Map<string, Candidate[]>();
    if (format === 'json') {
        if (!utf8) throw new Error('JSON 辞書は UTF-8 で指定してください。');
        const document = await run(json(text)) as Record<string, unknown>;
        // メタデータと必須セクションは既存のスキーマ検証に合わせます。
        if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('辞書のルートが正しくありません。');
        const metadata = { ...Object.fromEntries(['copyright', 'license', 'version'].filter((key) => Object.hasOwn(document, key)).map((key) => [key, document[key]])), okuri_ari: {}, okuri_nasi: {} };
        parseJsonJisyo(JSON.stringify(metadata));
        await run((function* () {
            for (const section of ['okuri_ari', 'okuri_nasi']) {
                const values = document[section];
                if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('辞書のセクションが正しくありません。');
                for (const key in values) {
                    const words = (values as Record<string, unknown>)[key];
                    if (!Array.isArray(words)) throw new Error('候補は配列で指定してください。');
                    const existing = entries.get(key) ?? [];
                    const seen = new Set(existing.map((c) => c.word));
                    const first = !entries.has(key);
                    for (const word of words) {
                        if (typeof word !== 'string') throw new Error('候補は文字列で指定してください。');
                        if (first || !seen.has(word)) { existing.push(new Candidate(word)); seen.add(word); }
                        yield;
                    }
                    if (existing.length) entries.set(key, existing);
                    yield;
                }
            }
        })());
    } else {
        await run((function* () {
            let start = 0;
            for (let pos = 0; pos <= text.length; pos++) {
                if (pos % 4096 === 0) yield;
                if (pos < text.length && text[pos] !== '\n' && text[pos] !== '\r') continue;
                const entry = parseJisyoLine(text.slice(start, pos));
                start = pos + 1;
                if (!entry) continue;
                const existing = entries.get(entry.key);
                if (!existing) entries.set(entry.key, entry.candidates);
                else for (const candidate of entry.candidates) {
                    const old = existing.find((c) => candidateIdentity(c) === candidateIdentity(candidate));
                    if (!old) existing.push(candidate);
                    else if (!old.annotation && candidate.annotation) old.annotation = candidate.annotation;
                }
                yield;
            }
        })());
    }
    return entries;
}
