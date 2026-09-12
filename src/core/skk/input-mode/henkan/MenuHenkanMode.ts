import { AbstractHenkanMode } from "./AbstractHenkanMode";
import type { AbstractKanaMode } from "../AbstractKanaMode";
import { KakuteiMode } from "./KakuteiMode";
import type { InlineHenkanMode } from "./InlineHenkanMode";
import type { IEditor } from "../../editor/IEditor";
import type { Entry } from "../../jisyo/entry";

export class MenuHenkanMode extends AbstractHenkanMode {
    private readonly prevMode: InlineHenkanMode;
    private readonly jisyoEntry: Entry;
    private candidateIndex: number;
    private readonly okuri: string;
    private readonly suffix: string;
    private pageCapacity = 7;
    private readonly pageStarts: number[] = [];
    private annotationMode: 'normal' | 'choose' | 'detail' = 'normal';
    private detailIndex?: number;
    private visible = true;

    private readonly selectionKeys = ['a', 's', 'd', 'f', 'j', 'k', 'l'];

    constructor(context: AbstractKanaMode, editor: IEditor, prevMode: InlineHenkanMode, jisyoEntry: Entry,
        candidateIndex: number, okuri: string, suffix: string) {
        super("Select", editor);
        this.prevMode = prevMode;
        this.jisyoEntry = jisyoEntry;
        this.candidateIndex = candidateIndex;
        this.okuri = okuri;
        this.suffix = suffix;

        this.editor.showCandidate(undefined, this.okuri, this.suffix);
        this.showCandidateList(context);
    }

    get nDisplayCandidates(): number { return this.pageCapacity; }

    showCandidateList(context: AbstractKanaMode): void {
        this.visible = true;
        const candidates = this.jisyoEntry.getCandidateList().slice(this.candidateIndex, this.candidateIndex + this.pageCapacity);
        this.editor.showCandidateList(
            candidates as any,
            this.selectionKeys.slice(0, candidates.length).map((s) => s.toUpperCase()), {
                okuri: this.okuri,
                suffix: this.suffix,
                pageCapacity: this.pageCapacity,
                annotationMode: this.annotationMode,
                detailIndex: this.detailIndex,
                onCapacityChange: (capacity) => {
                    if (!this.visible || !Number.isFinite(capacity)) return;
                    const next = Math.max(1, Math.min(7, Math.floor(capacity)));
                    if (next === this.pageCapacity) return;
                    this.pageCapacity = next;
                    if (this.detailIndex !== undefined && this.detailIndex >= next) {
                        this.annotationMode = 'choose';
                        this.detailIndex = undefined;
                    }
                    this.showCandidateList(context);
                },
                onSpecialKey: (key) => {
                    if (!this.visible || this.annotationMode === 'normal') return false;
                    if (key === 'Escape') {
                        this.annotationMode = 'normal';
                        this.detailIndex = undefined;
                        this.showCandidateList(context);
                        return true;
                    }
                    if (key.startsWith('Arrow')) {
                        if (this.annotationMode === 'detail') {
                            this.editor.scrollCandidateAnnotation?.(key === 'ArrowUp' || key === 'ArrowLeft' ? -48 : 48);
                        }
                        return true;
                    }
                    return false;
                },
            });
    }

    hideCandidateList(context: AbstractKanaMode): void {
        this.visible = false;
        this.editor.hideCandidateList();
    }

    async selectCandidateFromMenu(context: AbstractKanaMode, selectionKeys: string[], key: string): Promise<void> {
        if (selectionKeys.includes(key)) {
            const idx = selectionKeys.indexOf(key);
            if (idx >= this.nDisplayCandidates) {
                context.showErrorMessage("Out of range");
                return;
            }

            const selectedCandidateIdx = this.candidateIndex + idx;
            if (selectedCandidateIdx >= this.jisyoEntry.getCandidateList().length) {
                context.showErrorMessage("Out of range");
                return;
            }

            if (this.annotationMode !== 'normal') {
                this.annotationMode = 'detail';
                this.detailIndex = idx;
                this.showCandidateList(context);
                return;
            }

            this.hideCandidateList(context);
            await this.fixateAndGoKakuteiMode(context, selectedCandidateIdx);
            return;
        }
        context.showErrorMessage(`'${key}' is not valid here!`);
        return;
    }

    async scrollBackCandidatePage(context: AbstractKanaMode): Promise<void> {
        this.annotationMode = 'normal';
        this.detailIndex = undefined;
        const previousStart = this.pageStarts.pop();
        if (previousStart === undefined) {
            await this.returnToInlineHenkanMode(context);
            return;
        }
        this.candidateIndex = previousStart;

        this.showCandidateList(context);
        this.editor.notifyModeInternalStateChanged(); // Notify about candidate index change
    }

    async onLowerAlphabet(context: AbstractKanaMode, key: string): Promise<void> {
        if (key === 'x') {
            await this.scrollBackCandidatePage(context);
            return;
        }

        await this.selectCandidateFromMenu(context, this.selectionKeys, key);
    }

    private async returnToInlineHenkanMode(context: AbstractKanaMode): Promise<void> {
        this.hideCandidateList(context);
        context.setHenkanMode(this.prevMode);
        await this.prevMode.showCandidate(context);
    }

    async onUpperAlphabet(context: AbstractKanaMode, key: string): Promise<void> {
        await this.selectCandidateFromMenu(context, this.selectionKeys.map((s) => s.toUpperCase()), key);
    }

    async onNumber(context: AbstractKanaMode, key: string): Promise<void> {
        context.showErrorMessage(`'${key}' is not valid here!`);
    }

    async onSymbol(context: AbstractKanaMode, key: string): Promise<void> {
        if (key === '?') {
            this.annotationMode = 'choose';
            this.detailIndex = undefined;
            this.showCandidateList(context);
            return;
        }
        if (key === '.') {
            await this.editor.openRegistrationEditor(this.prevMode.getMidashigo(), this.okuri);
            return;
        }
        context.showErrorMessage(`'${key}' is not valid here!`);
    }

    async onSpace(context: AbstractKanaMode): Promise<void> {
        this.annotationMode = 'normal';
        this.detailIndex = undefined;
        if (this.candidateIndex + this.nDisplayCandidates >= this.jisyoEntry.getCandidateList().length) {
            await this.editor.openRegistrationEditor(this.prevMode.getMidashigo(), this.okuri);
            return;
        }

        this.pageStarts.push(this.candidateIndex);
        this.candidateIndex += this.nDisplayCandidates;
        this.showCandidateList(context);
    }

    async onEnter(context: AbstractKanaMode): Promise<void> {
        context.showErrorMessage("Enter is not valid here!");
    }

    async onBackspace(context: AbstractKanaMode): Promise<void> {
        await this.scrollBackCandidatePage(context);
    }

    async onCtrlJ(context: AbstractKanaMode): Promise<void> {
        context.showErrorMessage("C-j is not valid here!");
    }

    private async fixateAndGoKakuteiMode(context: AbstractKanaMode, index: number): Promise<boolean> {
        this.jisyoEntry.onCandidateSelected(this.editor.getJisyoProvider(), index);
        context.setHenkanMode(KakuteiMode.create(context, this.editor));
        const candidate = this.jisyoEntry.getCandidateList()[index];
        const candWord = candidate ? candidate.word : "";
        return await this.editor.fixateCandidate(candWord + this.okuri + this.suffix);
    }

    async onCtrlG(context: AbstractKanaMode): Promise<void> {
        this.hideCandidateList(context);
        await this.prevMode.returnToMidashigoMode(context);
    }

    public override getActiveKeys(): Set<string> {
        const keys = new Set<string>();

        // this mode deals with all printable ASCII characters
        for (let i = 32; i <= 126; i++) { // ASCII printable characters
            const char = String.fromCharCode(i);
            if ("a" <= char && char <= "z") {
                keys.add(char);
                keys.add("shift+" + char);
            } else if ("A" <= char && char <= "Z") {
                // Uppercase letters are already added by the above case
            } else {
                keys.add(char);
            }
        }

        // Special keys
        keys.add("enter");
        keys.add("backspace");
        keys.add("ctrl+j");
        keys.add("ctrl+g");
        if (this.annotationMode !== 'normal') {
            keys.add('escape');
            for (const key of ['arrowup', 'arrowdown', 'arrowleft', 'arrowright']) keys.add(key);
        }

        return keys;
    }

    public override getContextualName(): string {
        return "menuHenkan";
    }
}
