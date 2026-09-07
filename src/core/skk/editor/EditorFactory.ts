import type { IEditor } from "./IEditor";

export type EditorCreator = () => IEditor;

export class EditorFactory {
    private static instance: EditorFactory;
    private editorCreator: EditorCreator;

    private constructor(editorCreator: EditorCreator) {
        this.editorCreator = editorCreator;
    }

    public static initialize(editorCreator: EditorCreator): void {
        if (!EditorFactory.instance) {
            EditorFactory.instance = new EditorFactory(editorCreator);
        }
    }

    public static getInstance(): EditorFactory {
        if (!EditorFactory.instance) {
            throw new Error("EditorFactory is not initialized. Call initialize() first.");
        }
        return EditorFactory.instance;
    }

    public getEditor(): IEditor {
        return this.editorCreator();
    }

    // Method to change editor creator for tests
    public static resetForTest(editorCreator: EditorCreator): void {
        EditorFactory.instance = new EditorFactory(editorCreator);
    }

    private static originalInstance: EditorFactory;
    // Method to set instance directly for tests
    public static setInstance(editor: IEditor): void {
        this.originalInstance = this.instance;
        EditorFactory.instance = new EditorFactory(() => editor);
    }

    // Cleanup for tests
    public static reset(): void {
        EditorFactory.instance = this.originalInstance;
    }
}
