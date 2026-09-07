import { Candidate } from "./candidate";

/**
 * Parsed dictionary entry representation.
 */
export interface JisyoEntry {
    key: string;
    candidates: Candidate[];
}

/**
 * Decodes a raw dictionary buffer into a string.
 * Supports UTF-8 and EUC-JP with robust fallback handling.
 *
 * @param buffer Raw dictionary data as Uint8Array
 * @param encoding Optional character encoding ('utf-8', 'euc-jp', etc.). If omitted, auto-detects.
 * @returns Decoded string content
 */
export function decodeJisyoBuffer(buffer: Uint8Array, encoding?: string): string {
    if (encoding) {
        try {
            return new TextDecoder(encoding).decode(buffer);
        } catch {
            return new TextDecoder("utf-8").decode(buffer);
        }
    }

    // Auto-detect encoding: try strict UTF-8 first, fallback to EUC-JP, then permissive UTF-8
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
        try {
            return new TextDecoder("euc-jp").decode(buffer);
        } catch {
            return new TextDecoder("utf-8").decode(buffer);
        }
    }
}

/**
 * Unescapes a candidate word from SKK dictionary format.
 * Resolves `(concat "...")` notations as well as octal escapes `\057` (slash) and `\073` (semicolon).
 *
 * @param word Raw word string from dictionary line
 * @returns Unescaped word string
 */
export function unescapeCandidateWord(word: string): string {
    if (word.startsWith('(concat "') && word.endsWith('")')) {
        return word
            .slice(9, -2)
            .replace(/\\057/g, "/")
            .replace(/\\073/g, ";")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\");
    }
    return word.replace(/\\057/g, "/").replace(/\\073/g, ";");
}

/**
 * Unescapes an annotation from SKK dictionary format.
 * Resolves `(concat "...")` notations as well as `\057` and `\073`.
 *
 * @param annot Raw annotation string from dictionary line
 * @returns Unescaped annotation string
 */
export function unescapeAnnotation(annot: string): string {
    if (annot.startsWith('(concat "') && annot.endsWith('")')) {
        return annot
            .slice(9, -2)
            .replace(/\\057/g, "/")
            .replace(/\\073/g, ";")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\");
    }
    return annot.replace(/\\057/g, "/").replace(/\\073/g, ";").replace(/\\\\/g, "\\");
}

/**
 * Escapes a candidate word for SKK dictionary format.
 * If the word contains '/', ';', or '\', formats as `(concat "...")` with octal/escaped characters.
 *
 * @param word Candidate word
 * @returns Escaped word string
 */
export function escapeCandidateWord(word: string): string {
    if (word.startsWith('(concat "') && word.endsWith('")')) {
        return word;
    }
    if (word.includes("/") || word.includes(";") || word.includes("\\")) {
        const escaped = word
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\//g, "\\057")
            .replace(/;/g, "\\073");
        return `(concat "${escaped}")`;
    }
    return word;
}

/**
 * Escapes an annotation for SKK dictionary format.
 * If the annotation contains '/', escapes it using '\057' so that it does not terminate the candidate early.
 *
 * @param annotation Candidate annotation
 * @returns Escaped annotation string
 */
export function escapeAnnotation(annotation: string): string {
    if (annotation.includes("/")) {
        return annotation.replace(/\\/g, "\\\\").replace(/\//g, "\\057");
    }
    return annotation;
}

/**
 * Formats a Candidate object into a slash-separated candidate token.
 * Example: `word`, `word;annotation`, `(concat "DOS\057V")`
 *
 * @param candidate Candidate to format
 * @returns Formatted candidate token string
 */
export function formatCandidate(candidate: Candidate): string {
    const word = escapeCandidateWord(candidate.word);
    if (candidate.annotation) {
        const annot = escapeAnnotation(candidate.annotation);
        return `${word};${annot}`;
    }
    return word;
}

/**
 * Parses a single line from an SKK dictionary.
 * Format: midashigo /cand1;annotation1/cand2/cand3;annotation3/
 * Ignores empty lines and comment lines (starting with ';;').
 *
 * @param line Single line string
 * @returns Parsed JisyoEntry containing key and candidates, or undefined if invalid/comment/blank
 */
export function parseJisyoLine(line: string): JisyoEntry | undefined {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith(";;")) {
        return undefined;
    }

    const slashIdx = trimmed.indexOf("/");
    if (slashIdx <= 0) {
        return undefined;
    }

    const key = trimmed.slice(0, slashIdx).trim();
    if (key.length === 0) {
        return undefined;
    }

    const candsStr = trimmed.slice(slashIdx);
    if (!candsStr.startsWith("/")) {
        return undefined;
    }

    const inner = candsStr.endsWith("/") ? candsStr.slice(1, -1) : candsStr.slice(1);
    if (inner.length === 0) {
        return undefined;
    }

    const tokens = inner.split("/");
    const candidates: Candidate[] = [];

    for (const token of tokens) {
        if (token.length === 0) {
            continue;
        }

        const semiIdx = token.indexOf(";");
        let word: string;
        let annotation: string | undefined;

        if (semiIdx === -1) {
            word = token;
        } else {
            word = token.slice(0, semiIdx);
            const annot = token.slice(semiIdx + 1);
            annotation = annot.length > 0 ? annot : undefined;
        }

        word = unescapeCandidateWord(word);
        if (annotation) {
            annotation = unescapeAnnotation(annotation);
        }

        if (word.length === 0) {
            continue;
        }

        candidates.push(new Candidate(word, annotation));
    }

    if (candidates.length === 0) {
        return undefined;
    }

    return { key, candidates };
}

/**
 * Generates parsed entries from a multi-line dictionary string.
 *
 * @param text SKK dictionary text
 * @returns Generator yielding JisyoEntry for each valid line
 */
export function* parseJisyoLines(text: string): Generator<JisyoEntry> {
    const lines = text.split(/\r?\n|\r/);
    for (const line of lines) {
        const entry = parseJisyoLine(line);
        if (entry) {
            yield entry;
        }
    }
}

/**
 * Parses full SKK dictionary text into a Map of midashigo to Candidate lists.
 * If duplicate keys appear across lines, candidate lists are merged without duplicate words.
 *
 * @param text SKK dictionary text
 * @returns Map of midashigo to Candidate array
 */
export function parseJisyoText(text: string): Map<string, Candidate[]> {
    const map = new Map<string, Candidate[]>();
    for (const { key, candidates } of parseJisyoLines(text)) {
        const existing = map.get(key);
        if (existing) {
            for (const candidate of candidates) {
                const existingCand = existing.find((c) => c.word === candidate.word);
                if (!existingCand) {
                    existing.push(candidate);
                } else if (!existingCand.annotation && candidate.annotation) {
                    existingCand.annotation = candidate.annotation;
                }
            }
        } else {
            map.set(key, [...candidates]);
        }
    }
    return map;
}

/**
 * Parses an SKK dictionary from a raw buffer (Uint8Array).
 *
 * @param buffer Raw buffer data
 * @param encoding Optional character encoding ('utf-8', 'euc-jp', etc.)
 * @returns Map of midashigo to Candidate array
 */
export function parseJisyoBuffer(buffer: Uint8Array, encoding?: string): Map<string, Candidate[]> {
    const text = decodeJisyoBuffer(buffer, encoding);
    return parseJisyoText(text);
}

/**
 * Formats a key and its candidate list into a standard SKK dictionary line.
 * Format: midashigo /cand1;annotation1/cand2/
 *
 * @param key The dictionary key (midashigo)
 * @param candidates List of candidates
 * @returns Formatted SKK line
 */
export function formatJisyoLine(key: string, candidates: readonly Candidate[]): string {
    const candsStr = candidates.map((c) => formatCandidate(c)).join("/");
    return `${key} /${candsStr}/`;
}

/**
 * Formats dictionary entries into SKK dictionary text.
 *
 * @param entries Map or iterable of [key, candidates]
 * @returns Multi-line formatted SKK dictionary text
 */
export function formatJisyoText(entries: Iterable<[string, Candidate[]]>): string {
    const lines: string[] = [];
    for (const [key, candidates] of entries) {
        if (candidates.length > 0) {
            lines.push(formatJisyoLine(key, candidates));
        }
    }
    return lines.length > 0 ? lines.join("\n") + "\n" : "";
}
