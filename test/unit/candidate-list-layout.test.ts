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

describe("候補一覧の幅フォールバック", () => {
    it.each([
        [360, true],
        [359, true],
        [361, false],
    ])("実測幅 %dpx を container query 非対応時のレイアウト選択に反映する", (width, narrow) => {
        const view = new CandidateListView(createDocument());

        view.setWidth(width);

        expect(view.element.classList.contains("is-narrow")).toBe(narrow);
    });
});
