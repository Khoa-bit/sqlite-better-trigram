export interface TokenizerOptions {
  /** Fold case. Default false (case-insensitive). */
  caseSensitive: boolean;
  /**
   * Diacritic removal level.
   * 0 = none, 1 = basic (maps to same behavior as 2).
   * Cannot combine with caseSensitive=true.
   */
  removeDiacritics: number; // 0 | 1 | 2
  /**
   * Enable 1-letter and 2-letter prefix token generation.
   * When true, tokenizer emits extra prefix tokens per word,
   * enabling fast prefix search for short queries (< 3 chars).
   * Default false.
   */
  prefixSearch?: boolean;
}

/** String constants for Token.kind — guarantees single reference, reduces memory. */
export const TokenKind = {
  Trigram: 'trigram',
  Prefix: 'prefix',
} as const;

export type TokenKind = (typeof TokenKind)[keyof typeof TokenKind];

export interface Token {
  /** Folded/stripped token text */
  text: string;
  /** Start code-unit offset in original input */
  startOffset: number;
  /** End code-unit offset in original input */
  endOffset: number;
  /** Token kind for routing: trigram or prefix. */
  kind: TokenKind;
}

export interface PostingEntry {
  docId: number;
  positions: number[];
}

export type PostingList = Map<number, number[]>;
