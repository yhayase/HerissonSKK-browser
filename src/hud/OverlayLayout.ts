export interface OverlayViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type OverlaySide = 'below' | 'above' | 'edge';
export type OverlayAnnotation = 'full' | 'compact';

export interface OverlayLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  maxHeight: number;
  side: OverlaySide;
  capacity: number;
  annotation: OverlayAnnotation;
  scrollable: boolean;
}

export interface OverlayLayoutInput {
  /** 座標はすべてレイアウトビューポート基準の CSS ピクセルです。 */
  viewport: OverlayViewport;
  caret: { x: number; top: number; bottom: number };
  desiredWidth: number;
  /** 幅を制限して測定した、注釈を除く候補行の最大高さです。 */
  rowHeight: number;
  /** 通常表示で各行に追加する注釈の最大高さです。 */
  annotationHeight: number;
  /** ヘッダー、フッター、余白など、候補行以外の高さです。 */
  chromeHeight: number;
  /** 候補メニュー以外は 0、候補メニューは最大 7 行です。 */
  candidateCount?: number;
  /** 同じ変換中の直前の結果です。変換終了時に破棄します。 */
  previous?: Pick<OverlayLayout, 'side' | 'capacity' | 'annotation'>;
  margin?: number;
  gap?: number;
}

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const positive = (value: number): number => Math.max(0, finite(value));
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

/** フォントを縮めず、注釈の省略、行数の削減の順に表示領域へ収めます。 */
export function computeOverlayLayout(input: OverlayLayoutInput): OverlayLayout {
  const viewport = input.viewport;
  const viewportWidth = positive(viewport.width);
  const viewportHeight = positive(viewport.height);
  // 極小領域でも余白だけで表示領域が消えないようにします。
  const margin = positive(input.margin ?? 8);
  const marginX = Math.min(margin, viewportWidth / 4);
  const marginY = Math.min(margin, viewportHeight / 4);
  const left = finite(viewport.x) + marginX;
  const top = finite(viewport.y) + marginY;
  const right = finite(viewport.x) + viewportWidth - marginX;
  const bottom = finite(viewport.y) + viewportHeight - marginY;
  const width = Math.min(positive(input.desiredWidth), right - left);
  const x = clamp(finite(input.caret.x, left), left, right - width);
  const gap = positive(input.gap ?? 4);
  const caretTop = finite(input.caret.top, top);
  const caretBottom = Math.max(caretTop, finite(input.caret.bottom, caretTop));
  const belowY = clamp(caretBottom + gap, top, bottom);
  const aboveBottom = clamp(caretTop - gap, top, bottom);
  const available = { below: bottom - belowY, above: aboveBottom - top, edge: bottom - top };
  const requested = clamp(Math.floor(finite(input.candidateCount ?? 7, 7)), 0, 7);
  const maximumCapacity = Math.max(1, requested);
  const rowHeight = Math.max(1, positive(input.rowHeight));
  const annotationHeight = positive(input.annotationHeight);
  const chromeHeight = positive(input.chromeHeight);
  const contentHeight = (capacity: number, annotation: OverlayAnnotation): number =>
    chromeHeight + (requested === 0 ? 0 : capacity) *
      (rowHeight + (annotation === 'full' ? annotationHeight : 0));
  const result = (side: OverlaySide, capacity: number, annotation: OverlayAnnotation): OverlayLayout => {
    const naturalHeight = contentHeight(capacity, annotation);
    const height = Math.min(naturalHeight, available[side]);
    return {
      x,
      y: side === 'below' ? belowY : side === 'above' ? aboveBottom - height : top,
      width,
      height,
      maxHeight: available[side],
      side,
      capacity,
      annotation,
      scrollable: naturalHeight > height,
    };
  };

  const previous = input.previous;
  if (previous && previous.side !== 'edge') {
    const capacity = clamp(Math.floor(finite(previous.capacity, 1)), 1, maximumCapacity);
    if (contentHeight(capacity, previous.annotation) <= available[previous.side]) {
      // 位置は現在のキャレットに追従し、収まる間は表示方向とページ容量を保ちます。
      return result(previous.side, capacity, previous.annotation);
    }
  }

  for (const annotation of ['full', 'compact'] as const) {
    for (const side of ['below', 'above'] as const) {
      if (contentHeight(maximumCapacity, annotation) <= available[side]) {
        return result(side, maximumCapacity, annotation);
      }
    }
  }

  // 注釈を省略しても収まらない場合は、表示できる候補数の多い側を使います。
  const side = available.below >= available.above ? 'below' : 'above';
  if (contentHeight(1, 'compact') <= available[side]) {
    const capacity = requested === 0 ? 1 : clamp(
      Math.floor((available[side] - chromeHeight) / rowHeight), 1, maximumCapacity,
    );
    return result(side, capacity, 'compact');
  }

  // 一行も収まらない場合だけ行への重なりを許し、内容はスクロールで参照します。
  return result('edge', 1, 'compact');
}
