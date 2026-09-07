import type { IEditor, IRange } from "../../editor/IEditor";
import { DeleteLeftResult } from "../../editor/IEditor";
import { AbstractInputMode } from "../AbstractInputMode";
import type { IInputMode } from "../IInputMode";
import { AbstractKanaMode } from "../AbstractKanaMode";
import { HiraganaMode } from "../HiraganaMode";
import { KakuteiMode } from "./KakuteiMode";
import { Candidate } from "../../jisyo/candidate";
import type { IJisyoProvider } from "../../jisyo/IJisyoProvider";
import * as wanakana from "wanakana";
import { ZeneiMode } from "../ZeneiMode";

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

    constructor(registrationMode: RegistrationMode, outerEditor: IEditor) {
        this.registrationMode = registrationMode;
        this.outerEditor = outerEditor;
    }

    public getCommittedText(): string {
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

    public getCandidateList(): { candidates: Candidate[]; selectionKeys: string[] } {
        return {
            candidates: this.candidateList,
            selectionKeys: this.candidateAlphabetList
        };
    }

    public getDisplayText(): string {
        let result = this.buffer;
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
            this.buffer += str;
        }
        await this.registrationMode.notifyChanged();
        return true;
    }

    public async replaceRange(range: IRange, str: string): Promise<boolean> {
        this.buffer += str;
        await this.registrationMode.notifyChanged();
        return true;
    }

    public getTextInRange(range: IRange): string {
        return this.buffer;
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
            this.buffer += converted;
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
            this.buffer += this.midashigoText;
            await this.clearMidashigo();
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

    public showCandidateList(candidateList: Candidate[], alphabetList: string[]): void {
        this.candidateList = candidateList;
        this.candidateAlphabetList = alphabetList;
        void this.registrationMode.notifyChanged();
    }

    public hideCandidateList(): void {
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

        this.buffer += textToInsert;
        this.inMidashigo = false;
        this.midashigoText = "";
        this.remainingRomaji = "";
        this.isOkuri = false;
        this.currentCandidate = undefined;
        this.currentOkuri = "";
        this.currentSuffix = "";
        this.candidateList = [];
        this.candidateAlphabetList = [];
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
        // Recursive registration: push nested registration mode onto stack
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
            return `[${this.yomi}*${this.okuri}] `;
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
        await this.handleConfirmOrForward();
    }

    public async ctrlJInput(): Promise<void> {
        await this.handleConfirmOrForward();
    }

    private async handleConfirmOrForward(): Promise<void> {
        // If candidate is active or in midashigo, fixate it first into mini-buffer
        if (this.miniBufferEditor.getCurrentCandidate() !== undefined || this.miniBufferEditor.isInMidashigo()) {
            await this.internalMode.ctrlJInput();
            return;
        }

        // Flush any remaining romaji (e.g. "n" -> "ん")
        if (this.miniBufferEditor.getRemainingRomaji().length > 0) {
            const rem = this.miniBufferEditor.getRemainingRomaji();
            const kana = wanakana.toKana(rem);
            if (kana && kana !== rem) {
                await this.miniBufferEditor.insertOrReplaceSelection(kana);
            }
            this.miniBufferEditor.showRemainingRomaji("", false, 0);
        }

        // Confirm registration
        await this.confirmRegistration();
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
        // Buffer is empty: cancel registration!
        await this.cancelRegistration();
    }

    public async ctrlGInput(): Promise<void> {
        if (this.miniBufferEditor.getCurrentCandidate() !== undefined || this.miniBufferEditor.isInMidashigo()) {
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
        await this.outerEditor.getJisyoProvider().registerCandidate(this.yomi, candidate);

        if (this.parentRegistration) {
            // Nested: pop stack to parent registration and insert word into parent mini-buffer
            this.outerEditor.setInputMode(this.parentRegistration);
            await this.parentRegistration.getMiniBufferEditor().insertOrReplaceSelection(textToInsert);
            await this.outerEditor.notifyModeInternalStateChanged();
        } else {
            // Root: restore previous mode and commit candidate to outerEditor
            if (this.previousMode instanceof AbstractKanaMode) {
                this.previousMode.setHenkanMode(KakuteiMode.create(this.previousMode, this.outerEditor));
                await this.previousMode.reset();
            }
            this.outerEditor.setInputMode(this.previousMode);
            await this.outerEditor.insertOrReplaceSelection(textToInsert);
            await this.outerEditor.notifyModeInternalStateChanged();
        }
    }

    public async cancelRegistration(): Promise<void> {
        if (this.parentRegistration) {
            // Nested: pop stack without inserting
            this.outerEditor.setInputMode(this.parentRegistration);
            await this.outerEditor.notifyModeInternalStateChanged();
        } else {
            // Root: restore previous mode without inserting
            if (this.previousMode instanceof AbstractKanaMode) {
                this.previousMode.setHenkanMode(KakuteiMode.create(this.previousMode, this.outerEditor));
                await this.previousMode.reset();
            }
            this.outerEditor.setInputMode(this.previousMode);
            await this.outerEditor.clearMidashigo();
            await this.outerEditor.clearCandidate();
            await this.outerEditor.notifyModeInternalStateChanged();
        }
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
