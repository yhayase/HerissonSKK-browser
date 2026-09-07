import { RomajiInput } from "../../romaji/RomajiInput";
import type { IInputMode } from "./IInputMode";
import { KatakanaMode } from "./KatakanaMode";
import { AbstractKanaMode } from "./AbstractKanaMode";

import type { IEditor } from "../editor/IEditor";

export class HiraganaMode extends AbstractKanaMode implements IInputMode {
    constructor(editor?: IEditor) {
        super(editor);
    }

    static getInstance(editor?: IEditor): HiraganaMode {
        return new HiraganaMode(editor);
    }

    newRomajiInput(): RomajiInput {
        return new RomajiInput(false);
    }

    public override toString(): string {
        return "かな";
    }

    protected nextMode() {
        return KatakanaMode.getInstance(this.editor);
    }

    protected getKanaModeBaseName(): string {
        return "hiragana";
    }
}
