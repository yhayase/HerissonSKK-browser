import type { IJisyoProvider } from "./IJisyoProvider";
import { Candidate } from "./candidate";
import { Entry } from "./entry";

export class SimpleMemoryJisyoProvider implements IJisyoProvider {
    private dictionary: Map<string, Candidate[]> = new Map();

    constructor(initialEntries?: Map<string, Candidate[]> | Record<string, (Candidate | string)[]>) {
        if (initialEntries) {
            if (initialEntries instanceof Map) {
                for (const [k, v] of initialEntries) {
                    this.dictionary.set(k, [...v]);
                }
            } else {
                for (const [k, v] of Object.entries(initialEntries)) {
                    const cands = v.map((item) => (typeof item === "string" ? new Candidate(item) : item));
                    this.dictionary.set(k, cands);
                }
            }
        } else {
            this.seedDefaultVocabulary();
        }
    }

    private seedDefaultVocabulary(): void {
        // Okuri-nasi entries
        this.dictionary.set("にほん", [new Candidate("日本")]);
        this.dictionary.set("とうきょう", [new Candidate("東京")]);
        this.dictionary.set("かんじ", [new Candidate("漢字")]);
        this.dictionary.set("へんかん", [new Candidate("変換")]);
        this.dictionary.set("がっこう", [new Candidate("学校")]);
        this.dictionary.set("えでぃた", [new Candidate("エディタ")]);
        this.dictionary.set("すっく", [new Candidate("SKK")]);
        this.dictionary.set("こーど", [new Candidate("コード")]);
        this.dictionary.set("てすと", [new Candidate("テスト")]);

        // Okuri-ari entries (stems combined with okurigana: 行く, 合う, 走る, 泳ぐ, 食べる)
        this.dictionary.set("いk", [new Candidate("行")]);
        this.dictionary.set("あu", [new Candidate("合")]);
        this.dictionary.set("はしr", [new Candidate("走")]);
        this.dictionary.set("およg", [new Candidate("泳")]);
        this.dictionary.set("たべr", [new Candidate("食")]);

        // Prefix / Suffix entries (support both trailing and leading '>' notation)
        this.dictionary.set("だい>", [new Candidate("大")]);
        this.dictionary.set("とうきょう>", [new Candidate("東京都")]);
        this.dictionary.set("さま>", [new Candidate("様")]);
        this.dictionary.set(">さま", [new Candidate("様")]);
        this.dictionary.set("さん>", [new Candidate("様")]);
        this.dictionary.set(">さん", [new Candidate("様")]);
    }

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
            const existingIdx = candidates.findIndex((c) => c.word === candidate.word);
            if (existingIdx !== -1) {
                candidates.splice(existingIdx, 1);
            }
            candidates.unshift(candidate);
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
            index = target;
        } else {
            const targetWord = typeof target === "string" ? target : target.word;
            index = candidates.findIndex((c) => c.word === targetWord);
        }
        if (index < 0 || index >= candidates.length) {
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

    public hasKey(key: string): boolean {
        return this.dictionary.has(key);
    }

    public getCandidates(key: string): Candidate[] | undefined {
        const cands = this.dictionary.get(key);
        return cands ? [...cands] : undefined;
    }

    public reset(): void {
        this.dictionary.clear();
        this.seedDefaultVocabulary();
    }
}
