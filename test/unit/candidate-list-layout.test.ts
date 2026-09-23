import { afterEach, describe, expect, it, vi } from "vitest";
import { CandidateListView } from "../../src/hud/CandidateListView";
import { withOverlayDOM } from "./mocks/OverlayDOM";

afterEach(() => vi.unstubAllGlobals());

function createDocument() {
    const document = {
        createElement: () => withOverlayDOM({ style: {} as Record<string, string> }),
    } as unknown as Document;
    vi.stubGlobal("document", document);
    return document;
}

describe("候補一覧の内容幅", () => {
    it("狭い幅でも自然にインライン配置し、幅を固定の閾値で段組みにしない", () => {
        const view = new CandidateListView(createDocument());

        view.setWidth(360);

        expect(view.element.classList.contains("is-narrow")).toBe(false);
        expect(view.element.style.width).toBe("360px");
    });

    it("注釈の有無で行の列を分け、注釈列を最長候補へ広げない", () => {
        const view = new CandidateListView(createDocument());
        view.render({ rows: [
            { key: "a", word: "短", annotation: "短い注釈" },
            { key: "b", word: "長い候補語", annotation: "" },
        ] });

        const rows = view.element.querySelectorAll(".skk-candidate-row");
        expect(rows).toHaveLength(2);
        expect(rows[0]!.querySelectorAll(".skk-candidate-annotation")).toHaveLength(1);
        expect(rows[1]!.querySelectorAll(".skk-candidate-annotation")).toHaveLength(0);
    });

    it("親で折り返された幅ではなく行ごとの自然幅で段組みを決める", () => {
        const view = new CandidateListView(createDocument());
        view.render({ rows: [
            { key: "a", word: "長い候補", annotation: "長い注釈" },
            { key: "b", word: "短", annotation: "短い注釈" },
        ] });
        const rows = view.element.querySelectorAll<HTMLElement>(".skk-candidate-row");
        Object.defineProperty(rows[0], "scrollWidth", { get: () =>
            view.element.style.maxWidth === "none" && rows[0]!.style.width === "max-content" ? 500 : 144,
        });
        Object.defineProperty(rows[1], "scrollWidth", { value: 120 });
        Object.defineProperty(view.element, "scrollWidth", { get: () =>
            rows[0]!.classList.contains("is-constrained") ? 260 : 500,
        });

        view.setWidth(300);
        expect(rows[0]!.classList.contains("is-constrained")).toBe(true);
        expect(rows[1]!.classList.contains("is-constrained")).toBe(false);
        expect(view.element.style.width).toBe("260px");
        expect(view.element.style.maxWidth).not.toBe("none");

        view.setWidth(520);
        expect(rows[0]!.classList.contains("is-constrained")).toBe(false);
        expect(view.element.style.width).toBe("500px");

        view.render({ rows: [{ key: "a", word: "短", annotation: "短い注釈" }] });
        expect(view.element.querySelector(".skk-candidate-row")!.classList.contains("is-constrained")).toBe(false);
    });

    it("新しい候補を描画するときは前回の省略表示を解除して自然幅を測る", () => {
        const view = new CandidateListView(createDocument());
        view.setCompact(true);

        view.render({ rows: [{
            key: "a",
            word: "候補",
            annotation: "自然幅の測定対象となる長い注釈です",
        }] });

        expect(view.element.classList.contains("is-compact")).toBe(false);
        expect(view.element.style.width).toBe("max-content");
        expect(view.element.querySelector(".skk-candidate-annotation-text")?.textContent)
            .toBe("自然幅の測定対象となる長い注釈です");
    });
});
