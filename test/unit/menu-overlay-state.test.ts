import { describe, expect, it, vi } from 'vitest';
import { MockEditor } from './mocks/MockEditor';
import { HiraganaMode } from '../../src/core/skk/input-mode/HiraganaMode';
import { MenuHenkanMode } from '../../src/core/skk/input-mode/henkan/MenuHenkanMode';
import type { InlineHenkanMode } from '../../src/core/skk/input-mode/henkan/InlineHenkanMode';
import type { CandidateListOptions } from '../../src/core/skk/editor/IEditor';
import { Candidate } from '../../src/core/skk/jisyo/candidate';
import { Entry } from '../../src/core/skk/jisyo/entry';

function setup(count = 22) {
    const editor = new MockEditor();
    const context = new HiraganaMode(editor);
    const entry = new Entry('こうほ', Array.from({ length: count }, (_, i) => new Candidate(`候補${i}`, `注釈${i}`)), '');
    const previous = { showCandidate: vi.fn(), returnToMidashigoMode: vi.fn() } as unknown as InlineHenkanMode;
    let options: CandidateListOptions;
    const original = editor.showCandidateList.bind(editor);
    vi.spyOn(editor, 'showCandidateList').mockImplementation((candidates, keys, state?: CandidateListOptions) => {
        options = state!;
        original(candidates, keys);
    });
    const scroll = vi.fn();
    Object.assign(editor, { scrollCandidateAnnotation: scroll });
    const menu = new MenuHenkanMode(context, editor, previous, entry, 3, 'る', '。');
    context.setHenkanMode(menu);
    return { editor, context, menu, previous, scroll, options: () => options,
        words: () => editor.getCandidateList().candidates.map(c => c.word) };
}

describe('候補ページと注釈ヘルプ', () => {
    it('容量を変更してもページ先頭を保持し、キーと表示行を一致させる', async () => {
        const s = setup();
        s.options().onCapacityChange(3);
        expect(s.words()).toEqual(['候補3', '候補4', '候補5']);
        expect(s.editor.getCandidateList().selectionKeys).toEqual(['A', 'S', 'D']);
        await s.menu.onSpace(s.context);
        expect(s.words()).toEqual(['候補6', '候補7', '候補8']);
        s.options().onCapacityChange(2);
        expect(s.words()).toEqual(['候補6', '候補7']);
        await s.menu.onSpace(s.context);
        expect(s.words()).toEqual(['候補8', '候補9']);
        await s.menu.onBackspace(s.context);
        expect(s.words()).toEqual(['候補6', '候補7']);
        await s.menu.onLowerAlphabet(s.context, 'x');
        expect(s.words()).toEqual(['候補3', '候補4']);
        await s.menu.onBackspace(s.context);
        expect(s.previous.showCandidate).toHaveBeenCalledOnce();
    });

    it('表示外のキーを拒否し、サイズ変更後の表示候補を送り仮名と接尾辞込みで確定する', async () => {
        const s = setup();
        s.options().onCapacityChange(2);
        const fixate = vi.spyOn(s.editor, 'fixateCandidate');
        await s.menu.onLowerAlphabet(s.context, 'd');
        expect(fixate).not.toHaveBeenCalled();
        await s.menu.onUpperAlphabet(s.context, 'S');
        expect(fixate).toHaveBeenCalledWith('候補4る。');
    });

    it('最終ページは存在する行だけにキーを付ける', async () => {
        const s = setup(8);
        s.options().onCapacityChange(3);
        await s.menu.onSpace(s.context);
        expect(s.words()).toEqual(['候補6', '候補7']);
        expect(s.editor.getCandidateList().selectionKeys).toEqual(['A', 'S']);
        expect(s.options().pageCapacity).toBe(3);
    });

    it('? と選択キーでは確定も辞書更新もせず、Esc で通常選択に戻る', async () => {
        const s = setup();
        const fixate = vi.spyOn(s.editor, 'fixateCandidate');
        const reorder = vi.spyOn(s.editor.getJisyoProvider(), 'reorderCandidate');
        await s.menu.onSymbol(s.context, '?');
        expect(s.options().annotationMode).toBe('choose');
        await s.menu.onLowerAlphabet(s.context, 's');
        expect(s.options()).toMatchObject({ annotationMode: 'detail', detailIndex: 1 });
        expect(s.options().onSpecialKey('ArrowDown')).toBe(true);
        expect(s.scroll).toHaveBeenCalledWith(48);
        expect(fixate).not.toHaveBeenCalled();
        expect(reorder).not.toHaveBeenCalled();
        expect(s.options().onSpecialKey('Escape')).toBe(true);
        expect(s.options().annotationMode).toBe('normal');
        await s.menu.onLowerAlphabet(s.context, 's');
        expect(fixate).toHaveBeenCalledWith('候補4る。');
    });

    it('非表示後に届いた容量通知で候補一覧を再表示しない', async () => {
        const s = setup();
        const oldOptions = s.options();
        await s.menu.onCtrlG(s.context);
        oldOptions.onCapacityChange(1);
        expect(s.editor.getCandidateList().candidates).toEqual([]);
        expect(oldOptions.onSpecialKey('Escape')).toBe(false);
    });
});
