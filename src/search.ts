import { InvertedIndex } from "./inverted-index";
import { TrigramTokenizer } from "./tokenizer";
import type { TokenizerOptions } from "./types";
import { fold } from "./unicode";

/**
 * High-level search engine combining tokenizer + inverted index.
 *
 * index(docId, text)    — tokenize + store
 * removeDocument(docId)
 * search(query)         — substring search with post-filter
 * searchPhrase(phrase)  — phrase search with position adjacency check
 */
export class SearchEngine {
  readonly tokenizer: TrigramTokenizer;
  readonly index: InvertedIndex;

  constructor(options?: Partial<TokenizerOptions>) {
    this.tokenizer = new TrigramTokenizer(options);
    this.index = new InvertedIndex();
  }

  // ── Indexing ──

  addDocument(docId: number, text: string): void {
    const tokens = this.tokenizer.tokenize(text);
    this.index.add(docId, tokens, text);
  }

  removeDocument(docId: number): void {
    this.index.remove(docId);
  }

  // ── Substring search ──

  /**
   * Search for documents containing `query` as a substring.
   *
   * 1. Tokenize query → trigrams
   * 2. Intersect posting lists
   * 3. Post-filter: verify folded original text contains folded query
   */
  search(query: string): number[] {
    if (query.length === 0) return [];

    const queryTokens = this.tokenizer.tokenize(query);
    const tokenTexts = queryTokens.map((t) => t.text);

    // No trigrams from query (e.g. all-whitespace query)
    if (tokenTexts.length === 0) return [];

    const candidates = this.index.intersect(tokenTexts);

    const foldedQuery = fold(query, this.tokenizer.options);

    // If index returned candidates, post-filter them
    if (candidates.length > 0) {
      return candidates.filter((docId) => {
        const doc = this.index.getDoc(docId);
        return (
          doc !== undefined &&
          fold(doc, this.tokenizer.options).includes(foldedQuery)
        );
      });
    }

    // Fallback: full-text scan when index can't handle query
    // (e.g. cross-word-boundary substrings like "lo wo" in "hello world")
    return this.index.getAllDocIds().filter((docId) => {
      const doc = this.index.getDoc(docId);
      return (
        doc !== undefined &&
        fold(doc, this.tokenizer.options).includes(foldedQuery)
      );
    });
  }

  // ── Phrase search ──

  /**
   * Search for documents where `phrase` words appear consecutively and in order.
   *
   * 1. Tokenize phrase → tokens with positions
   * 2. Intersect posting lists
   * 3. Post-filter: verify tokens appear at adjacent positions
   */
  searchPhrase(phrase: string): number[] {
    if (phrase.length === 0) return [];

    const phraseTokens = this.tokenizer.tokenize(phrase);
    const tokenTexts = phraseTokens.map((t) => t.text);

    if (tokenTexts.length === 0) return [];

    const candidates = this.index.intersect(tokenTexts);

    return candidates.filter((docId) =>
      this.verifyPhrasePositions(docId, tokenTexts)
    );
  }

  /**
   * Check that phrase tokens appear at consecutive positions in the document.
   *
   * Algorithm: iterative candidate-set narrowing.
   * - Start with positions of first token
   * - For each subsequent token, keep only positions (previous+1)
   * - If any set empties → false
   */
  private verifyPhrasePositions(
    docId: number,
    tokenTexts: string[],
  ): boolean {
    // Build array of position arrays
    const positionsPerToken: number[][] = [];
    for (const token of tokenTexts) {
      const postings = this.index.getPostings(token);
      const positions = postings?.get(docId);
      if (!positions || positions.length === 0) return false;
      positionsPerToken.push(positions);
    }

    // Narrow candidates iteratively
    let candidates = new Set(positionsPerToken[0]);
    for (let i = 1; i < positionsPerToken.length; i++) {
      const next = new Set<number>();
      const targetPositions = positionsPerToken[i];
      for (const pos of candidates) {
        if (targetPositions!.includes(pos + 1)) {
          next.add(pos + 1);
        }
      }
      if (next.size === 0) return false;
      candidates = next;
    }
    return true;
  }
}
