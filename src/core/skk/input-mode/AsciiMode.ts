import { HiraganaMode } from "./HiraganaMode";
import { AbstractInputMode } from "./AbstractInputMode";

import type { IEditor } from "../editor/IEditor";

export class AsciiMode extends AbstractInputMode {
    constructor(editor?: IEditor) {
        super(editor);
    }

    public static getInstance(editor?: IEditor): AsciiMode {
        return new AsciiMode(editor);
    }

    public async reset(): Promise<void> {
        // Do nothing
    }

    public async lowerAlphabetInput(key: string): Promise<void> {
        await this.editor.insertOrReplaceSelection(key);
    }

    public async upperAlphabetInput(key: string): Promise<void> {
        await this.editor.insertOrReplaceSelection(key);
    }

    public async spaceInput(): Promise<void> {
        await this.editor.insertOrReplaceSelection(" ");
    }

    public async ctrlJInput(): Promise<void> {
        this.editor.setInputMode(HiraganaMode.getInstance(this.editor));
    }

    public async ctrlGInput(): Promise<void> {
        // Do nothing
    }

    public async enterInput(): Promise<void> {
        await this.editor.insertOrReplaceSelection("\n");
    }

    public async backspaceInput(): Promise<void> {
        await this.editor.deleteLeft();
    }

    public async numberInput(key: string): Promise<void> {
        await this.editor.insertOrReplaceSelection(key);
    }

    public async symbolInput(key: string): Promise<void> {
        await this.editor.insertOrReplaceSelection(key);
    }

    public override getActiveKeys(): Set<string> {
        // In AsciiMode, SKK should only explicitly handle ctrl+j for mode switching.
        // Other keys should be passed through to default handling.
        return new Set<string>(["ctrl+j"]);
    }

    public getContextualName(): string {
        return "ascii";
    }
}
