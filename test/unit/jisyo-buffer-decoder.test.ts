import { describe, it, expect } from "vitest";
import { decodeJisyoBuffer, parseJisyoBuffer } from "../../src/storage/jisyo/JisyoBufferDecoder";

describe("JisyoBufferDecoder", () => {
    describe("decodeJisyoBuffer & parseJisyoBuffer", () => {
        it("parses UTF-8 buffer without explicit encoding (auto-detected)", () => {
            const text = "とうきょう /東京/\nにほん /日本;にほん/\n";
            const buffer = new TextEncoder().encode(text);
            const map = parseJisyoBuffer(buffer);

            expect(map.size).toBe(2);
            expect(map.get("とうきょう")?.[0]?.word).toBe("東京");
            expect(map.get("にほん")?.[0]?.annotation).toBe("にほん");
        });

        it("parses UTF-8 buffer with explicit 'utf-8' encoding", () => {
            const text = "かんじ /漢字/\n";
            const buffer = new TextEncoder().encode(text);
            const map = parseJisyoBuffer(buffer, "utf-8");

            expect(map.size).toBe(1);
            expect(map.get("かんじ")?.[0]?.word).toBe("漢字");
        });

        it("parses EUC-JP buffer with auto-detection fallback", () => {
            // とうきょう /東京/\n in EUC-JP encoding
            const eucJpBytes = new Uint8Array([
                0xa4, 0xc8, 0xa4, 0xa6, 0xa4, 0xad, 0xa4, 0xe7, 0xa4, 0xa6, // とうきょう
                0x20, 0x2f,                                                   // " /"
                0xc5, 0xec, 0xb5, 0xfe,                                       // 東京
                0x2f, 0x0a                                                    // "/\n"
            ]);

            const map = parseJisyoBuffer(eucJpBytes);
            expect(map.size).toBe(1);
            expect(map.has("とうきょう")).toBe(true);
            expect(map.get("とうきょう")?.[0]?.word).toBe("東京");
        });

        it("parses EUC-JP buffer with explicit 'euc-jp' encoding", () => {
            const eucJpBytes = new Uint8Array([
                0xa4, 0xc8, 0xa4, 0xa6, 0xa4, 0xad, 0xa4, 0xe7, 0xa4, 0xa6, // とうきょう
                0x20, 0x2f,                                                   // " /"
                0xc5, 0xec, 0xb5, 0xfe,                                       // 東京
                0x2f, 0x0a                                                    // "/\n"
            ]);

            const map = parseJisyoBuffer(eucJpBytes, "euc-jp");
            expect(map.size).toBe(1);
            expect(map.get("とうきょう")?.[0]?.word).toBe("東京");
        });

        it("gracefully falls back when an invalid encoding string is provided", () => {
            const text = "てすと /テスト/\n";
            const buffer = new TextEncoder().encode(text);
            const map = parseJisyoBuffer(buffer, "non-existent-encoding-xyz");

            expect(map.size).toBe(1);
            expect(map.get("てすと")?.[0]?.word).toBe("テスト");
        });

        it("returns empty map for empty buffer", () => {
            const emptyBuffer = new Uint8Array(0);
            const map = parseJisyoBuffer(emptyBuffer);
            expect(map.size).toBe(0);
        });

        it("decodes buffer with decodeJisyoBuffer directly", () => {
            const text = "てすと /テスト/";
            const buffer = new TextEncoder().encode(text);
            expect(decodeJisyoBuffer(buffer)).toBe(text);
        });
    });
});
