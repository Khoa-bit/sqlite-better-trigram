import { TokenKind, type Token, type TokenizerOptions } from "./types";
import { isCJK, isWhitespace, foldChar, validateOptions } from "./unicode";

const DEFAULT_OPTIONS: TokenizerOptions = {
  caseSensitive: false,
  removeDiacritics: 0,
};

export class TrigramTokenizer {
  readonly options: TokenizerOptions;

  constructor(options?: Partial<TokenizerOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    validateOptions(this.options);
  }

  /**
   * Tokenize text into trigrams and partial words.
   *
   * Algorithm mirrors C tokenize() in tokenizer.c:
   * - Iterate codepoints via for...of (handles surrogate pairs)
   * - Sliding 3-char ring buffer for trigram emission
   * - Word boundaries on whitespace → emit partials, reset
   * - CJK chars emitted as single tokens
   * - Case folding per-char; diacritic removal on final token text
   */
  tokenize(text: string): Token[] {
    const estimatedTokens = Math.ceil(text.length / 2);
    const result: Token[] = new Array(estimatedTokens);
    let resultIdx = 0;
    const buf: string[] = new Array(3);
    const starts: number[] = new Array(3);
    let bufStart = 0;
    let count = 0;
    let isPartial = false;
    let atWordStart = true;
    let offset = 0;

    for (const char of text) {
      const codepoint = char.codePointAt(0)!;
      const charLen = char.length;
      const startOff = offset;
      offset += charLen;

      // Fold per-character (case + diacritics), skip folds-to-nothing (C do-while)
      const foldedChar = foldChar(char, this.options);
      if (!foldedChar) continue;

      const isSpace = isWhitespace(codepoint);
      const isCjk = isCJK(codepoint);

      // ── Emit full trigram if buffer full ──
      if (count === 3) {
        result[resultIdx++] = this.emitToken(buf, starts, bufStart, 3, startOff);
        bufStart = (bufStart + 1) % 3;
        count = 2;
        isPartial = true;
        atWordStart = false;
      }

      // ── Word boundaries ──
      if (isSpace || isCjk) {
        // Flush partial word (< 3 chars) if not already at end-of-word
        if (!isPartial && count > 0 && count < 3) {
          result[resultIdx++] = this.emitToken(buf, starts, bufStart, count, startOff);
        }

        if (isCjk) {
          result[resultIdx++] = {
            text: foldedChar,
            startOffset: startOff,
            endOffset: offset,
            kind: this.options.prefixSearch ? TokenKind.Prefix : TokenKind.Trigram,
          };
        }

        // Reset buffer
        bufStart = 0;
        count = 0;
        isPartial = false;
        atWordStart = true;
        continue;
      }

      // ── Add char to trigram buffer ──
      starts[(bufStart + count) % 3] = startOff;
      buf[(bufStart + count) % 3] = foldedChar;
      count++;

      // ── Emit 1-char and 2-char prefix tokens at word start ──
      if (this.options.prefixSearch && atWordStart) {
        if (count === 1) {
          result[resultIdx++] = {
            text: buf[(bufStart + 0) % 3]!,
            startOffset: starts[(bufStart + 0) % 3]!,
            endOffset: offset,
            kind: TokenKind.Prefix,
          };
        } else if (count === 2) {
          result[resultIdx++] = {
            text: buf[(bufStart + 0) % 3]! + buf[(bufStart + 1) % 3]!,
            startOffset: starts[(bufStart + 0) % 3]!,
            endOffset: offset,
            kind: TokenKind.Prefix,
          };
        }
      }
    }

    // ── Flush remaining tokens ──
    if (count > 0) {
      result[resultIdx++] = this.emitToken(buf, starts, bufStart, count, offset);
    }

    result.length = resultIdx;
    return result;
  }

  /**
   * Build a Token from the ring buffer.
   */
  private emitToken(
    buf: string[],
    starts: number[],
    bufStart: number,
    count: number,
    endOffset: number,
  ): Token {
    const i0 = bufStart % 3;
    const text = count === 1
      ? buf[i0]!
      : count === 2
        ? buf[i0]! + buf[(bufStart + 1) % 3]!
        : buf[i0]! + buf[(bufStart + 1) % 3]! + buf[(bufStart + 2) % 3]!;
    return { text, startOffset: starts[bufStart]!, endOffset, kind: TokenKind.Trigram };
  }
}
