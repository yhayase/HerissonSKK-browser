/**
 * Cursor and selection state snapshot for safe restoration.
 */
export interface IEditorSelectionSnapshot {
    /** Whether the snapshot target is still valid and connected to DOM */
    isValid(): boolean;
    /** Restores the saved selection/caret. Returns true if successful. */
    restore(): boolean;
}

/**
 * Common abstraction for various editable elements (input, textarea, contenteditable, monaco).
 */
export interface IEditorTarget {
    /** Whether the underlying element is currently connected to DOM and valid */
    isValid(): boolean;
    /** Returns the underlying DOM element */
    getElement(): HTMLElement;
    /** Takes a snapshot of current cursor/selection state */
    saveSelection(): IEditorSelectionSnapshot;
    /** Focuses the element. Returns true if successful. */
    focus(): boolean;
    /** Inserts text, replacing any current selection. */
    insertText(text: string): { success: boolean; method: string };
    /** Deletes 1 character immediately to the left of the caret. Returns true if deleted. */
    deleteLeft(): boolean;
    /** Returns the full committed text of the element */
    getText(): string;
}
