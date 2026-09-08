import * as wanakana from "wanakana";
import { DeleteLeftResult, type IEditor, type IPosition, type IRange } from "../../../src/core/skk/editor/IEditor";
import type { IJisyoProvider } from "../../../src/core/skk/jisyo/IJisyoProvider";
import { Candidate } from "../../../src/core/skk/jisyo/candidate";
import { Entry } from "../../../src/core/skk/jisyo/entry";
import type { IInputMode } from "../../../src/core/skk/input-mode/IInputMode";
import { EditorFactory } from "../../../src/core/skk/editor/EditorFactory";
import { HiraganaMode } from "../../../src/core/skk/input-mode/HiraganaMode";
import { ZeneiMode } from "../../../src/core/skk/input-mode/ZeneiMode";

function indexOfPositionInString(str: string, pos: IPosition): number {
    const lines = str.split("\n");
    let index = 0;
    for (let i = 0; i < pos.line; i++) {
        if (i < lines.length) {
            index += (lines[i]?.length ?? 0) + 1; // +1 for '\n'
        }
    }
    index += pos.character;
    return Math.min(index, str.length);
}

function positionFromIndex(str: string, index: number): IPosition {
    const textBefore = str.slice(0, index);
    const lines = textBefore.split("\n");
    const line = lines.length - 1;
    const character = lines[line]?.length ?? 0;
    return { line, character };
}

export class MockJisyoProvider implements IJisyoProvider {
    private dictionary: Map<string, Candidate[]> = new Map();

    async lookupCandidates(key: string): Promise<Entry | undefined> {
        const candidates = this.dictionary.get(key);
        if (!candidates || candidates.length === 0) {
            return undefined;
        }
        return new Entry(key, [...candidates], "");
    }

    async registerCandidate(key: string, candidate: Candidate): Promise<boolean> {
        if (!this.dictionary.has(key)) {
            this.dictionary.set(key, [candidate]);
        } else {
            const candidates = this.dictionary.get(key)!;
            if (!candidates.some((c) => c.word === candidate.word)) {
                candidates.unshift(candidate);
            }
        }
        return true;
    }

    async reorderCandidate(key: string, target: Candidate | string | number): Promise<boolean> {
        const candidates = this.dictionary.get(key);
        if (!candidates || candidates.length === 0) {
            return false;
        }
        let index = -1;
        if (typeof target === "number") {
            if (target >= 0 && target < candidates.length) {
                index = target;
            }
        } else {
            const targetWord = typeof target === "string" ? target : target.word;
            index = candidates.findIndex((c) => c.word === targetWord);
        }
        if (index === -1) {
            return false;
        }
        const selected = candidates.splice(index, 1)[0];
        if (selected) {
            candidates.unshift(selected);
        }
        return true;
    }

    async deleteCandidate(key: string, candidate: Candidate): Promise<boolean> {
        const candidates = this.dictionary.get(key);
        if (!candidates) {
            return false;
        }
        const index = candidates.findIndex((c) => c.word === candidate.word);
        if (index === -1) {
            return false;
        }
        candidates.splice(index, 1);
        if (candidates.length === 0) {
            this.dictionary.delete(key);
        }
        return true;
    }
}

export class MockEditor implements IEditor {
    private insertedText: string = "";
    private currentInputMode: IInputMode;
    private midashigoText: string = "";
    private currentCandidate?: Candidate;
    private candidateList: { candidates: Candidate[]; selectionKeys: string[] } = { candidates: [], selectionKeys: [] };
    private wasDeleteLeftInvoked: boolean = false;
    private remainingRomaji: string = "";
    private isOkuriState: boolean = false;
    private fixatedCandidate: string = "";
    private wasRegistrationEditorOpened_: boolean = false;
    private lastErrorMessage: string = "";
    private currentText: string = "";
    private cursorPosition: IPosition = { line: 0, character: 0 };
    private midashigoStartPosition: IPosition | null = null;
    private appendedSuffix: string = "";
    private jisyoProvider: IJisyoProvider;
    private registrationYomi: string | undefined = undefined;
    private registrationOkuri: string | undefined = undefined;

    constructor() {
        EditorFactory.setInstance(this);
        this.jisyoProvider = new MockJisyoProvider();
        this.currentInputMode = new HiraganaMode();
    }

    getInsertedText(): string {
        return this.insertedText;
    }

    getCurrentInputMode(): IInputMode {
        return this.currentInputMode;
    }

    getMidashigo(): string {
        return this.midashigoText;
    }

    getCurrentCandidate(): Candidate | undefined {
        return this.currentCandidate;
    }

    getCandidateList(): { candidates: Candidate[]; selectionKeys: string[] } {
        return this.candidateList;
    }

    getAppendedSuffix(): string {
        return this.appendedSuffix;
    }

    wasDeleteLeftCalled(): boolean {
        return this.wasDeleteLeftInvoked;
    }

    getRemainingRomaji(): string {
        return this.remainingRomaji;
    }

    isOkuriStateActive(): boolean {
        return this.isOkuriState;
    }

    getFixatedCandidate(): string {
        return this.fixatedCandidate;
    }

    wasRegistrationEditorOpened(): boolean {
        return this.wasRegistrationEditorOpened_;
    }

    getRegistrationYomi(): string | undefined {
        return this.registrationYomi;
    }

    getRegistrationOkuri(): string | undefined {
        return this.registrationOkuri;
    }

    getLastErrorMessage(): string {
        return this.lastErrorMessage;
    }

    getCursorPosition(): IPosition {
        return this.cursorPosition;
    }

    getCurrentText(): string {
        return this.currentText;
    }

    setCurrentText(text: string): void {
        this.currentText = text;
        this.cursorPosition = positionFromIndex(text, text.length);
    }

    setCursorPosition(pos: IPosition): void {
        this.cursorPosition = pos;
    }

    resetInsertedText(): void {
        this.insertedText = "";
    }

    // IEditor implementation
    getJisyoProvider(): IJisyoProvider {
        return this.jisyoProvider;
    }

    setInputMode(mode: IInputMode): void {
        this.currentInputMode = mode;
    }

    async insertOrReplaceSelection(str: string): Promise<boolean> {
        this.insertedText = str;
        const cursorIdx = indexOfPositionInString(this.currentText, this.cursorPosition);
        this.currentText = this.currentText.slice(0, cursorIdx) + str + this.currentText.slice(cursorIdx);
        this.cursorPosition = positionFromIndex(this.currentText, cursorIdx + str.length);

        if (this.midashigoStartPosition) {
            const startIdx = indexOfPositionInString(this.currentText, this.midashigoStartPosition);
            const endIdx = indexOfPositionInString(this.currentText, this.cursorPosition);
            const text = this.currentText.slice(startIdx, endIdx);
            if (text.startsWith("▽")) {
                this.midashigoText = text.slice(1);
            }
        }
        return true;
    }

    async replaceRange(range: IRange, str: string): Promise<boolean> {
        this.insertedText = str;
        const startIdx = indexOfPositionInString(this.currentText, range.start);
        const endIdx = indexOfPositionInString(this.currentText, range.end);
        this.currentText = this.currentText.slice(0, startIdx) + str + this.currentText.slice(endIdx);
        this.cursorPosition = positionFromIndex(this.currentText, startIdx + str.length);
        return true;
    }

    getTextInRange(range: IRange): string {
        const startIdx = indexOfPositionInString(this.currentText, range.start);
        const endIdx = indexOfPositionInString(this.currentText, range.end);
        return this.currentText.slice(startIdx, endIdx);
    }

    async deleteLeft(): Promise<DeleteLeftResult> {
        this.wasDeleteLeftInvoked = true;
        const cursorIdx = indexOfPositionInString(this.currentText, this.cursorPosition);
        if (cursorIdx === 0) {
            return DeleteLeftResult.otherCharacterDeleted;
        }

        let rval = DeleteLeftResult.otherCharacterDeleted;
        if (this.midashigoStartPosition !== null) {
            const markerIdx = indexOfPositionInString(this.currentText, this.midashigoStartPosition);
            if (markerIdx === cursorIdx - 1) {
                const charToDelete = this.currentText.charAt(cursorIdx - 1);
                if (charToDelete === "▽") {
                    rval = DeleteLeftResult.markerDeleted;
                    this.midashigoStartPosition = null;
                    this.midashigoText = "";
                    this.currentCandidate = undefined;
                } else {
                    rval = DeleteLeftResult.markerNotFoundAndOtherCharacterDeleted;
                    this.midashigoStartPosition = null;
                    this.midashigoText = "";
                }
            }
        }

        this.currentText = this.currentText.slice(0, cursorIdx - 1) + this.currentText.slice(cursorIdx);
        this.cursorPosition = positionFromIndex(this.currentText, cursorIdx - 1);

        if (this.midashigoStartPosition !== null) {
            const startIdx = indexOfPositionInString(this.currentText, this.midashigoStartPosition);
            const endIdx = indexOfPositionInString(this.currentText, this.cursorPosition);
            const text = this.currentText.slice(startIdx, endIdx);
            if (text.startsWith("▽")) {
                this.midashigoText = text.slice(1);
            }
        }

        return rval;
    }

    toggleCharTypeInMidashigoAndFixateMidashigo(): void {
        const midashigo = this.extractMidashigo();
        if (midashigo && this.midashigoStartPosition) {
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
            const startIdx = indexOfPositionInString(this.currentText, this.midashigoStartPosition);
            const endIdx = indexOfPositionInString(this.currentText, this.cursorPosition);
            this.currentText = this.currentText.slice(0, startIdx) + converted + this.currentText.slice(endIdx);
            this.cursorPosition = positionFromIndex(this.currentText, startIdx + converted.length);
            this.midashigoStartPosition = null;
            this.midashigoText = "";
            this.currentCandidate = undefined;
        }
    }

    setMidashigoStartToCurrentPosition(): void {
        this.midashigoStartPosition = { ...this.cursorPosition };
    }

    async clearMidashigo(): Promise<boolean> {
        if (this.midashigoStartPosition) {
            const startIdx = indexOfPositionInString(this.currentText, this.midashigoStartPosition);
            const endIdx = indexOfPositionInString(this.currentText, this.cursorPosition);
            this.currentText = this.currentText.slice(0, startIdx) + this.currentText.slice(endIdx);
            this.cursorPosition = { ...this.midashigoStartPosition };
            this.midashigoStartPosition = null;
            this.midashigoText = "";
            this.currentCandidate = undefined;
            this.remainingRomaji = "";
            this.isOkuriState = false;
        }
        return true;
    }

    extractMidashigo(): string | undefined {
        if (!this.midashigoStartPosition) {
            return undefined;
        }
        const startIdx = indexOfPositionInString(this.currentText, this.midashigoStartPosition);
        const endIdx = indexOfPositionInString(this.currentText, this.cursorPosition);
        const text = this.currentText.slice(startIdx, endIdx);
        if (text.startsWith("▽")) {
            return text.slice(1);
        }
        return undefined;
    }

    calcMidashigoRange(): IRange | undefined {
        if (!this.midashigoStartPosition) {
            return undefined;
        }
        return {
            start: this.midashigoStartPosition,
            end: this.cursorPosition
        };
    }

    async fixateMidashigo(): Promise<boolean> {
        const midashigo = this.extractMidashigo();
        if (midashigo !== undefined && this.midashigoStartPosition) {
            const startIdx = indexOfPositionInString(this.currentText, this.midashigoStartPosition);
            const endIdx = indexOfPositionInString(this.currentText, this.cursorPosition);
            this.currentText = this.currentText.slice(0, startIdx) + midashigo + this.currentText.slice(endIdx);
            this.cursorPosition = positionFromIndex(this.currentText, startIdx + midashigo.length);
            this.midashigoStartPosition = null;
            this.midashigoText = "";
            return true;
        }
        return false;
    }

    async showCandidate(candidate: Candidate | undefined, okuri: string, suffix: string): Promise<boolean | void> {
        this.currentCandidate = candidate;
        this.appendedSuffix = suffix || okuri;
        if (candidate && this.midashigoStartPosition) {
            const startIdx = indexOfPositionInString(this.currentText, this.midashigoStartPosition);
            const endIdx = indexOfPositionInString(this.currentText, this.cursorPosition);
            const text = "▼" + candidate.word;
            this.currentText = this.currentText.slice(0, startIdx) + text + this.currentText.slice(endIdx);
            this.cursorPosition = positionFromIndex(this.currentText, startIdx + text.length);
        }
        return true;
    }

    showCandidateList(candidateList: Candidate[], alphabetList: string[]): void {
        this.candidateList = {
            candidates: candidateList,
            selectionKeys: alphabetList
        };
    }

    hideCandidateList(): void {
        this.candidateList = { candidates: [], selectionKeys: [] };
    }

    async fixateCandidate(candStr: string | undefined): Promise<boolean> {
        if (this.midashigoStartPosition) {
            const startIdx = indexOfPositionInString(this.currentText, this.midashigoStartPosition);
            const endIdx = indexOfPositionInString(this.currentText, this.cursorPosition);
            if (this.currentText.charAt(startIdx) !== "▼") {
                return false;
            }
            this.fixatedCandidate = candStr || this.currentText.slice(startIdx + 1, endIdx);
            this.currentText = this.currentText.slice(0, startIdx) + this.fixatedCandidate + this.currentText.slice(endIdx);
            this.cursorPosition = positionFromIndex(this.currentText, startIdx + this.fixatedCandidate.length);
            this.midashigoStartPosition = null;
            this.midashigoText = "";
            this.currentCandidate = undefined;
            this.appendedSuffix = "";
            this.remainingRomaji = "";
            return true;
        }
        return false;
    }

    async clearCandidate(): Promise<boolean> {
        if (this.midashigoStartPosition) {
            const startIdx = indexOfPositionInString(this.currentText, this.midashigoStartPosition);
            const endIdx = indexOfPositionInString(this.currentText, this.cursorPosition);
            this.currentText = this.currentText.slice(0, startIdx) + this.currentText.slice(endIdx);
            this.cursorPosition = { ...this.midashigoStartPosition };
        }
        this.midashigoStartPosition = null;
        this.midashigoText = "";
        this.currentCandidate = undefined;
        this.appendedSuffix = "";
        return true;
    }

    showRemainingRomaji(remainingRomaji: string, isOkuri: boolean, offset: number): void {
        this.remainingRomaji = remainingRomaji;
        this.isOkuriState = isOkuri;
    }

    showErrorMessage(message: string): void {
        this.lastErrorMessage = message;
    }

    async openRegistrationEditor(yomi: string, okuri: string): Promise<void> {
        this.wasRegistrationEditorOpened_ = true;
        this.registrationYomi = yomi;
        this.registrationOkuri = okuri;
    }

    async registerMidashigo(): Promise<void> {}

    async notifyModeInternalStateChanged(): Promise<void> {}
}
