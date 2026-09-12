import { describe, expect, it } from 'vitest';
import { computeOverlayLayout, type OverlayLayoutInput } from '../../src/hud/OverlayLayout';

const defaults: OverlayLayoutInput = {
  viewport: { x: 0, y: 0, width: 800, height: 600 },
  caret: { x: 100, top: 100, bottom: 120 },
  desiredWidth: 300,
  rowHeight: 24,
  annotationHeight: 16,
  chromeHeight: 40,
  candidateCount: 7,
  margin: 0,
  gap: 4,
};

describe('候補オーバーレイの配置', () => {
  it('余裕がある場合はキャレットの下に七行と注釈を表示する', () => {
    expect(computeOverlayLayout(defaults)).toEqual({
      x: 100, y: 124, width: 300, height: 320, maxHeight: 476,
      side: 'below', capacity: 7, annotation: 'full', scrollable: false,
    });
  });

  it('右下では左へ寄せ、キャレット行を避けて上に表示する', () => {
    const layout = computeOverlayLayout({ ...defaults, caret: { x: 790, top: 570, bottom: 590 } });
    expect(layout.x).toBe(500);
    expect(layout.side).toBe('above');
    expect(layout.y + layout.height).toBe(566);
    expect(layout.capacity).toBe(7);
  });

  it('visualViewport のオフセットを含む表示領域に収める', () => {
    const layout = computeOverlayLayout({
      ...defaults, viewport: { x: 230, y: 310, width: 400, height: 500 },
      caret: { x: 620, top: 340, bottom: 360 }, desiredWidth: 900, margin: 8,
    });
    expect(layout.x).toBe(238);
    expect(layout.width).toBe(384);
    expect(layout.y).toBe(364);
    expect(layout.y + layout.height).toBeLessThanOrEqual(802);
  });

  it('行数を減らす前に注釈を省略する', () => {
    const layout = computeOverlayLayout({ ...defaults, viewport: { ...defaults.viewport, height: 350 } });
    expect(layout).toMatchObject({ side: 'below', capacity: 7, annotation: 'compact', height: 208 });
  });

  it('注釈を省略しても収まらなければ容量を減らす', () => {
    const layout = computeOverlayLayout({ ...defaults, viewport: { ...defaults.viewport, height: 260 } });
    expect(layout).toMatchObject({ side: 'below', capacity: 4, annotation: 'compact', height: 136 });
    expect(layout.scrollable).toBe(false);
  });

  it('一行もキャレットの上下に収まらない場合だけ端へ配置する', () => {
    const layout = computeOverlayLayout({
      ...defaults, viewport: { x: 20, y: 30, width: 10, height: 10 },
      caret: { x: 25, top: 33, bottom: 37 }, margin: 8,
    });
    expect(layout).toMatchObject({ x: 22.5, y: 32.5, width: 5, height: 5,
      side: 'edge', capacity: 1, annotation: 'compact', scrollable: true });
  });

  it('同じ変換では余裕が増えても方向と容量を保ち、位置はキャレットに追従する', () => {
    const previous = computeOverlayLayout({
      ...defaults, viewport: { ...defaults.viewport, height: 260 },
      caret: { x: 100, top: 170, bottom: 190 },
    });
    expect(previous).toMatchObject({ side: 'above', capacity: 5, annotation: 'compact' });
    const layout = computeOverlayLayout({ ...defaults, caret: { x: 150, top: 210, bottom: 230 }, previous });
    expect(layout).toMatchObject({ side: 'above', capacity: 5, annotation: 'compact', x: 150, y: 46 });
  });

  it('以前の方向に収まらなくなった場合は反転する', () => {
    const previous = computeOverlayLayout(defaults);
    const layout = computeOverlayLayout({ ...defaults, caret: { x: 100, top: 570, bottom: 590 }, previous });
    expect(layout.side).toBe('above');
    expect(layout.capacity).toBe(7);
  });

  it('極端に長い候補は幅だけ制限し、測定済み行高を縮めない', () => {
    const layout = computeOverlayLayout({ ...defaults, desiredWidth: 10000, rowHeight: 1000 });
    expect(layout).toMatchObject({ width: 800, height: 600, side: 'edge', capacity: 1, scrollable: true });
  });

  it('候補のない通常表示は chromeHeight だけで配置する', () => {
    const layout = computeOverlayLayout({ ...defaults, candidateCount: 0 });
    expect(layout).toMatchObject({ height: 40, capacity: 1, side: 'below' });
  });

  it('容量の上限とゼロサイズの表示領域を扱う', () => {
    expect(computeOverlayLayout({ ...defaults, candidateCount: 100 }).capacity).toBe(7);
    const layout = computeOverlayLayout({ ...defaults, viewport: { x: 10, y: 20, width: 0, height: 0 } });
    expect(layout).toMatchObject({ x: 10, y: 20, width: 0, height: 0, maxHeight: 0, capacity: 1, scrollable: true });
  });

  it('無効な測定値で負のサイズや非数値の座標を返さない', () => {
    const layout = computeOverlayLayout({
      ...defaults, viewport: { x: NaN, y: Infinity, width: -1, height: NaN },
      caret: { x: NaN, top: NaN, bottom: NaN }, desiredWidth: Infinity,
      rowHeight: NaN, annotationHeight: -10, chromeHeight: -1,
    });
    for (const key of ['x', 'y', 'width', 'height', 'maxHeight', 'capacity'] as const) {
      expect(Number.isFinite(layout[key])).toBe(true);
      expect(layout[key]).toBeGreaterThanOrEqual(0);
    }
  });
});
