import { describe, it, expect } from "vitest";
import { Candidate } from "../../src/core/skk/jisyo/candidate";
import { Entry } from "../../src/core/skk/jisyo/entry";
import {
    parseJisyoLine,
    parseJisyoLines,
    parseJisyoText,
    formatJisyoLine,
    formatJisyoText,
    formatCandidate,
} from "../../src/core/skk/jisyo/JisyoParser";
import type { IJisyoStorage, IUserJisyoStorage } from "../../src/core/skk/jisyo/IJisyoStorage";

describe("JisyoParser", () => {
    describe("parseJisyoLine", () => {
        describe("Comment line skipping", () => {
            it("skips standard SKK comment lines starting with ';;'", () => {
                expect(parseJisyoLine(";; okuri-ari entries.")).toBeUndefined();
                expect(parseJisyoLine(";; okuri-nasi entries.")).toBeUndefined();
                expect(parseJisyoLine(";; -*- coding: utf-8 -*-")).toBeUndefined();
            });

            it("skips comment lines with leading whitespace", () => {
                expect(parseJisyoLine("   ;; indented comment")).toBeUndefined();
                expect(parseJisyoLine("\t;; tab-indented comment")).toBeUndefined();
            });

            it("skips comment lines even if they contain slashes", () => {
                expect(parseJisyoLine(";; /cand1/cand2/")).toBeUndefined();
                expect(parseJisyoLine(";; note: use / for separator")).toBeUndefined();
            });
        });

        describe("Malformed or blank lines", () => {
            it("returns undefined for empty or whitespace-only lines", () => {
                expect(parseJisyoLine("")).toBeUndefined();
                expect(parseJisyoLine("   ")).toBeUndefined();
                expect(parseJisyoLine("\t\r\n")).toBeUndefined();
            });

            it("returns undefined for lines without slashes", () => {
                expect(parseJisyoLine("midashigo without slashes")).toBeUndefined();
                expect(parseJisyoLine("とうきょう 東京")).toBeUndefined();
            });

            it("returns undefined for lines missing midashigo (key)", () => {
                expect(parseJisyoLine("/cand1/cand2/")).toBeUndefined();
                expect(parseJisyoLine("   /cand1/cand2/")).toBeUndefined();
            });

            it("returns undefined for lines with empty candidate lists", () => {
                expect(parseJisyoLine("key //")).toBeUndefined();
                expect(parseJisyoLine("key ////")).toBeUndefined();
                expect(parseJisyoLine("key /")).toBeUndefined();
            });

            it("returns undefined for lines where candidates have no word", () => {
                expect(parseJisyoLine("key /;only annotation/")).toBeUndefined();
                expect(parseJisyoLine("key /;/")).toBeUndefined();
            });
        });

        describe("Okuri-nasi lines", () => {
            it("parses single candidate entry", () => {
                const entry = parseJisyoLine("とうきょう /東京/");
                expect(entry).toBeDefined();
                expect(entry!.key).toBe("とうきょう");
                expect(entry!.candidates).toHaveLength(1);
                expect(entry!.candidates[0]!.word).toBe("東京");
                expect(entry!.candidates[0]!.annotation).toBeUndefined();
            });

            it("parses multiple candidates", () => {
                const entry = parseJisyoLine("とうきょう /東京/とうきょう/");
                expect(entry).toBeDefined();
                expect(entry!.key).toBe("とうきょう");
                expect(entry!.candidates).toHaveLength(2);
                expect(entry!.candidates[0]!.word).toBe("東京");
                expect(entry!.candidates[1]!.word).toBe("とうきょう");
            });

            it("handles line without trailing slash", () => {
                const entry = parseJisyoLine("へんかん /変換/返還");
                expect(entry).toBeDefined();
                expect(entry!.key).toBe("へんかん");
                expect(entry!.candidates).toHaveLength(2);
                expect(entry!.candidates[0]!.word).toBe("変換");
                expect(entry!.candidates[1]!.word).toBe("返還");
            });

            it("handles multiple spaces and tabs separating key and candidates", () => {
                const entry = parseJisyoLine("がっこう \t /学校/");
                expect(entry).toBeDefined();
                expect(entry!.key).toBe("がっこう");
                expect(entry!.candidates[0]!.word).toBe("学校");
            });

            it("skips empty tokens between consecutive slashes", () => {
                const entry = parseJisyoLine("てすと /テスト//試験/");
                expect(entry).toBeDefined();
                expect(entry!.key).toBe("てすと");
                expect(entry!.candidates).toHaveLength(2);
                expect(entry!.candidates[0]!.word).toBe("テスト");
                expect(entry!.candidates[1]!.word).toBe("試験");
            });
        });

        describe("Okuri-ari lines", () => {
            it("parses okuri-ari stem + alphabet keys", () => {
                const ik = parseJisyoLine("いk /行/逝/往/");
                expect(ik).toBeDefined();
                expect(ik!.key).toBe("いk");
                expect(ik!.candidates).toHaveLength(3);
                expect(ik!.candidates.map((c) => c.word)).toEqual(["行", "逝", "往"]);

                const taber = parseJisyoLine("たべr /食/");
                expect(taber).toBeDefined();
                expect(taber!.key).toBe("たべr");
                expect(taber!.candidates[0]!.word).toBe("食");

                const hashir = parseJisyoLine("はしr /走/");
                expect(hashir).toBeDefined();
                expect(hashir!.key).toBe("はしr");
                expect(hashir!.candidates[0]!.word).toBe("走");

                const au = parseJisyoLine("あu /合/会/逢/");
                expect(au).toBeDefined();
                expect(au!.key).toBe("あu");
                expect(au!.candidates.map((c) => c.word)).toEqual(["合", "会", "逢"]);
            });
        });

        describe("Prefix / Suffix ('>') lines", () => {
            it("parses prefix entries with trailing '>'", () => {
                const entry = parseJisyoLine("だい> /大/第/");
                expect(entry).toBeDefined();
                expect(entry!.key).toBe("だい>");
                expect(entry!.candidates.map((c) => c.word)).toEqual(["大", "第"]);
            });

            it("parses prefix entries with place name", () => {
                const entry = parseJisyoLine("とうきょう> /東京都/");
                expect(entry).toBeDefined();
                expect(entry!.key).toBe("とうきょう>");
                expect(entry!.candidates[0]!.word).toBe("東京都");
            });

            it("parses suffix entries with leading '>'", () => {
                const entry = parseJisyoLine(">さま /様/");
                expect(entry).toBeDefined();
                expect(entry!.key).toBe(">さま");
                expect(entry!.candidates[0]!.word).toBe("様");
            });

            it("parses suffix entries with trailing '>'", () => {
                const entry = parseJisyoLine("さま> /様/");
                expect(entry).toBeDefined();
                expect(entry!.key).toBe("さま>");
                expect(entry!.candidates[0]!.word).toBe("様");
            });
        });

        describe("Candidate Annotations", () => {
            it("parses candidates with annotations (/日;ひ/日本;にほん/)", () => {
                const entry = parseJisyoLine("にほん /日;ひ/日本;にほん/");
                expect(entry).toBeDefined();
                expect(entry!.key).toBe("にほん");
                expect(entry!.candidates).toHaveLength(2);
                expect(entry!.candidates[0]!.word).toBe("日");
                expect(entry!.candidates[0]!.annotation).toBe("ひ");
                expect(entry!.candidates[1]!.word).toBe("日本");
                expect(entry!.candidates[1]!.annotation).toBe("にほん");
            });

            it("handles mix of candidates with and without annotations", () => {
                const entry = parseJisyoLine("きょう /今日;きょう/京/教;おしえ/");
                expect(entry).toBeDefined();
                expect(entry!.candidates).toHaveLength(3);
                expect(entry!.candidates[0]!.word).toBe("今日");
                expect(entry!.candidates[0]!.annotation).toBe("きょう");
                expect(entry!.candidates[1]!.word).toBe("京");
                expect(entry!.candidates[1]!.annotation).toBeUndefined();
                expect(entry!.candidates[2]!.word).toBe("教");
                expect(entry!.candidates[2]!.annotation).toBe("おしえ");
            });

            it("handles multiple semicolons within annotation", () => {
                const entry = parseJisyoLine("HTTP /HyperText Transfer Protocol;通信プロトコル;Web/");
                expect(entry).toBeDefined();
                expect(entry!.candidates[0]!.word).toBe("HyperText Transfer Protocol");
                expect(entry!.candidates[0]!.annotation).toBe("通信プロトコル;Web");
            });

            it("treats empty annotation as undefined", () => {
                const entry = parseJisyoLine("き /気;/");
                expect(entry).toBeDefined();
                expect(entry!.candidates[0]!.word).toBe("気");
                expect(entry!.candidates[0]!.annotation).toBeUndefined();
            });

            it("handles Emacs Lisp concat notation with slash escape", () => {
                const rawLine = 'dosv /(concat "DOS\\057V")/';
                const entry = parseJisyoLine(rawLine);
                expect(entry).toBeDefined();
                expect(entry!.key).toBe("dosv");
                expect(entry!.candidates[0]!.word).toBe("DOS/V");
            });
        });
    });

    describe("parseJisyoLines generator", () => {
        it("yields valid entries across multiple lines and skips comments", () => {
            const text = [
                ";; SKK-JISYO test",
                "とうきょう /東京/",
                "",
                ";; section break",
                "いk /行/逝/",
            ].join("\n");

            const entries = Array.from(parseJisyoLines(text));
            expect(entries).toHaveLength(2);
            expect(entries[0]!.key).toBe("とうきょう");
            expect(entries[1]!.key).toBe("いk");
        });
    });

    describe("parseJisyoText", () => {
        it("parses multi-line dictionary text into a Map", () => {
            const text = [
                ";; okuri-nasi entries.",
                "とうきょう /東京/とうきょう/",
                "にほん /日本;にほん/二本/",
                ";; okuri-ari entries.",
                "いk /行/逝/",
                "だい> /大/",
            ].join("\n");

            const map = parseJisyoText(text);
            expect(map.size).toBe(4);
            expect(map.get("とうきょう")?.map((c) => c.word)).toEqual(["東京", "とうきょう"]);
            expect(map.get("にほん")?.[0]?.annotation).toBe("にほん");
            expect(map.get("いk")?.map((c) => c.word)).toEqual(["行", "逝"]);
            expect(map.get("だい>")?.map((c) => c.word)).toEqual(["大"]);
        });

        it("handles CRLF and CR line breaks correctly", () => {
            const crlfText = ";; comment\r\nとうきょう /東京/\r\nにほん /日本/\r\n";
            const crlfMap = parseJisyoText(crlfText);
            expect(crlfMap.size).toBe(2);
            expect(crlfMap.has("とうきょう")).toBe(true);
            expect(crlfMap.has("にほん")).toBe(true);

            const crText = "とうきょう /東京/\rにほん /日本/\r";
            const crMap = parseJisyoText(crText);
            expect(crMap.size).toBe(2);
        });

        it("merges duplicate keys across lines without duplicate candidates", () => {
            const text = [
                "とうきょう /東京/",
                "とうきょう /東京/とうきょう;ひらがな/",
            ].join("\n");

            const map = parseJisyoText(text);
            const candidates = map.get("とうきょう")!;
            expect(candidates).toHaveLength(2);
            expect(candidates[0]!.word).toBe("東京");
            expect(candidates[0]!.annotation).toBeUndefined(); // First occurrence preserved
            expect(candidates[1]!.word).toBe("とうきょう");
            expect(candidates[1]!.annotation).toBe("ひらがな");
        });

        it("enriches existing candidate annotation if original lacked annotation", () => {
            const text = [
                "にほん /日本/",
                "にほん /日本;にほん/二本/",
            ].join("\n");

            const map = parseJisyoText(text);
            const candidates = map.get("にほん")!;
            expect(candidates).toHaveLength(2);
            expect(candidates[0]!.word).toBe("日本");
            expect(candidates[0]!.annotation).toBe("にほん"); // Enriched from second line
            expect(candidates[1]!.word).toBe("二本");
        });
    });


    describe("formatJisyoLine & formatJisyoText", () => {
        it("formats a single entry without annotations", () => {
            const line = formatJisyoLine("とうきょう", [new Candidate("東京"), new Candidate("とうきょう")]);
            expect(line).toBe("とうきょう /東京/とうきょう/");
        });

        it("formats a single entry with annotations", () => {
            const line = formatJisyoLine("にほん", [new Candidate("日本", "にほん"), new Candidate("二本")]);
            expect(line).toBe("にほん /日本;にほん/二本/");
        });

        it("formats candidate tokens using formatCandidate", () => {
            expect(formatCandidate(new Candidate("東京"))).toBe("東京");
            expect(formatCandidate(new Candidate("日本", "にほん"))).toBe("日本;にほん");
            expect(formatCandidate(new Candidate("DOS/V"))).toBe('(concat "DOS\\057V")');
            expect(formatCandidate(new Candidate("foo;bar"))).toBe('(concat "foo\\073bar")');
        });

        it("escapes candidate words containing '/' using (concat ...) notation", () => {
            const line = formatJisyoLine("dosv", [new Candidate("DOS/V")]);
            expect(line).toBe('dosv /(concat "DOS\\057V")/');
            const parsed = parseJisyoLine(line);
            expect(parsed).toBeDefined();
            expect(parsed!.candidates[0]!.word).toBe("DOS/V");
        });

        it("escapes candidate words containing ';' using (concat ...) notation", () => {
            const line = formatJisyoLine("test", [new Candidate("emacs;text editor")]);
            expect(line).toBe('test /(concat "emacs\\073text editor")/');
            const parsed = parseJisyoLine(line);
            expect(parsed).toBeDefined();
            expect(parsed!.candidates[0]!.word).toBe("emacs;text editor");
            expect(parsed!.candidates[0]!.annotation).toBeUndefined();
        });

        it("escapes candidate words containing ';' when candidate also has an annotation", () => {
            const line = formatJisyoLine("test", [new Candidate("foo;bar", "annot")]);
            expect(line).toBe('test /(concat "foo\\073bar");annot/');
            const parsed = parseJisyoLine(line);
            expect(parsed).toBeDefined();
            expect(parsed!.candidates[0]!.word).toBe("foo;bar");
            expect(parsed!.candidates[0]!.annotation).toBe("annot");
        });

        it("escapes annotations containing '/' using \\057", () => {
            const line = formatJisyoLine("url", [new Candidate("サイト", "https://example.com/test")]);
            expect(line).toBe("url /サイト;https:\\057\\057example.com\\057test/");
            const parsed = parseJisyoLine(line);
            expect(parsed).toBeDefined();
            expect(parsed!.candidates[0]!.word).toBe("サイト");
            expect(parsed!.candidates[0]!.annotation).toBe("https://example.com/test");
        });

        it("escapes candidate and annotation both containing '/'", () => {
            const line = formatJisyoLine("lang", [new Candidate("C/C++", "C/C++言語")]);
            expect(line).toBe('lang /(concat "C\\057C++");C\\057C++言語/');
            const parsed = parseJisyoLine(line);
            expect(parsed).toBeDefined();
            expect(parsed!.candidates[0]!.word).toBe("C/C++");
            expect(parsed!.candidates[0]!.annotation).toBe("C/C++言語");
        });

        it("unescapes backslashes in annotations", () => {
            const line = 'test /candidate;path\\\\to\\\\file/';
            const parsed = parseJisyoLine(line);
            expect(parsed).toBeDefined();
            expect(parsed!.candidates[0]!.annotation).toBe("path\\to\\file");
        });

        it("formats multiple dictionary entries to text", () => {
            const entries = new Map<string, Candidate[]>([
                ["とうきょう", [new Candidate("東京")]],
                ["にほん", [new Candidate("日本", "にほん")]],
            ]);
            const formatted = formatJisyoText(entries);
            expect(formatted).toBe("とうきょう /東京/\nにほん /日本;にほん/\n");
        });

        it("round-trips between formatting and parsing (including /, ;, and annotations with /)", () => {
            const originalMap = new Map<string, Candidate[]>([
                ["とうきょう", [new Candidate("東京"), new Candidate("とうきょう")]],
                ["にほん", [new Candidate("日本", "にほん"), new Candidate("二本")]],
                ["いk", [new Candidate("行"), new Candidate("逝")]],
                ["だい>", [new Candidate("大")]],
                ["dosv", [new Candidate("DOS/V")]],
                ["cpp", [new Candidate("C/C++", "C/C++プログラミング")]],
                ["semicolon", [new Candidate("foo;bar", "annot/with/slash")]],
                ["url", [new Candidate("ウェブ", "https://example.com/foo/bar")]],
            ]);

            const formatted = formatJisyoText(originalMap);
            const parsedMap = parseJisyoText(formatted);

            expect(parsedMap.size).toBe(originalMap.size);
            for (const [key, candidates] of originalMap) {
                const parsedCands = parsedMap.get(key);
                expect(parsedCands).toBeDefined();
                expect(parsedCands!.map((c) => c.word)).toEqual(candidates.map((c) => c.word));
                expect(parsedCands!.map((c) => c.annotation)).toEqual(candidates.map((c) => c.annotation));
            }
        });
    });


    describe("Interface Contracts (IJisyoStorage & IUserJisyoStorage)", () => {
        class MemoryJisyoStorage implements IJisyoStorage {
            private dictionary: Map<string, Candidate[]>;

            constructor(entries: Map<string, Candidate[]>) {
                this.dictionary = new Map(entries);
            }

            async lookup(key: string): Promise<Entry | undefined> {
                const cands = this.dictionary.get(key);
                if (!cands || cands.length === 0) {
                    return undefined;
                }
                return new Entry(key, [...cands], "");
            }

            async lookupPrefix(prefix: string): Promise<Entry[]> {
                const results: Entry[] = [];
                for (const [key, cands] of this.dictionary) {
                    if (key.startsWith(prefix) && cands.length > 0) {
                        results.push(new Entry(key, [...cands], ""));
                    }
                }
                return results;
            }
        }

        class MemoryUserJisyoStorage implements IUserJisyoStorage {
            private userEntries: Map<string, Candidate[]> = new Map();

            async loadUserEntries(): Promise<Map<string, Candidate[]>> {
                const copy = new Map<string, Candidate[]>();
                for (const [k, v] of this.userEntries) {
                    copy.set(k, [...v]);
                }
                return copy;
            }

            async saveCandidate(key: string, candidate: Candidate): Promise<boolean> {
                const list = this.userEntries.get(key) ?? [];
                const existingIdx = list.findIndex((c) => c.word === candidate.word);
                if (existingIdx !== -1) {
                    list.splice(existingIdx, 1);
                }
                list.unshift(candidate);
                this.userEntries.set(key, list);
                return true;
            }

            async reorderCandidate(key: string, target: Candidate | string | number): Promise<boolean> {
                const list = this.userEntries.get(key);
                if (!list || list.length === 0) {
                    return false;
                }
                let index = -1;
                if (typeof target === "number") {
                    if (target >= 0 && target < list.length) {
                        index = target;
                    }
                } else {
                    const targetWord = typeof target === "string" ? target : target.word;
                    index = list.findIndex((c) => c.word === targetWord);
                }
                if (index === -1) {
                    return false;
                }
                const selected = list.splice(index, 1)[0];
                if (selected) {
                    list.unshift(selected);
                }
                return true;
            }

            async deleteCandidate(key: string, candidate: Candidate): Promise<boolean> {
                const list = this.userEntries.get(key);
                if (!list) {
                    return false;
                }
                const idx = list.findIndex((c) => c.word === candidate.word);
                if (idx === -1) {
                    return false;
                }
                list.splice(idx, 1);
                if (list.length === 0) {
                    this.userEntries.delete(key);
                }
                return true;
            }

            async saveUserEntries(entries: Map<string, Candidate[]>): Promise<boolean> {
                this.userEntries = new Map(entries);
                return true;
            }

            async clear(): Promise<boolean> {
                this.userEntries.clear();
                return true;
            }
        }

        it("conforms to IJisyoStorage contract", async () => {
            const entries = new Map<string, Candidate[]>([
                ["とうきょう", [new Candidate("東京")]],
                ["とうきょう>", [new Candidate("東京都")]],
                ["とうきょうえき", [new Candidate("東京駅")]],
            ]);

            const storage: IJisyoStorage = new MemoryJisyoStorage(entries);

            // Exact lookup
            const found = await storage.lookup("とうきょう");
            expect(found).toBeDefined();
            expect(found!.getMidashigo()).toBe("とうきょう");
            expect(found!.getCandidateList()[0]!.word).toBe("東京");

            const notFound = await storage.lookup("おおさか");
            expect(notFound).toBeUndefined();

            // Prefix lookup
            const prefixResults = await storage.lookupPrefix!("とうきょう");
            expect(prefixResults).toHaveLength(3);
            expect(prefixResults.map((e) => e.getMidashigo())).toEqual([
                "とうきょう",
                "とうきょう>",
                "とうきょうえき",
            ]);
        });

        it("conforms to IUserJisyoStorage contract (save, reorder, delete, clear)", async () => {
            const userStorage: IUserJisyoStorage = new MemoryUserJisyoStorage();

            // Initial load is empty
            const initial = await userStorage.loadUserEntries();
            expect(initial.size).toBe(0);

            // Save candidate (LRU behavior: unshift)
            await userStorage.saveCandidate("へんかん", new Candidate("変換"));
            await userStorage.saveCandidate("へんかん", new Candidate("返還"));
            const loaded = await userStorage.loadUserEntries();
            expect(loaded.get("へんかん")?.map((c) => c.word)).toEqual(["返還", "変換"]);

            // Re-saving existing candidate moves it to front
            await userStorage.saveCandidate("へんかん", new Candidate("変換"));
            const afterResave = await userStorage.loadUserEntries();
            expect(afterResave.get("へんかん")?.map((c) => c.word)).toEqual(["変換", "返還"]);

            // Reorder candidate by index
            const reorderSuccess = await userStorage.reorderCandidate("へんかん", 1);
            expect(reorderSuccess).toBe(true);
            const afterReorder = await userStorage.loadUserEntries();
            expect(afterReorder.get("へんかん")?.map((c) => c.word)).toEqual(["返還", "変換"]);

            // Reorder with invalid index returns false
            const invalidReorder = await userStorage.reorderCandidate("へんかん", 99);
            expect(invalidReorder).toBe(false);

            // Delete candidate
            const deleteSuccess = await userStorage.deleteCandidate("へんかん", new Candidate("返還"));
            expect(deleteSuccess).toBe(true);
            const afterDelete = await userStorage.loadUserEntries();
            expect(afterDelete.get("へんかん")?.map((c) => c.word)).toEqual(["変換"]);

            // Delete last candidate removes key from dictionary
            await userStorage.deleteCandidate("へんかん", new Candidate("変換"));
            const afterDeleteAll = await userStorage.loadUserEntries();
            expect(afterDeleteAll.has("へんかん")).toBe(false);

            // Delete non-existent candidate returns false
            const notDeleted = await userStorage.deleteCandidate("へんかん", new Candidate("変換"));
            expect(notDeleted).toBe(false);

            // Bulk save and clear
            if (userStorage.saveUserEntries) {
                await userStorage.saveUserEntries(new Map([["test", [new Candidate("テスト")]]]));
                const afterBulk = await userStorage.loadUserEntries();
                expect(afterBulk.size).toBe(1);
            }
            if (userStorage.clear) {
                await userStorage.clear();
                const afterClear = await userStorage.loadUserEntries();
                expect(afterClear.size).toBe(0);
            }
        });
    });
});
