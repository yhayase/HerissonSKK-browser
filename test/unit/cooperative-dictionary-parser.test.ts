import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDictionary } from '../../src/storage/jisyo/DictionaryLoader';
import { parseDictionaryCooperatively } from '../../src/storage/jisyo/CooperativeDictionaryParser';

const definition = { dictId: 'test', dictPath: 'test', version: '1' };
const encode = (text: string) => new TextEncoder().encode(text);
describe('cooperative dictionary parsing', () => {
    it.each(['public/dict/SKK-JISYO.S', 'public/dict/SKK-JISYO.S.json', 'test/fixtures/dictionary-primary-v1.json'])('matches the legacy parser for %s', async (path) => {
        const bytes = readFileSync(path);
        expect(await parseDictionaryCooperatively(bytes, { ...definition, dictPath: path })).toEqual(parseDictionary(bytes, { ...definition, dictPath: path }));
    });
    it.each([
        'かな /仮名/\rかな /仮名;注釈/カナ/\nかk /書/[く/描/]/\r\n',
        JSON.stringify({ copyright: '', license: '', okuri_ari: { 'かな': ['重複', '重複', '😀\\\"'] }, okuri_nasi: { 'かな': ['重複', '追加'], '__proto__': [] }, extra: [true, null, -1.2e4] }),
    ])('preserves duplicate, annotation and escape semantics', async (text) => {
        expect(await parseDictionaryCooperatively(encode(text), definition)).toEqual(parseDictionary(encode(text), definition));
    });
    it.each([
        '{"copyright":"","license":"","okuri_ari":{},"okuri_nasi":{},"extra":{"a":1,"a":2}}',
        '{"copyright":"","license":"","okuri_ari":{},"okuri_nasi":{"a":[1]}}',
        '{"copyright":"","license":"","okuri_ari":{},"okuri_nasi":{},}',
        '{"copyright":"","license":"","okuri_ari":{},"okuri_nasi":{},"extra":01}',
        '{"copyright":"","license":"","okuri_ari":{},"okuri_nasi":{},"extra":"\\x"}',
        '{"copyright":"","license":"","okuri_ari":{}}',
    ])('rejects invalid JSON accepted by neither path', async (text) => {
        expect(() => parseDictionary(encode(text), definition)).toThrow();
        await expect(parseDictionaryCooperatively(encode(text), definition)).rejects.toThrow();
    });
    it('accepts deeply nested unknown metadata and prototype-like keys', async () => {
        const text = '{"copyright":"","license":"","okuri_ari":{},"okuri_nasi":{"__proto__":["候補"],"2":["二"],"1":["一"]},"extra":' + '['.repeat(12000) + 'null' + ']'.repeat(12000) + '}';
        expect(await parseDictionaryCooperatively(encode(text), definition)).toEqual(parseDictionary(encode(text), definition));
    });
    it('allows event-loop work before a large parse completes', async () => {
        let ticks = 0;
        const timer = setInterval(() => ticks++, 0);
        try {
            const parsed = await parseDictionaryCooperatively(encode(Array.from({ length: 20000 }, (_, i) => `key${i} /候補/`).join('\n')), definition);
            expect(parsed.size).toBe(20000);
            expect(ticks).toBeGreaterThan(2);
        } finally { clearInterval(timer); }
    });
});
