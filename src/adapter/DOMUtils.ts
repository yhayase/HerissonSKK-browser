import { isInputElement, isTextAreaElement } from "./TextInserter";

/**
 * Recursively traverses activeElement across Shadow DOM boundaries.
 */
export function getDeepActiveElement(doc: Document | ShadowRoot | null = (typeof document !== "undefined" ? document : null)): Element | null {
    if (!doc) {
        return null;
    }

    let active: Element | null = (doc as any).activeElement ?? null;
    while (active) {
        const shadow: ShadowRoot | undefined = (active as any).shadowRoot;
        if (shadow && (shadow as any).activeElement) {
            active = (shadow as any).activeElement;
        } else if ((active as any).activeElement) {
            active = (active as any).activeElement;
        } else {
            break;
        }
    }

    return active;
}

/**
 * Checks whether an element is an editable text target.
 */
export function isTargetEditable(el: unknown): boolean {
    if (!el || typeof el !== "object") {
        return false;
    }

    if (isInputElement(el)) {
        if ((el as HTMLInputElement).readOnly || (el as HTMLInputElement).disabled) {
            return false;
        }
        const nonTextTypes = [
            "button",
            "checkbox",
            "color",
            "file",
            "hidden",
            "image",
            "radio",
            "range",
            "reset",
            "submit",
        ];
        return !nonTextTypes.includes(((el as HTMLInputElement).type || "text").toLowerCase());
    }

    if (isTextAreaElement(el)) {
        if ((el as HTMLTextAreaElement).readOnly || (el as HTMLTextAreaElement).disabled) {
            return false;
        }
        return true;
    }

    if ((el as HTMLElement).isContentEditable) {
        return true;
    }

    if (typeof (el as Element).closest === "function" && (el as Element).closest(".monaco-editor")) {
        return true;
    }

    return false;
}
