import * as wanakana from "wanakana";
import type { IEditor, IPosition, IRange } from "../core/skk/editor/IEditor";
import { DeleteLeftResult } from "../core/skk/editor/IEditor";
import { EditorFactory } from "../core/skk/editor/EditorFactory";
import type { IJisyoProvider } from "../core/skk/jisyo/IJisyoProvider";
import { SimpleMemoryJisyoProvider } from "../core/skk/jisyo/SimpleMemoryJisyoProvider";
import { Candidate } from "../core/skk/jisyo/candidate";
import type { IInputMode } from "../core/skk/input-mode/IInputMode";
import { HiraganaMode } from "../core/skk/input-mode/HiraganaMode";
import { KatakanaMode } from "../core/skk/input-mode/KatakanaMode";
import { ZeneiMode } from "../core/skk/input-mode/ZeneiMode";
import { AsciiMode } from "../core/skk/input-mode/AsciiMode";
import { RegistrationMode, MAX_REGISTRATION_DEPTH } from "../core/skk/input-mode/henkan/RegistrationMode";
import { FloatingHUD } from "../hud/FloatingHUD";
import { RegistrationModal } from "../hud/RegistrationModal";
import type { IEditorTarget, IEditorSelectionSnapshot } from "./targets/IEditorTarget";
import { createEditorTarget } from "./targets/EditorTargetFactory";
import { InputElementTarget } from "./targets/InputElementTarget";
import { getActiveCaretCoordinates } from "./CaretPosition";
import { insertText, isInputElement, isTextAreaElement, isSelectableInput } from "./TextInserter";

export type TargetElementSupplier = Element | (() => Element | null) | null;

/**
 * BrowserEditorAdapter implements IEditor to bridge the SKK state machine
 * with browser DOM inputs, FloatingHUD, and TextInserter.
 *
 * Architectural principles:
 * - In-memory preedit: Midashigo (▽), candidate (▼), and pending romaji
 *   remain in memory and are presented only via FloatingHUD.
 * - No DOM churn: Intermediate uncommitted text is never written into the DOM,
 *   preventing form validation triggers, React state desync, and undo history pollution.
 * - Atomic commit: Only finalized text (fixateCandidate or direct input in KakuteiMode)
 *   is dispatched to the active DOM element using synthetic insertText.
 */
export class BrowserEditorAdapter implements IEditor {
    private hud: FloatingHUD;
    private jisyoProvider: IJisyoProvider;
    private targetSupplier?: TargetElementSupplier;
    private currentInputMode: IInputMode;

    // In-memory SKK preedit and conversion state
    private inMidashigo: boolean = false;
    private midashigoText: string = "";
    private remainingRomaji: string = "";
    private isOkuri: boolean = false;
    private currentCandidate?: Candidate;
    private currentOkuri: string = "";
    private currentSuffix: string = "";
    private candidateList: Candidate[] = [];
    private candidateAlphabetList: string[] = [];
    private lastErrorMessage: string = "";
    private lastStatus: string = "";
    private fixatedCandidateText: string = "";
    private registrationEditorOpened: boolean = false;
    private registrationYomi?: string;
    private registrationOkuri?: string;
    private lastInsertedResult: { success: boolean; method: string } | null = null;
    private registrationModal: RegistrationModal | null = null;
    private originalEditorTarget: IEditorTarget | null = null;
    private originalSelectionSnapshot: IEditorSelectionSnapshot | null = null;
    private pendingRegistrationTarget: IEditorTarget | null = null;

    constructor(
        hud?: FloatingHUD,
        jisyoProvider?: IJisyoProvider,
        target?: TargetElementSupplier,
        initialMode?: IInputMode
    ) {
        this.hud = hud ?? new FloatingHUD();
        this.jisyoProvider = jisyoProvider ?? new SimpleMemoryJisyoProvider();
        this.targetSupplier = target;
        EditorFactory.setInstance(this);
        this.currentInputMode = initialMode ?? HiraganaMode.getInstance();
    }

    // --- Target Element Management ---

    public getTargetElement(): Element | null {
        if (typeof this.targetSupplier === "function") {
            return this.targetSupplier();
        }
        if (this.targetSupplier) {
            return this.targetSupplier;
        }
        if (typeof document !== "undefined") {
            return document.activeElement;
        }
        return null;
    }

    public setTargetElement(target: TargetElementSupplier): void {
        this.targetSupplier = target;
    }

    public getHUD(): FloatingHUD {
        return this.hud;
    }

    public getLastInsertedResult(): { success: boolean; method: string } | null {
        return this.lastInsertedResult;
    }

    public getFixatedCandidate(): string {
        return this.fixatedCandidateText;
    }

    public getMidashigo(): string {
        return this.midashigoText;
    }

    public isInMidashigo(): boolean {
        return this.inMidashigo;
    }

    public getCurrentCandidate(): Candidate | undefined {
        return this.currentCandidate;
    }

    public getCandidateList(): { candidates: Candidate[]; selectionKeys: string[] } {
        return {
            candidates: this.candidateList,
            selectionKeys: this.candidateAlphabetList
        };
    }

    public getRemainingRomaji(): string {
        return this.remainingRomaji;
    }

    public isOkuriStateActive(): boolean {
        return this.isOkuri;
    }

    public getLastErrorMessage(): string {
        return this.lastErrorMessage;
    }

    public wasRegistrationEditorOpened(): boolean {
        return this.registrationEditorOpened;
    }

    public getRegistrationYomi(): string | undefined {
        return this.registrationYomi;
    }

    public getRegistrationOkuri(): string | undefined {
        return this.registrationOkuri;
    }

    // --- IEditor Implementation ---

    public getJisyoProvider(): IJisyoProvider {
        return this.jisyoProvider;
    }

    public setJisyoProvider(provider: IJisyoProvider): void {
        this.jisyoProvider = provider;
    }

    public setInputMode(mode: IInputMode): void {
        const prevMode = this.currentInputMode;
        this.currentInputMode = mode;

        if (prevMode instanceof RegistrationMode) {
            const modal = this.registrationModal ?? RegistrationModal.getActiveModal();
            if (mode instanceof RegistrationMode && mode === prevMode.getParentRegistration()) {
                // Nested pop back to parent registration session:
                if (modal && modal.isOpen()) {
                    const parentInput = modal.popSession();
                    if (parentInput) {
                        mode.getMiniBufferEditor().setTarget(new InputElementTarget(parentInput));
                    }
                }
            } else if (!(mode instanceof RegistrationMode)) {
                // Root exit from registration (confirm, abort, or cancel):
                const origTarget = this.originalEditorTarget ?? modal?.getOriginalTarget() ?? null;
                const snapshot = this.originalSelectionSnapshot ?? modal?.getSelectionSnapshot() ?? null;
                if (snapshot) {
                    snapshot.restore();
                }
                if (origTarget) {
                    origTarget.focus();
                }
                if (modal && modal.isOpen()) {
                    modal.close();
                }
                this.pendingRegistrationTarget = origTarget;
                this.registrationModal = null;
                this.originalEditorTarget = null;
                this.originalSelectionSnapshot = null;
            }
        }

        this.updateHUD();
    }

    public getCurrentInputMode(): IInputMode {
        return this.currentInputMode;
    }

    public async insertOrReplaceSelection(str: string): Promise<boolean> {
        if (this.inMidashigo) {
            if (str.startsWith("▽")) {
                this.midashigoText += str.slice(1);
            } else {
                this.midashigoText += str;
            }
            this.updateHUD();
            return true;
        }

        if (this.pendingRegistrationTarget) {
            const target = this.pendingRegistrationTarget;
            this.pendingRegistrationTarget = null;
            if (target.isValid()) {
                target.focus();
                this.lastInsertedResult = target.insertText(str);
                this.updateHUD();
                return true;
            }
        }

        // In KakuteiMode, AsciiMode, ZeneiMode, etc.
        if (str.length > 0) {
            this.insertToDom(str);
        }
        this.updateHUD();
        return true;
    }

    public async replaceRange(range: IRange, str: string): Promise<boolean> {
        if (str.length > 0) {
            this.insertToDom(str);
        }
        return true;
    }

    public getTextInRange(range: IRange): string {
        const target = this.getTargetElement();
        if (isInputElement(target) || isTextAreaElement(target)) {
            return target.value;
        }
        return "";
    }

    public async deleteLeft(): Promise<DeleteLeftResult> {
        if (this.inMidashigo) {
            if (this.midashigoText.length > 0) {
                this.midashigoText = this.midashigoText.slice(0, -1);
                if (this.midashigoText.length === 0) {
                    await this.clearMidashigo();
                    return DeleteLeftResult.markerDeleted;
                }
                this.updateHUD();
                return DeleteLeftResult.otherCharacterDeleted;
            } else {
                await this.clearMidashigo();
                return DeleteLeftResult.markerDeleted;
            }
        }

        // When not in midashigo, delete one character from active DOM element
        this.deleteFromDom();
        this.updateHUD();
        return DeleteLeftResult.otherCharacterDeleted;
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
            } else {
                const code = firstChar.charCodeAt(0);
                if (firstChar === "　" || (code >= 0xff01 && code <= 0xff5e)) {
                    convFunc = (c: string) => {
                        if (c === "　") return " ";
                        const chCode = c.charCodeAt(0);
                        if (chCode >= 0xff01 && chCode <= 0xff5e) {
                            return String.fromCharCode(chCode - 0xfee0);
                        }
                        return c;
                    };
                }
            }

            const converted = midashigo.split("").map(convFunc).join("");
            this.inMidashigo = false;
            this.midashigoText = "";
            this.remainingRomaji = "";
            this.isOkuri = false;
            this.currentCandidate = undefined;
            this.currentOkuri = "";
            this.currentSuffix = "";
            this.insertToDom(converted);
            this.updateHUD();
        }
    }

    public setMidashigoStartToCurrentPosition(): void {
        this.inMidashigo = true;
        this.midashigoText = "";
        this.currentCandidate = undefined;
        this.currentOkuri = "";
        this.currentSuffix = "";
        this.updateHUD();
    }

    public async clearMidashigo(): Promise<boolean> {
        this.inMidashigo = false;
        this.midashigoText = "";
        this.remainingRomaji = "";
        this.isOkuri = false;
        this.currentCandidate = undefined;
        this.currentOkuri = "";
        this.currentSuffix = "";
        this.updateHUD();
        return true;
    }

    public extractMidashigo(): string | undefined {
        if (!this.inMidashigo) {
            return undefined;
        }
        return this.midashigoText;
    }

    public calcMidashigoRange(): IRange | undefined {
        if (!this.inMidashigo) {
            return undefined;
        }
        return {
            start: { line: 0, character: 0 },
            end: { line: 0, character: this.midashigoText.length }
        };
    }

    public async fixateMidashigo(): Promise<boolean> {
        const midashigo = this.extractMidashigo();
        if (midashigo !== undefined && this.inMidashigo) {
            this.inMidashigo = false;
            this.midashigoText = "";
            this.remainingRomaji = "";
            this.isOkuri = false;
            this.currentCandidate = undefined;
            this.currentOkuri = "";
            this.currentSuffix = "";
            if (midashigo.length > 0) {
                this.insertToDom(midashigo);
            }
            this.updateHUD();
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
        this.updateHUD();
        return true;
    }

    public showCandidateList(candidateList: Candidate[], alphabetList: string[]): void {
        this.candidateList = candidateList;
        this.candidateAlphabetList = alphabetList;
        this.updateHUD();
    }

    public hideCandidateList(): void {
        this.candidateList = [];
        this.candidateAlphabetList = [];
        this.updateHUD();
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

        this.fixatedCandidateText = textToInsert;
        this.inMidashigo = false;
        this.midashigoText = "";
        this.remainingRomaji = "";
        this.isOkuri = false;
        this.currentCandidate = undefined;
        this.currentOkuri = "";
        this.currentSuffix = "";
        this.candidateList = [];
        this.candidateAlphabetList = [];

        this.insertToDom(textToInsert);
        this.updateHUD();
        return true;
    }

    public async clearCandidate(): Promise<boolean> {
        this.currentCandidate = undefined;
        this.currentOkuri = "";
        this.currentSuffix = "";
        this.updateHUD();
        return true;
    }

    public showRemainingRomaji(remainingRomaji: string, isOkuri: boolean, offset: number): void {
        this.remainingRomaji = remainingRomaji;
        this.isOkuri = isOkuri;
        this.updateHUD();
    }

    public showErrorMessage(message: string): void {
        this.lastErrorMessage = message;
        this.lastStatus = message;
        this.updateHUD();
    }

    public async openRegistrationEditor(yomi: string, okuri: string): Promise<void> {
        this.registrationEditorOpened = true;
        this.registrationYomi = yomi;
        this.registrationOkuri = okuri;
        this.lastStatus = `[辞書登録: ${yomi}]`;

        const prevMode = this.currentInputMode;
        const parentReg = prevMode instanceof RegistrationMode ? prevMode : undefined;
        if (parentReg && parentReg.getDepth() >= MAX_REGISTRATION_DEPTH) {
            this.showErrorMessage("辞書登録の再帰深度制限を超えました");
            return;
        }

        const regMode = new RegistrationMode(yomi, okuri, this, prevMode, parentReg);

        let modal = this.registrationModal;
        if (!modal) {
            const active = RegistrationModal.getActiveModal();
            const myShadow = this.hud.getShadowRoot();
            if (active && (!myShadow || active.getShadowRoot() === myShadow)) {
                modal = active;
            } else if (myShadow) {
                modal = new RegistrationModal(myShadow);
            }
        }

        if (modal) {
            this.registrationModal = modal;
            if (parentReg) {
                const childInput = modal.pushSession(yomi, okuri);
                if (!childInput) {
                    this.showErrorMessage("辞書登録の再帰深度制限を超えました");
                    return;
                }
            } else {
                if (!modal.isOpen()) {
                    const origEl = this.getTargetElement();
                    const origTarget = origEl ? createEditorTarget(origEl) : null;
                    modal.open(yomi, okuri, origTarget);
                }
                this.originalEditorTarget = modal.getOriginalTarget();
                this.originalSelectionSnapshot = modal.getSelectionSnapshot();
            }

            const activeInput = modal.getActiveInputElement();
            if (activeInput) {
                const modalTarget = new InputElementTarget(activeInput);
                regMode.getMiniBufferEditor().setTarget(modalTarget);
            }
            if (modal.getOriginalTarget()) {
                this.originalEditorTarget = modal.getOriginalTarget();
                this.originalSelectionSnapshot = modal.getSelectionSnapshot();
            }
        }

        this.setInputMode(regMode);
    }

    public getRegistrationModal(): RegistrationModal | null {
        return this.registrationModal ?? RegistrationModal.getActiveModal();
    }

    public async registerMidashigo(): Promise<void> {
        // Registration editor is handled via UI components
    }

    public async notifyModeInternalStateChanged(): Promise<void> {
        this.pendingRegistrationTarget = null;
        this.updateHUD();
    }

    // --- Mode & HUD Presentation ---

    public getModeBadgeText(): string {
        if (this.currentInputMode instanceof RegistrationMode) {
            return this.currentInputMode.toString();
        }
        if (this.currentInputMode instanceof HiraganaMode) {
            return "かな";
        }
        if (this.currentInputMode instanceof KatakanaMode) {
            return "カナ";
        }
        if (this.currentInputMode instanceof ZeneiMode) {
            return "全英";
        }
        if (this.currentInputMode instanceof AsciiMode) {
            return "アスキー";
        }
        const str = this.currentInputMode?.toString?.();
        if (str && str !== "[object Object]") {
            return str;
        }
        return "かな";
    }

    public updateHUD(): void {
        if (this.currentInputMode instanceof AsciiMode) {
            this.hud.hide();
            return;
        }

        const target = this.getTargetElement();
        const coords = typeof document !== "undefined" ? getActiveCaretCoordinates(target) : null;
        const viewportHeight =
            typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 600;

        const x = coords?.x ?? 20;
        const y = coords ? coords.y + 4 : viewportHeight - 50;

        const modeBadge = this.getModeBadgeText();

        let preeditStr = "";
        let candidateText: string | undefined = undefined;
        let statusText: string = "";

        if (this.currentInputMode instanceof RegistrationMode) {
            const regMode = this.currentInputMode;
            const mb = regMode.getMiniBufferEditor();
            const prompt = regMode.getPromptHeader();
            let mbPreedit = mb.getCommittedText();

            if (mb.getCurrentCandidate()) {
                const cand = mb.getCurrentCandidate();
                candidateText = cand ? cand.word + mb.getCurrentOkuri() + mb.getCurrentSuffix() : undefined;
                if (mb.getRemainingRomaji()) {
                    mbPreedit += mb.getRemainingRomaji();
                }
            } else if (mb.isInMidashigo()) {
                mbPreedit += "▽" + mb.getMidashigoText() + (mb.isOkuriStateActive() ? "*" : "") + mb.getRemainingRomaji();
            } else if (mb.getRemainingRomaji()) {
                mbPreedit += mb.getRemainingRomaji();
            }
            preeditStr = prompt + mbPreedit;

            const candList = mb.getCandidateList();
            if (candList.selectionKeys.length > 0) {
                statusText = candList.selectionKeys
                    .map((key, i) => `${key}:${candList.candidates[i]?.word ?? ""}`)
                    .join(" ");
            } else if (mb.getCurrentCandidate()?.annotation) {
                statusText = mb.getCurrentCandidate()?.annotation || "";
            } else {
                statusText = this.lastStatus || "";
            }
        } else {
            if (this.currentCandidate) {
                preeditStr = this.remainingRomaji ? this.remainingRomaji : "";
            } else if (this.inMidashigo) {
                preeditStr = "▽" + this.midashigoText + (this.isOkuri ? "*" : "") + this.remainingRomaji;
            } else if (this.remainingRomaji) {
                preeditStr = this.remainingRomaji;
            }

            candidateText = this.currentCandidate
                ? this.currentCandidate.word + (this.currentOkuri || "") + (this.currentSuffix || "")
                : undefined;

            statusText = this.currentCandidate?.annotation || this.lastStatus || "";
            if (this.candidateAlphabetList.length > 0) {
                statusText = this.candidateAlphabetList
                    .map((key, i) => `${key}:${this.candidateList[i]?.word ?? ""}`)
                    .join(" ");
            }
        }

        this.hud.update({
            x,
            y,
            mode: modeBadge,
            preedit: preeditStr,
            candidate: candidateText,
            status: statusText || undefined
        });
    }

    // --- Private DOM Insertion / Deletion ---

    private insertToDom(str: string): { success: boolean; method: string } {
        if (!str) {
            return { success: true, method: "noop" };
        }
        const target = this.getTargetElement();
        if (
            target &&
            typeof (target as HTMLElement).focus === "function" &&
            typeof document !== "undefined" &&
            document.activeElement !== target
        ) {
            try {
                (target as HTMLElement).focus();
            } catch {}
        }

        let result = insertText(str);

        // Fallback for custom / mock input target in test or edge environments
        if (
            !result.success &&
            (isInputElement(target) || isTextAreaElement(target))
        ) {
            try {
                let start: number | null = null;
                let end: number | null = null;
                let canSelect = false;
                if (isTextAreaElement(target) || isSelectableInput(target)) {
                    try {
                        start = target.selectionStart;
                        end = target.selectionEnd;
                        canSelect = true;
                    } catch {
                        canSelect = false;
                    }
                }

                const val = target.value ?? "";
                if (canSelect && start !== null && end !== null) {
                    target.value = val.substring(0, start) + str + val.substring(end);
                    const newPos = start + str.length;
                    try {
                        target.setSelectionRange(newPos, newPos);
                    } catch {}
                } else {
                    target.value = val + str;
                }
                target.dispatchEvent(new Event("input", { bubbles: true }));
                result = { success: true, method: "fallback-value-replace" };
            } catch (err) {
                console.error("[SKK] fallback input value replacement failed:", err);
            }
        }

        this.lastInsertedResult = result;
        return result;
    }

    private deleteFromDom(): boolean {
        const target = this.getTargetElement();
        if (
            target &&
            typeof (target as HTMLElement).focus === "function" &&
            typeof document !== "undefined" &&
            document.activeElement !== target
        ) {
            try {
                (target as HTMLElement).focus();
            } catch {}
        }

        if (typeof document !== "undefined" && typeof document.execCommand === "function") {
            try {
                if (document.execCommand("delete", false)) {
                    return true;
                }
            } catch {}
        }

        if (isInputElement(target) || isTextAreaElement(target)) {
            try {
                let start: number | null = null;
                let end: number | null = null;
                let canSelect = false;
                if (isTextAreaElement(target) || isSelectableInput(target)) {
                    try {
                        start = target.selectionStart;
                        end = target.selectionEnd;
                        canSelect = true;
                    } catch {
                        canSelect = false;
                    }
                }

                const val = target.value ?? "";
                if (canSelect && start !== null && end !== null) {
                    if (start === end && start > 0) {
                        target.value = val.substring(0, start - 1) + val.substring(end);
                        try {
                            target.setSelectionRange(start - 1, start - 1);
                        } catch {}
                        target.dispatchEvent(new Event("input", { bubbles: true }));
                        return true;
                    } else if (start !== end) {
                        target.value = val.substring(0, start) + val.substring(end);
                        try {
                            target.setSelectionRange(start, start);
                        } catch {}
                        target.dispatchEvent(new Event("input", { bubbles: true }));
                        return true;
                    }
                    return false;
                } else {
                    // Non-selectable input (e.g. number/email) or selection unavailable:
                    // Fallback to removing the last character
                    if (val.length > 0) {
                        target.value = val.slice(0, -1);
                        target.dispatchEvent(new Event("input", { bubbles: true }));
                        return true;
                    }
                    return false;
                }
            } catch (err) {
                console.warn("[SKK] deleteFromDom fallback failed:", err);
            }
        }

        return false;
    }
}
