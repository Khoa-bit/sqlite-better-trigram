export interface TokenizerOptions {
  /** Fold case. Default false (case-insensitive). */
  caseSensitive: boolean;
  /**
   * Diacritic removal level.
   * 0 = none, 1 = basic (maps to same behavior as 2).
   * Cannot combine with caseSensitive=true.
   */
  removeDiacritics: number; // 0 | 1 | 2
}

export interface Token {
  /** Folded/stripped token text */
  text: string;
  /** Start code-unit offset in original input */
  startOffset: number;
  /** End code-unit offset in original input */
  endOffset: number;
}

export interface PostingEntry {
  docId: number;
  positions: number[];
}

export type PostingList = Map<number, number[]>;
