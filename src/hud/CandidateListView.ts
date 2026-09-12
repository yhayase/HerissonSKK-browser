import { OVERLAY_THEME_CSS } from "./overlayTheme";

export interface CandidateRow {
    key: string;
    word: string;
    annotation?: string;
}

export interface CandidateListState {
    rows: CandidateRow[];
    annotationMode?: "normal" | "choose" | "detail";
    detailIndex?: number;
}

/** 候補行の表示だけを担当し、選択状態やキー入力は所有しません。 */
export class CandidateListView {
    public readonly element: HTMLElement;

    private readonly rowsElement: HTMLElement;
    private readonly guidanceElement: HTMLElement;
    private readonly detailElement: HTMLElement;
    private readonly detailWordElement: HTMLElement;
    private readonly detailAnnotationElement: HTMLElement;
    private readonly detailHintElement: HTMLElement;
    private compact = false;
    private lastState: CandidateListState = { rows: [] };

    constructor(document: Document = globalThis.document) {
        this.element = document.createElement("div");
        this.element.className = "skk-candidate-list";
        this.element.setAttribute("role", "listbox");

        const style = document.createElement("style");
        // 共有トークンをこのコンポーネントの通常DOMでも利用できるようにします。
        style.textContent = `${OVERLAY_THEME_CSS.replaceAll(":host", ".skk-candidate-list")}
          .skk-candidate-list {
            container-type: inline-size;
            box-sizing: border-box;
            width: 100%;
            max-width: 100%;
            color: var(--skk-overlay-text);
            background: var(--skk-overlay-surface);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-size: 18px;
            line-height: 1.4;
            overflow: hidden;
          }
          .skk-candidate-rows { display: flex; flex-direction: column; gap: 2px; }
          .skk-candidate-rows[hidden] { display: none; }
          .skk-candidate-row {
            display: grid;
            grid-template-columns: max-content minmax(0, 1fr) minmax(0, 1fr);
            align-items: baseline;
            column-gap: 8px;
            min-width: 0;
            padding: 2px 0;
          }
          .skk-candidate-key {
            min-width: 2.2em;
            color: var(--skk-overlay-text);
            font-size: 14px;
            font-weight: 700;
            text-align: center;
          }
          .skk-candidate-word { min-width: 0; overflow-wrap: anywhere; }
          .skk-candidate-annotation {
            min-width: 0;
            color: var(--skk-overlay-muted);
            font-size: 14px;
            overflow: hidden;
            display: -webkit-box;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 2;
            overflow-wrap: anywhere;
          }
          .skk-candidate-annotation-indicator { display: none; }
          .skk-candidate-list.is-compact .skk-candidate-annotation-text { display: none; }
          .skk-candidate-list.is-compact .skk-candidate-annotation-indicator { display: inline; }
          .skk-candidate-guidance {
            color: var(--skk-overlay-muted);
            font-size: 14px;
            margin-top: 4px;
          }
          .skk-candidate-detail {
            max-height: 12em;
            overflow: auto;
            padding: 4px 0;
          }
          .skk-candidate-detail-word { font-size: 18px; font-weight: 700; overflow-wrap: anywhere; }
          .skk-candidate-detail-annotation {
            color: var(--skk-overlay-muted);
            font-size: 14px;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
          }
          .skk-candidate-detail-hint { color: var(--skk-overlay-muted); font-size: 14px; margin-top: 6px; }
          @container (max-width: 360px) {
            .skk-candidate-row { grid-template-columns: max-content minmax(0, 1fr); }
            .skk-candidate-annotation { grid-column: 2; }
          }
        `;
        this.element.appendChild(style);

        this.rowsElement = document.createElement("div");
        this.rowsElement.className = "skk-candidate-rows";
        this.element.appendChild(this.rowsElement);

        this.guidanceElement = document.createElement("div");
        this.guidanceElement.className = "skk-candidate-guidance";
        this.guidanceElement.hidden = true;
        this.element.appendChild(this.guidanceElement);

        this.detailElement = document.createElement("div");
        this.detailElement.className = "skk-candidate-detail";
        this.detailElement.hidden = true;
        this.detailWordElement = document.createElement("div");
        this.detailWordElement.className = "skk-candidate-detail-word";
        this.detailAnnotationElement = document.createElement("div");
        this.detailAnnotationElement.className = "skk-candidate-detail-annotation";
        this.detailHintElement = document.createElement("div");
        this.detailHintElement.className = "skk-candidate-detail-hint";
        this.detailHintElement.textContent = "Escで候補一覧に戻る";
        this.detailElement.append(this.detailWordElement, this.detailAnnotationElement, this.detailHintElement);
        this.element.appendChild(this.detailElement);
    }

    public render(state: CandidateListState): void {
        this.lastState = { ...state, rows: state.rows.slice() };
        while (this.rowsElement.firstChild) this.rowsElement.removeChild(this.rowsElement.firstChild);

        const mode = state.annotationMode ?? "normal";
        this.rowsElement.hidden = mode === "detail";
        this.guidanceElement.hidden = mode !== "choose";
        this.guidanceElement.textContent = mode === "choose" ? "? 注釈:選択キー" : "";
        this.detailElement.hidden = mode !== "detail";

        if (mode === "detail") {
            const index = Math.max(0, Math.min(state.detailIndex ?? 0, state.rows.length - 1));
            const row = state.rows[index];
            this.detailWordElement.textContent = row?.word ?? "";
            this.detailAnnotationElement.textContent = row?.annotation ?? "注釈なし";
            return;
        }

        for (const row of state.rows) {
            const rowElement = this.element.ownerDocument!.createElement("div");
            rowElement.className = "skk-candidate-row";
            rowElement.setAttribute("role", "option");
            const keyElement = this.element.ownerDocument!.createElement("span");
            keyElement.className = "skk-candidate-key";
            keyElement.textContent = row.key;
            const wordElement = this.element.ownerDocument!.createElement("span");
            wordElement.className = "skk-candidate-word";
            wordElement.textContent = row.word;
            rowElement.append(keyElement, wordElement);
            if (row.annotation) {
                const annotationElement = this.element.ownerDocument!.createElement("span");
                annotationElement.className = "skk-candidate-annotation";
                annotationElement.setAttribute("title", row.annotation);
                const textElement = this.element.ownerDocument!.createElement("span");
                textElement.className = "skk-candidate-annotation-text";
                textElement.textContent = row.annotation;
                const indicatorElement = this.element.ownerDocument!.createElement("span");
                indicatorElement.className = "skk-candidate-annotation-indicator";
                indicatorElement.textContent = "注釈あり";
                annotationElement.append(textElement, indicatorElement);
                rowElement.appendChild(annotationElement);
            }
            this.rowsElement.appendChild(rowElement);
        }
    }

    public setCompact(compact: boolean): void {
        this.compact = compact;
        this.element.classList.toggle("is-compact", compact);
    }

    public scrollDetail(delta: number): void {
        if (this.detailElement.hidden) return;
        this.detailElement.scrollTop += delta;
    }

    public measure(): { rowHeight: number; annotationHeight: number } {
        const row = this.rowsElement.querySelector<HTMLElement>(".skk-candidate-row");
        const annotation = this.rowsElement.querySelector<HTMLElement>(".skk-candidate-annotation");
        return { rowHeight: row?.offsetHeight ?? 0, annotationHeight: annotation?.offsetHeight ?? 0 };
    }
}
