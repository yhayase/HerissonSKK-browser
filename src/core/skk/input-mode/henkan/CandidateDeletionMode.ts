import { AbstractHenkanMode } from "./AbstractHenkanMode";
import type { AbstractKanaMode } from "../AbstractKanaMode";
import type { IEditor, DeletionConfirmation } from "../../editor/IEditor";
import { KakuteiMode } from "./KakuteiMode";
import type { InlineHenkanMode } from "./InlineHenkanMode";
import type { Candidate } from "../../jisyo/candidate";

/** インライン候補の削除を明示的に確認します。辞書操作中は重複実行を防ぎます。 */
export class CandidateDeletionMode extends AbstractHenkanMode {
    private busy = false;
    private readonly confirmation: DeletionConfirmation;

    private constructor(
        editor: IEditor,
        private readonly prevMode: InlineHenkanMode,
        private readonly midashigo: string,
        private readonly candidate: Candidate,
        okuri: string,
        displayReading: string,
    ) {
        super("Delete?", editor);
        this.confirmation = { reading: displayReading, candidate: candidate.word, okuri };
    }

    public static create(editor: IEditor, prevMode: InlineHenkanMode, midashigo: string, candidate: Candidate, okuri: string, displayReading: string): CandidateDeletionMode {
        const mode = new CandidateDeletionMode(editor, prevMode, midashigo, candidate, okuri, displayReading);
        editor.showDeletionConfirmation(mode.confirmation);
        return mode;
    }

    private warn(message: string): void {
        if (this.busy) return;
        this.confirmation.warning = message;
        this.confirmation.error = undefined;
        this.editor.showDeletionConfirmation({ ...this.confirmation });
    }

    public isDeleting(): boolean { return this.busy; }

    private async cancel(context: AbstractKanaMode): Promise<void> {
        if (this.busy || context.getHenkanMode() !== this || this.editor.isDeletionContextActive?.() === false) return;
        this.editor.clearDeletionConfirmation();
        context.setHenkanMode(this.prevMode);
        await this.prevMode.showCandidate(context);
    }

    async onLowerAlphabet(_context: AbstractKanaMode, key: string): Promise<void> {
        this.warn(key === "y" || key === "n" ? "大文字の Y または N を押してください" : "Y または N を押してください");
    }

    async onUpperAlphabet(context: AbstractKanaMode, key: string): Promise<void> {
        if (key === "N") return this.cancel(context);
        if (key !== "Y") {
            this.warn("Y または N を押してください");
            return;
        }
        if (this.busy || context.getHenkanMode() !== this || this.editor.isDeletionContextActive?.() === false) return;
        this.busy = true;
        this.confirmation.warning = "削除中…";
        this.confirmation.error = undefined;
        this.editor.showDeletionConfirmation({ ...this.confirmation });
        let deleted = false;
        let failed = false;
        try {
            deleted = await this.editor.getJisyoProvider().deleteCandidate(this.midashigo, this.candidate);
        } catch {
            failed = true;
        }
        // フォーカス移動や登録の取消後に古い結果で表示・入力状態を書き戻しません。
        if (context.getHenkanMode() !== this || this.editor.isDeletionContextActive?.() === false) return;
        this.busy = false;
        if (!deleted) {
            this.confirmation.error = failed ? "削除に失敗しました。Y で再試行、N で戻ります" : "個人辞書に削除対象がありません。N で戻ります";
            this.confirmation.warning = undefined;
            this.editor.showDeletionConfirmation({ ...this.confirmation });
            return;
        }
        this.editor.clearDeletionConfirmation();
        context.setHenkanMode(KakuteiMode.create(context, this.editor));
        await this.editor.clearMidashigo();
        await this.editor.clearCandidate();
        this.editor.showRemainingRomaji("", false, 0);
    }

    async onCtrlG(context: AbstractKanaMode): Promise<void> { await this.cancel(context); }
    async onNumber(_context: AbstractKanaMode): Promise<void> { this.warn("Y または N を押してください"); }
    async onSymbol(_context: AbstractKanaMode): Promise<void> { this.warn("Y または N を押してください"); }
    async onSpace(_context: AbstractKanaMode): Promise<void> { this.warn("Y または N を押してください"); }
    async onEnter(_context: AbstractKanaMode): Promise<void> { this.warn("Y または N を押してください"); }
    async onBackspace(_context: AbstractKanaMode): Promise<void> { this.warn("Y または N を押してください"); }
    async onCtrlJ(_context: AbstractKanaMode): Promise<void> { this.warn("Y または N を押してください"); }

    public override getActiveKeys(): Set<string> {
        const keys = new Set<string>();
        for (let i = 32; i <= 126; i++) {
            const char = String.fromCharCode(i);
            if ("a" <= char && char <= "z") {
                keys.add(char);
                keys.add("shift+" + char);
            } else if (!("A" <= char && char <= "Z")) {
                keys.add(char);
            }
        }
        for (const key of ["enter", "backspace", "ctrl+j", "ctrl+g"]) keys.add(key);
        return keys;
    }

    public override getContextualName(): string { return "candidateDeletion"; }
}
