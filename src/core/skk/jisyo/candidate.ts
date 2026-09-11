export interface CandidateSource {
    kind: "system" | "learned";
    dictId?: string;
    name?: string;
    annotation?: string;
}

export interface CandidateData {
    word: string;
    annotation?: string;
    okuri?: string;
    sources?: CandidateSource[];
}

export class Candidate implements CandidateData {
    word: string;
    annotation?: string;
    okuri?: string;
    sources?: CandidateSource[];

    constructor(word: string, annotation?: string, metadata?: Pick<CandidateData, "okuri" | "sources">) {
        this.word = word;
        this.annotation = annotation;
        if (metadata?.okuri !== undefined) this.okuri = metadata.okuri;
        if (metadata?.sources) this.sources = metadata.sources.map((source) => ({ ...source }));
    }
}

export function copyCandidate(candidate: CandidateData): Candidate {
    return new Candidate(candidate.word, candidate.annotation, candidate);
}

export function candidateIdentity(candidate: CandidateData): string {
    return JSON.stringify([candidate.word, candidate.okuri ?? null]);
}

/** 優先順位と最上位の注釈を保ち、重複候補の出典を統合します。 */
export function mergeCandidates(candidates: readonly CandidateData[], byWord = false): Candidate[] {
    const result: Candidate[] = [];
    const seen = new Map<string, Candidate>();
    for (const candidate of candidates) {
        const identity = byWord ? candidate.word : candidateIdentity(candidate);
        const existing = seen.get(identity);
        if (!existing) {
            const copy = copyCandidate(candidate);
            seen.set(identity, copy);
            result.push(copy);
        } else if (candidate.sources) {
            const sources = existing.sources ??= [];
            for (const source of candidate.sources) {
                if (!sources.some((s) => JSON.stringify(s) === JSON.stringify(source))) sources.push({ ...source });
            }
        }
    }
    return result;
}
