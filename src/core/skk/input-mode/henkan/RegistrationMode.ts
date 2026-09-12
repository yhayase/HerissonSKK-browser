import type { CandidateListOptions, IEditor, IRange } from "../../editor/IEditor";
import { DeleteLeftResult } from "../../editor/IEditor";
import { AbstractInputMode } from "../AbstractInputMode";
import type { IInputMode } from "../IInputMode";
import { AbstractKanaMode } from "../AbstractKanaMode";
import { HiraganaMode } from "../HiraganaMode";
import { KakuteiMode } from "./KakuteiMode";
import { InlineHenkanMode } from "./InlineHenkanMode";
import { MenuHenkanMode } from "./MenuHenkanMode";
import { Candidate } from "../../jisyo/candidate";
import type { IJisyoProvider } from "../../jisyo/IJisyoProvider";
import * as wanakana from "wanakana";
import { ZeneiMode } from "../ZeneiMode";
import { AsciiMode } from "../AsciiMode";

/**
 * Bridge interface for connecting an external text target (e.g. modal input) to the mini-buffer editor
 * while remaining environment-agnostic (pure TypeScript, no DOM).
 */
export interface ITextTarget {
    insertText(text: string): { success: boolean; method: string } | void;
    deleteLeft(): boolean;
    getText(): string;
    getElement?(): any;
}

/**
 * RegistrationMiniBufferEditor implements IEditor to provide an in-memory buffer
 * for composing words inside RegistrationMode.
 * It supports standard kana composition, midashigo (▽), candidate selection (▼),
 * and nested registration without touching the actual DOM document.
 */
export class RegistrationMiniBufferEditor implements IEditor {
    private registrationMode: RegistrationMode;
    private outerEditor: IEditor;

    private buffer: string = "";
    private inMidashigo: boolean = false;
    private midashigoText: string = "";
    private remainingRomaji: string = "";
    private isOkuri: boolean = false;
    private currentCandidate?: Candidate;
    private currentOkuri: string = "";
    private currentSuffix: string = "";
    private candidateList: Candidate[] = [];
    private candidateAlphabetList: string[] = [];
    private candidateListOptions?: CandidateListOptions;
    private target?: ITextTarget;

    constructor(registrationMode: RegistrationMode, outerEditor: IEditor) {
        this.registrationMode = registrationMode;
        this.outerEditor = outerEditor;
    }

    public setTarget(target?: ITextTarget): void {
        this.target = target;
    }

    public getTarget(): ITextTarget | undefined {
        return this.target;
    }

    public getCommittedText(): string {
        if (this.target) {
            return this.target.getText();
        }
        return this.buffer;
    }

    public getMidashigoText(): string {
        return this.midashigoText;
    }

    public isInMidashigo(): boolean {
        return this.inMidashigo;
    }

    public getRemainingRomaji(): string {
        return this.remainingRomaji;
    }

    public isOkuriStateActive(): boolean {
        return this.isOkuri;
    }

    public getCurrentCandidate(): Candidate | undefined {
        return this.currentCandidate;
    }

    public getCurrentOkuri(): string {
        return this.currentOkuri;
    }

    public getCurrentSuffix(): string {
        return this.currentSuffix;
    }

    public getCandidateList(): { candidates: Candidate[]; selectionKeys: string[]; options?: CandidateListOptions } {
        return {
            candidates: this.candidateList,
            ...(this.candidateListOptions ? { options: this.candidateListOptions } : {}),
            selectionKeys: this.candidateAlphabetList
        };
    }

    public getDisplayText(): string {
        let result = this.getCommittedText();
        if (this.currentCandidate) {
            result += `▼${this.currentCandidate.word}${this.currentOkuri}${this.currentSuffix}`;
        } else if (this.inMidashigo) {
            result += `▽${this.midashigoText}${this.isOkuri ? "*" : ""}${this.remainingRomaji}`;
        } else if (this.remainingRomaji) {
            result += this.remainingRomaji;
        }
        return result;
    }

    // --- IEditor Implementation ---

    public getJisyoProvider(): IJisyoProvider {
        return this.outerEditor.getJisyoProvider();
    }

    public setInputMode(mode: IInputMode): void {
        this.registrationMode.setInternalMode(mode);
    }

    public getCurrentInputMode(): IInputMode {
        return this.registrationMode.getInternalMode();
    }

    public async insertOrReplaceSelection(str: string): Promise<boolean> {
        if (this.inMidashigo) {
            if (str.startsWith("▽")) {
                this.midashigoText += str.slice(1);
            } else {
                this.midashigoText += str;
            }
        } else {
            if (this.target) {
                this.target.insertText(str);
            } else {
                this.buffer += str;
            }
        }
        await this.registrationMode.notifyChanged();
        return true;
    }

    public async replaceRange(range: IRange, str: string): Promise<boolean> {
        if (this.target) {
            this.target.insertText(str);
        } else {
            this.buffer += str;
        }
        await this.registrationMode.notifyChanged();
        return true;
    }

    public getTextInRange(range: IRange): string {
        return this.getCommittedText();
    }

    public async deleteLeft(): Promise<DeleteLeftResult> {
        if (this.inMidashigo) {
            if (this.midashigoText.length > 0) {
                this.midashigoText = this.midashigoText.slice(0, -1);
                if (this.midashigoText.length === 0) {
                    await this.clearMidashigo();
                    return DeleteLeftResult.markerDeleted;
                }
                await this.registrationMode.notifyChanged();
                return DeleteLeftResult.otherCharacterDeleted;
            } else {
                await this.clearMidashigo();
                return DeleteLeftResult.markerDeleted;
            }
        }

        if (this.target) {
            const deleted = this.target.deleteLeft();
            await this.registrationMode.notifyChanged();
            return deleted ? DeleteLeftResult.otherCharacterDeleted : DeleteLeftResult.markerNotFoundAndOtherCharacterDeleted;
        }

        if (this.buffer.length > 0) {
            this.buffer = this.buffer.slice(0, -1);
            await this.registrationMode.notifyChanged();
            return DeleteLeftResult.otherCharacterDeleted;
        }

        return DeleteLeftResult.markerDeleted;
    }

    public toggleCharTypeInMidashigoAndFixateMidashigo(): void {
        const midashigo = this.extractMidashigo();
        if (midashigo && this.inMidashigo) {
            const firstChar = midashigo[0] || "";
            let convFunc = (c: string) => c;
            if (wanakana.isHiragana(firstChar)) {
                convFunc = wanakana.toKatakana;
            } else if (wanakana.isKatakana(firstChar)) {
                convFunc = wanakana.toHiragana;
            } else if (" " <= firstChar && firstChar <= "~") {
                convFunc = (t: string) => ZeneiMode.convertToZenkakuEisuu(t);
            }

            const converted = midashigo.split("").map(convFunc).join("");
            this.inMidashigo = false;
            this.midashigoText = "";
            this.remainingRomaji = "";
            this.isOkuri = false;
            this.currentCandidate = undefined;
            this.currentOkuri = "";
            this.currentSuffix = "";
            if (this.target) {
                this.target.insertText(converted);
            } else {
                this.buffer += converted;
            }
            void this.registrationMode.notifyChanged();
        }
    }

    public setMidashigoStartToCurrentPosition(): void {
        this.inMidashigo = true;
        this.midashigoText = "";
        this.remainingRomaji = "";
        this.isOkuri = false;
        void this.registrationMode.notifyChanged();
    }

    public async clearMidashigo(): Promise<boolean> {
        this.inMidashigo = false;
        this.midashigoText = "";
        this.remainingRomaji = "";
        this.isOkuri = false;
        this.currentCandidate = undefined;
        this.currentOkuri = "";
        this.currentSuffix = "";
        await this.registrationMode.notifyChanged();
        return true;
    }

    public extractMidashigo(): string | undefined {
        if (!this.inMidashigo) return undefined;
        return this.midashigoText;
    }

    public calcMidashigoRange(): IRange | undefined {
        return undefined;
    }

    public async fixateMidashigo(): Promise<boolean> {
        if (this.inMidashigo) {
            const text = this.midashigoText;
            await this.clearMidashigo();
            if (this.target) {
                this.target.insertText(text);
            } else {
                this.buffer += text;
            }
            return true;
        }
        return false;
    }

    public async showCandidate(
        candidate: Candidate | undefined,
        okuri: string,
        suffix: string
    ): Promise<boolean | void> {
        this.currentCandidate = candidate;
        this.currentOkuri = okuri || "";
        this.currentSuffix = suffix || "";
        await this.registrationMode.notifyChanged();
        return true;
    }

    public showCandidateList(candidateList: Candidate[], alphabetList: string[], options?: CandidateListOptions): void {
        this.candidateListOptions = options;
        this.candidateList = candidateList;
        this.candidateAlphabetList = alphabetList;
        void this.registrationMode.notifyChanged();
    }

    public scrollCandidateAnnotation(delta: number): void {
        this.outerEditor.scrollCandidateAnnotation?.(delta);
    }

    public hideCandidateList(): void {
        this.candidateListOptions = undefined;
        this.candidateList = [];
        this.candidateAlphabetList = [];
        void this.registrationMode.notifyChanged();
    }

    public async fixateCandidate(candStr: string | undefined): Promise<boolean> {
        const textToInsert =
            candStr ||
            (this.currentCandidate
                ? this.currentCandidate.word + this.currentOkuri + this.currentSuffix
                : "");

        if (!textToInsert) {
            return false;
        }

        this.inMidashigo = false;
        this.midashigoText = "";
        this.remainingRomaji = "";
        this.isOkuri = false;
        this.currentCandidate = undefined;
        this.currentOkuri = "";
        this.currentSuffix = "";
        this.candidateListOptions = undefined;
        this.candidateList = [];
        this.candidateAlphabetList = [];

        if (this.target) {
            this.target.insertText(textToInsert);
        } else {
            this.buffer += textToInsert;
        }
        await this.registrationMode.notifyChanged();
        return true;
    }

    public async clearCandidate(): Promise<boolean> {
        this.currentCandidate = undefined;
        this.currentOkuri = "";
        this.currentSuffix = "";
        await this.registrationMode.notifyChanged();
        return true;
    }

    public showRemainingRomaji(remainingRomaji: string, isOkuri: boolean, offset: number): void {
        this.remainingRomaji = remainingRomaji;
        this.isOkuri = isOkuri;
        void this.registrationMode.notifyChanged();
    }

    public showErrorMessage(message: string): void {
        this.outerEditor.showErrorMessage(message);
    }

    public async openRegistrationEditor(yomi: string, okuri: string): Promise<void> {
        if (this.registrationMode.getDepth() >= MAX_REGISTRATION_DEPTH) {
            this.showErrorMessage("辞書登録の再帰深度制限を超えました");
            return;
        }
        if (typeof this.outerEditor.openRegistrationEditor === "function") {
            await this.outerEditor.openRegistrationEditor(yomi, okuri);
            return;
        }
        // Fallback for standalone mock editors:
        const nestedMode = new RegistrationMode(
            yomi,
            okuri,
            this.outerEditor,
            this.registrationMode,
            this.registrationMode
        );
        this.outerEditor.setInputMode(nestedMode);
        await this.outerEditor.notifyModeInternalStateChanged();
    }

    public async registerMidashigo(): Promise<void> {
        // no-op
    }

    public async notifyModeInternalStateChanged(): Promise<void> {
        await this.registrationMode.notifyChanged();
    }
}

export const MAX_REGISTRATION_DEPTH = 5;

/**
 * RegistrationMode handles inline and recursive dictionary registration.
 * It wraps an internal RegistrationMiniBufferEditor and HiraganaMode, allowing
 * full kana input and kanji conversion inside the registration mini-buffer.
 */
export class RegistrationMode extends AbstractInputMode implements IInputMode {
    private yomi: string;
    private okuri: string;
    private outerEditor: IEditor;
    private previousMode: IInputMode;
    private parentRegistration?: RegistrationMode;

    private miniBufferEditor: RegistrationMiniBufferEditor;
    private internalMode: IInputMode;

    constructor(
        yomi: string,
        okuri: string = "",
        outerEditor: IEditor,
        previousMode?: IInputMode,
        parentRegistration?: RegistrationMode
    ) {
        super(outerEditor);
        this.yomi = yomi;
        this.okuri = okuri;
        this.outerEditor = outerEditor;
        this.previousMode = previousMode ?? outerEditor.getCurrentInputMode();
        this.parentRegistration = parentRegistration;

        this.miniBufferEditor = new RegistrationMiniBufferEditor(this, outerEditor);
        this.internalMode = new HiraganaMode(this.miniBufferEditor);
    }

    public getYomi(): string {
        return this.yomi;
    }

    public getOkuri(): string {
        return this.okuri;
    }

    public isNested(): boolean {
        return this.parentRegistration !== undefined;
    }

    public getDepth(): number {
        let depth = 1;
        let p = this.parentRegistration;
        while (p) {
            depth++;
            p = p.parentRegistration;
        }
        return depth;
    }

    public getParentRegistration(): RegistrationMode | undefined {
        return this.parentRegistration;
    }

    public getPreviousMode(): IInputMode {
        return this.previousMode;
    }

    public getMiniBufferEditor(): RegistrationMiniBufferEditor {
        return this.miniBufferEditor;
    }

    public getInternalMode(): IInputMode {
        return this.internalMode;
    }

    public setInternalMode(mode: IInputMode): void {
        this.internalMode = mode;
    }

    public getPromptHeader(): string {
        if (this.okuri && this.okuri.length > 0) {
            const stem = this.yomi.replace(/[a-z]+$/, "");
            return `[${stem}*${this.okuri}] `;
        }
        return `[${this.yomi}] `;
    }

    public getDisplayText(): string {
        return this.miniBufferEditor.getDisplayText();
    }

    public async notifyChanged(): Promise<void> {
        await this.outerEditor.notifyModeInternalStateChanged();
    }

    public async reset(): Promise<void> {
        await this.internalMode.reset();
        await this.miniBufferEditor.clearMidashigo();
    }

    public override toString(): string {
        return this.isNested() ? "再帰登録" : "辞書登録";
    }

    public async lowerAlphabetInput(key: string): Promise<void> {
        await this.internalMode.lowerAlphabetInput(key);
    }

    public async upperAlphabetInput(key: string): Promise<void> {
        await this.internalMode.upperAlphabetInput(key);
    }

    public async numberInput(key: string): Promise<void> {
        await this.internalMode.numberInput(key);
    }

    public async symbolInput(key: string): Promise<void> {
        await this.internalMode.symbolInput(key);
    }

    public async spaceInput(): Promise<void> {
        await this.internalMode.spaceInput();
    }

    public async enterInput(): Promise<void> {
        // If candidate is active or in midashigo, fixate it first into mini-buffer
        if (this.miniBufferEditor.getCurrentCandidate() !== undefined || this.miniBufferEditor.isInMidashigo()) {
            await this.internalMode.ctrlJInput();
            return;
        }

        // Flush any trailing romaji (e.g. "n" -> "ん")
        if (this.miniBufferEditor.getRemainingRomaji().length > 0) {
            const rem = this.miniBufferEditor.getRemainingRomaji();
            const kana = wanakana.toKana(rem);
            if (this.internalMode instanceof AbstractKanaMode) {
                await this.internalMode.reset();
            }
            if (kana && kana !== rem) {
                await this.miniBufferEditor.insertOrReplaceSelection(kana);
            }
            this.miniBufferEditor.showRemainingRomaji("", false, 0);
        }

        if (this.miniBufferEditor.getCommittedText().length === 0) {
            await this.abortRegistration();
            return;
        }

        await this.confirmRegistration();
    }

    public async abortRegistration(): Promise<void> {
        if (this.parentRegistration) {
            this.outerEditor.setInputMode(this.parentRegistration);
            await this.outerEditor.notifyModeInternalStateChanged();
            return;
        }

        let targetInputMode = this.previousMode;
        let inlineHenkan: InlineHenkanMode | undefined = undefined;
        let menuHenkan: MenuHenkanMode | undefined = undefined;

        if (this.previousMode instanceof AbstractKanaMode) {
            const hm = this.previousMode.getHenkanMode();
            if (hm instanceof InlineHenkanMode) {
                inlineHenkan = hm;
            } else if (hm instanceof MenuHenkanMode) {
                menuHenkan = hm;
            }
        } else if ((this.previousMode as any) instanceof InlineHenkanMode) {
            inlineHenkan = this.previousMode as any;
        } else if ((this.previousMode as any) instanceof MenuHenkanMode) {
            menuHenkan = this.previousMode as any;
        }

        this.outerEditor.setInputMode(targetInputMode);

        if (inlineHenkan && targetInputMode instanceof AbstractKanaMode) {
            await inlineHenkan.showCandidate(targetInputMode);
        } else if (menuHenkan && targetInputMode instanceof AbstractKanaMode) {
            menuHenkan.showCandidateList(targetInputMode);
        }

        await this.outerEditor.notifyModeInternalStateChanged();
    }

    public async ctrlJInput(): Promise<void> {
        // When in AsciiMode, switch back to HiraganaMode inside registration
        if (this.internalMode instanceof AsciiMode || this.internalMode.getContextualName() === "ascii") {
            await this.internalMode.ctrlJInput();
            return;
        }

        // If candidate is active or in midashigo, fixate it into mini-buffer
        if (this.miniBufferEditor.getCurrentCandidate() !== undefined || this.miniBufferEditor.isInMidashigo()) {
            await this.internalMode.ctrlJInput();
            return;
        }

        // Flush any remaining romaji (e.g. "n" -> "ん")
        if (this.miniBufferEditor.getRemainingRomaji().length > 0) {
            const rem = this.miniBufferEditor.getRemainingRomaji();
            const kana = wanakana.toKana(rem);
            if (this.internalMode instanceof AbstractKanaMode) {
                await this.internalMode.reset();
            }
            if (kana && kana !== rem) {
                await this.miniBufferEditor.insertOrReplaceSelection(kana);
            }
            this.miniBufferEditor.showRemainingRomaji("", false, 0);
            return;
        }

        // Else: NO-OP! Do nothing.
    }

    public async backspaceInput(): Promise<void> {
        if (this.miniBufferEditor.getCurrentCandidate() !== undefined) {
            await this.internalMode.backspaceInput();
            return;
        }
        if (this.miniBufferEditor.isInMidashigo()) {
            await this.internalMode.backspaceInput();
            return;
        }
        if (this.miniBufferEditor.getRemainingRomaji().length > 0) {
            await this.internalMode.backspaceInput();
            return;
        }
        if (this.miniBufferEditor.getCommittedText().length > 0) {
            await this.miniBufferEditor.deleteLeft();
            return;
        }
        // Buffer is empty: NO-OP! Do NOT exit or pop registration.
    }

    public async ctrlGInput(): Promise<void> {
        if (
            this.miniBufferEditor.getCurrentCandidate() !== undefined ||
            this.miniBufferEditor.isInMidashigo() ||
            this.miniBufferEditor.getRemainingRomaji().length > 0
        ) {
            await this.internalMode.ctrlGInput();
            return;
        }
        await this.cancelRegistration();
    }

    public async escapeInput(): Promise<void> {
        await this.ctrlGInput();
    }

    public async confirmRegistration(): Promise<void> {
        const word = this.miniBufferEditor.getCommittedText();
        if (word.length === 0) {
            return;
        }

        let stem = word;
        let textToInsert = word;

        if (this.okuri && this.okuri.length > 0) {
            if (word.endsWith(this.okuri)) {
                stem = word.slice(0, -this.okuri.length);
            }
            textToInsert = stem + this.okuri;
        }

        if (stem.length === 0) {
            return;
        }

        const candidate = new Candidate(stem);
        let success = false;
        try {
            success = await this.outerEditor.getJisyoProvider().registerCandidate(this.yomi, candidate);
        } catch {
            success = false;
        }

        if (!success) {
            this.outerEditor.showErrorMessage("辞書登録に失敗しました");
            return;
        }

        if (this.parentRegistration) {
            // Nested: pop stack to parent registration and insert word into parent mini-buffer
            const parentMb = this.parentRegistration.getMiniBufferEditor();
            if (parentMb.isInMidashigo()) {
                await parentMb.clearMidashigo();
            }
            if (this.parentRegistration.getInternalMode() instanceof AbstractKanaMode) {
                const parentKana = this.parentRegistration.getInternalMode() as AbstractKanaMode;
                parentKana.setHenkanMode(KakuteiMode.create(parentKana, parentMb));
            }
            this.outerEditor.setInputMode(this.parentRegistration);
            await parentMb.insertOrReplaceSelection(textToInsert);
            await this.outerEditor.notifyModeInternalStateChanged();
        } else {
            // Root: restore previous mode and commit candidate to outerEditor
            if (this.previousMode instanceof AbstractKanaMode) {
                this.previousMode.setHenkanMode(KakuteiMode.create(this.previousMode, this.outerEditor));
                await this.previousMode.reset();
            }
            this.outerEditor.setInputMode(this.previousMode);
            await this.outerEditor.clearMidashigo();
            await this.outerEditor.clearCandidate();
            await this.outerEditor.insertOrReplaceSelection(textToInsert);
            await this.outerEditor.notifyModeInternalStateChanged();
        }
    }

    public async cancelRegistration(): Promise<void> {
        await this.abortRegistration();
    }

    public override getActiveKeys(): Set<string> {
        const keys = new Set<string>();
        for (let i = 32; i <= 126; i++) {
            const char = String.fromCharCode(i);
            if ("a" <= char && char <= "z") {
                keys.add(char);
                keys.add("shift+" + char);
            } else if ("A" <= char && char <= "Z") {
                // Shift already handled
            } else {
                keys.add(char);
            }
        }
        keys.add("enter");
        keys.add("backspace");
        keys.add("ctrl+j");
        keys.add("ctrl+g");
        keys.add("escape");
        return keys;
    }

    public getContextualName(): string {
        return this.isNested() ? "registration:nested" : "registration";
    }
}
