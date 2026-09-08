import type { Candidate } from "../../core/skk/jisyo/candidate";
import { parseJisyoText } from "../../core/skk/jisyo/JisyoParser";

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
