import type { Token, TokenizerOptions } from "./types";
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
    const result: Token[] = [];
    const buf: string[] = new Array(3);
    const starts: number[] = new Array(3);
    let bufStart = 0;
    let count = 0;
    let isPartial = false;
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
        result.push(this.emitToken(buf, starts, bufStart, 3, startOff));
        bufStart = (bufStart + 1) % 3;
        count = 2;
        isPartial = true;
      }

      // ── Word boundaries ──
      if (isSpace || isCjk) {
        // Flush partial word (< 3 chars) if not already at end-of-word
        if (!isPartial && count > 0 && count < 3) {
          result.push(this.emitToken(buf, starts, bufStart, count, startOff));
        }

        if (isCjk) {
          result.push({
            text: foldedChar,
            startOffset: startOff,
            endOffset: offset,
          });
        }

        // Reset buffer
        bufStart = 0;
        count = 0;
        isPartial = false;
        continue;
      }

      // ── Add char to trigram buffer ──
      starts[(bufStart + count) % 3] = startOff;
      buf[(bufStart + count) % 3] = foldedChar;
      count++;
    }

    // ── Flush remaining tokens ──
    if (count > 0) {
      result.push(this.emitToken(buf, starts, bufStart, count, offset));
    }

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
    let text = "";
    for (let i = 0; i < count; i++) {
      text += buf[(bufStart + i) % 3];
    }
    return { text, startOffset: starts[bufStart]!, endOffset };
  }
}
