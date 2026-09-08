import { RomajiInput } from "../../romaji/RomajiInput";
import type { IInputMode } from "./IInputMode";
import { HiraganaMode } from "./HiraganaMode";
import { AbstractKanaMode } from "./AbstractKanaMode";

import type { IEditor } from "../editor/IEditor";

export class KatakanaMode extends AbstractKanaMode implements IInputMode {
    constructor(editor?: IEditor) {
        super(editor);
    }

    static getInstance(editor?: IEditor): KatakanaMode {
        return new KatakanaMode(editor);
    }

    newRomajiInput(): RomajiInput {
        return new RomajiInput(true);
    }

    public override toString(): string {
        return "カナ";
    }

    protected nextMode() {
        return HiraganaMode.getInstance(this.editor);
    }

    protected getKanaModeBaseName(): string {
        return "katakana";
    }
}
