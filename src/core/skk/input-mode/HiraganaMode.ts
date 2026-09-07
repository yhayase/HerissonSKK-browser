import { RomajiInput } from "../../romaji/RomajiInput";
import type { IInputMode } from "./IInputMode";
import { KatakanaMode } from "./KatakanaMode";
import { AbstractKanaMode } from "./AbstractKanaMode";

export class HiraganaMode extends AbstractKanaMode implements IInputMode {
    static getInstance(): HiraganaMode {
        return new HiraganaMode();
    }

    newRomajiInput(): RomajiInput {
        return new RomajiInput(false);
    }

    public override toString(): string {
        return "かな";
    }

    protected nextMode() {
        return KatakanaMode.getInstance();
    }

    protected getKanaModeBaseName(): string {
        return "hiragana";
    }
}
