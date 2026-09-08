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
