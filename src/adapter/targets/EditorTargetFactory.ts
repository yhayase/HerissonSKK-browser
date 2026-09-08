import type { IEditorTarget } from "./IEditorTarget";
import { InputElementTarget } from "./InputElementTarget";
import { ContentEditableTarget } from "./ContentEditableTarget";

export function createEditorTarget(el: Element | null): IEditorTarget | null {
    if (!el) {
        return null;
    }

    const tagName = el.tagName ? el.tagName.toUpperCase() : "";
    if (tagName === "INPUT" || tagName === "TEXTAREA") {
        return new InputElementTarget(el as HTMLInputElement | HTMLTextAreaElement);
    }

    if (
        (el as any).isContentEditable ||
        (typeof el.getAttribute === "function" && el.getAttribute("contenteditable") === "true")
    ) {
        return new ContentEditableTarget(el as HTMLElement);
    }

    return null;
}
