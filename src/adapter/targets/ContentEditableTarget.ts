import type { IEditorTarget, IEditorSelectionSnapshot } from "./IEditorTarget";

export class ContentEditableTarget implements IEditorTarget {
    constructor(private element: HTMLElement) {}

    public isValid(): boolean {
        throw new Error("Not implemented");
    }

    public getElement(): HTMLElement {
        return this.element;
    }

    public saveSelection(): IEditorSelectionSnapshot {
        throw new Error("Not implemented");
    }

    public focus(): boolean {
        throw new Error("Not implemented");
    }

    public insertText(text: string): { success: boolean; method: string } {
        throw new Error("Not implemented");
    }

    public deleteLeft(): boolean {
        throw new Error("Not implemented");
    }

    public getText(): string {
        throw new Error("Not implemented");
    }
}
