import type { IEditorTarget } from "../adapter/targets/IEditorTarget";

export class RegistrationModal {
    constructor(private shadowRoot: ShadowRoot) {}

    public open(yomi: string, okuri: string, originalTarget: IEditorTarget): HTMLInputElement {
        throw new Error("Not implemented");
    }

    public close(): void {
        throw new Error("Not implemented");
    }

    public isOpen(): boolean {
        throw new Error("Not implemented");
    }

    public getActiveInputElement(): HTMLInputElement | null {
        throw new Error("Not implemented");
    }

    public pushSession(yomi: string, okuri: string): HTMLInputElement {
        throw new Error("Not implemented");
    }

    public popSession(): HTMLInputElement | null {
        throw new Error("Not implemented");
    }

    public getDepth(): number {
        throw new Error("Not implemented");
    }

    public getOriginalTarget(): IEditorTarget | null {
        throw new Error("Not implemented");
    }

    public getContainer(): HTMLElement | null {
        throw new Error("Not implemented");
    }
}
