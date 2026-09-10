import { Candidate, mergeCandidates } from "./candidate";
import type { IJisyoProvider } from "./IJisyoProvider";

export class Entry {
    private readonly midashigo: string;
    private readonly cookedCandidateList: Candidate[];
    private readonly rawCandidateList: Candidate[];

    constructor(midashigo: string, rawCandidateList: Candidate[], okuri: string) {
        this.midashigo = midashigo;
        this.rawCandidateList = rawCandidateList;

        if (okuri === "") {
            this.cookedCandidateList = this.rawCandidateList;
        } else {
            this.cookedCandidateList = this.rawCandidateList.map((c) => {
                return new Candidate(c.word + okuri, c.annotation, c);
            });
        }
    }

    /** 実際の送り仮名に合う候補だけを表示し、選択対象の条件を保ちます。 */
    forOkuri(okuri: string): Entry | undefined {
        const candidates = mergeCandidates(this.rawCandidateList.filter((c) => c.okuri === undefined || c.okuri === okuri), true);
        return candidates.length ? new Entry(this.midashigo, candidates, "") : undefined;
    }

    getMidashigo(): string {
        return this.midashigo;
    }

    getCandidateList(): ReadonlyArray<Candidate> {
        return this.cookedCandidateList;
    }

    onCandidateSelected(jisyoProvider: IJisyoProvider, index: number): void {
        // No order is changed, so no need to update the jisyo.
        if (index === 0) {
            return;
        }

        // Register reordered candidate list to the jisyo.
        // Pass the actual candidate object if available to ensure stable candidate promotion.
        const candidate = this.rawCandidateList[index];
        jisyoProvider.reorderCandidate(this.midashigo, candidate ?? index).catch((err) => {
            console.error(`Failed to reorder candidate for "${this.midashigo}":`, err);
        });
    }

    getRawCandidateList(): ReadonlyArray<Candidate> {
        return this.rawCandidateList;
    }
}
