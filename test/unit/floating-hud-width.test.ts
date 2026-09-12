import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloatingHUD } from '../../src/hud/FloatingHUD';
import { withOverlayDOM } from './mocks/OverlayDOM';

afterEach(() => vi.unstubAllGlobals());

function setup(naturalWidth: number, viewportWidth = 800) {
    const nodes: any[] = [];
    const measuredStyles: string[] = [];
    const document = {
        body: { appendChild: () => {} },
        getElementById: () => null,
        addEventListener: () => {},
        createElement: () => {
            const element = withOverlayDOM({ style: {} as Record<string, string>, offsetHeight: 36,
                attachShadow: () => ({ appendChild: () => {} }) });
            Object.defineProperty(element, 'offsetWidth', { get: () => {
                measuredStyles.push(element.style.width!);
                return Math.min(naturalWidth, Number.parseFloat(element.style.maxWidth!));
            } });
            nodes.push(element);
            return element;
        },
    };
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', { innerWidth: viewportWidth, innerHeight: 600 });
    const hud = new FloatingHUD();
    return { hud, nodes, measuredStyles, box: () => nodes.find(node => node.classList.contains('skk-hud-box')) };
}

describe('通常 HUD の内容幅', () => {
    it.each([{ preedit: '▽か' }, { candidate: '蚊' }])('短い表示は実寸で右端に配置する: %j', content => {
        const s = setup(120);
        s.hud.update({ x: 790, y: 120, mode: 'かな', ...content });
        expect(s.measuredStyles).toContain('max-content');
        expect(s.box().style.width).toBe('120px');
        expect(s.box().style.left).toBe('672px');
    });

    it.each([{ viewport: 800, width: 360 }, { viewport: 200, width: 184 }])(
        '長い読みは上限と表示領域を守り末尾へスクロールする: %j', ({ viewport, width }) => {
            const s = setup(1000, viewport);
            const preedit = s.nodes.find(node => node.className === 'skk-preedit');
            preedit.scrollWidth = 1000;
            s.hud.update({ x: viewport - 10, y: 120, mode: 'かな', preedit: '▽' + 'か'.repeat(100) });
            expect(s.box().style.width).toBe(`${width}px`);
            expect(preedit.scrollLeft).toBe(1000);
            expect(Number.parseFloat(s.box().style.left) + width).toBeLessThanOrEqual(viewport - 8);
        },
    );
});
