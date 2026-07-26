import { InvertedIndex } from "./inverted-index";
import { TrigramTokenizer } from "./tokenizer";
import { TokenKind, type Token, type TokenizerOptions } from "./types";
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
  readonly trigramIndex: InvertedIndex;
  readonly prefixIndex?: InvertedIndex;

  constructor(options?: Partial<TokenizerOptions>) {
    this.tokenizer = new TrigramTokenizer(options);
    this.trigramIndex = new InvertedIndex();
    if (this.tokenizer.options.prefixSearch) {
      this.prefixIndex = new InvertedIndex();
    }
  }

  // ── Indexing ──

  addDocument(docId: number, text: string): void {
    const tokens = this.tokenizer.tokenize(text);
    const foldedText = fold(text, this.tokenizer.options);
    if (this.prefixIndex) {
      const trigramTokens: Token[] = [];
      const prefixTokens: Token[] = [];
      for (const t of tokens) {
        if (t.kind === TokenKind.Prefix) prefixTokens.push(t);
        else trigramTokens.push(t);
      }
      this.trigramIndex.add(docId, trigramTokens, text, foldedText);
      this.prefixIndex.add(docId, prefixTokens, text, foldedText);
    } else {
      this.trigramIndex.add(docId, tokens, text, foldedText);
    }
  }

  removeDocument(docId: number): void {
    this.trigramIndex.remove(docId);
    this.prefixIndex?.remove(docId);
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

    // No tokens from query (e.g. all-whitespace query)
    if (tokenTexts.length === 0) return [];

    if (this.prefixIndex) {
      return this.searchWithPrefix(query, queryTokens);
    }

    return this.searchWithTrigram(query, tokenTexts);
  }



  /**
   * Search using single trigram index (prefixSearch disabled).
   */
  private searchWithTrigram(query: string, tokenTexts: string[]): number[] {
    const candidates = this.trigramIndex.intersect(tokenTexts);
    const foldedQuery = fold(query, this.tokenizer.options);

    if (candidates.length > 0) {
      return candidates.filter((docId) => {
        const doc = this.trigramIndex.getFoldedDoc(docId);
        return (
          doc !== undefined &&
          doc.includes(foldedQuery)
        );
      });
    }

    // Fallback: full-text scan when index can't handle query
    // (e.g. cross-word-boundary substrings like "lo wo" in "hello world")
    return this.trigramIndex.getAllDocIds().filter((docId) => {
      const doc = this.trigramIndex.getFoldedDoc(docId);
      return (
        doc !== undefined &&
        doc.includes(foldedQuery)
      );
    });
  }

  /**
   * Search with dual-index routing (prefixSearch enabled).
   * Tokens < 3 chars → prefix index. Tokens ≥ 3 chars → trigram index.
   *
   * Post-filter is skipped for prefix-index results because the prefix
   * index is already exact (word-starts only). For mixed queries the
   * intersection of prefix + trigram results is likewise correct.
   *
   * For single-token queries that went through the trigram path and
   * returned nothing, fall back to full-text scan (handles cross-word
   * substrings like "lo wo").
   */
  private searchWithPrefix(query: string, queryTokens: Token[]): number[] {
    const shortTokens: string[] = [];
    const longTokens: string[] = [];
    let hasShort = false;

    for (const t of queryTokens) {
      if (t.text.length < 3) {
        shortTokens.push(t.text);
        hasShort = true;
      } else {
        longTokens.push(t.text);
      }
    }

    let shortCandidates: number[] | undefined;
    let longCandidates: number[] | undefined;

    if (shortTokens.length > 0) {
      shortCandidates = this.prefixIndex!.intersect(shortTokens);
    }
    if (longTokens.length > 0) {
      longCandidates = this.trigramIndex.intersect(longTokens);
    }

    // Combine results from both indices
    let candidates: number[];
    if (shortCandidates !== undefined && longCandidates !== undefined) {
      const shortSet = new Set(shortCandidates);
      candidates = longCandidates.filter((d) => shortSet.has(d));
    } else if (shortCandidates !== undefined) {
      candidates = shortCandidates;
    } else {
      candidates = longCandidates!;
    }

    // All tokens >= 3 chars: delegate to standard trigram path.
    if (!hasShort) return this.searchWithTrigram(query, longTokens);

    // Mixed query with short tokens: skip post-filter.
    // Prefix index is exact (word-starts only), not substring.
    // Intersection of prefix + trigram results is semantically correct.
    if (candidates.length > 0) return candidates;

    // Full-text scan fallback for cross-word substrings.
    const foldedQuery = fold(query, this.tokenizer.options);
    return this.trigramIndex.getAllDocIds().filter((docId) => {
      const doc = this.trigramIndex.getFoldedDoc(docId);
      return (
        doc !== undefined &&
        doc.includes(foldedQuery)
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

    if (this.prefixIndex) {
      return this.searchPhraseWithPrefix(phrase, phraseTokens);
    }

    const candidates = this.trigramIndex.intersect(tokenTexts);
    return candidates.filter((docId) =>
      this.verifyPhrasePositions(docId, tokenTexts)
    );
  }

  /**
   * Phrase search with prefix routing.
   * If any token is < 3 chars, fall back to substring post-filter
   * (prefix tokens lack ordered positions for adjacency checks).
   */
  private searchPhraseWithPrefix(phrase: string, phraseTokens: Token[]): number[] {
    const hasShortToken = phraseTokens.some((t) => t.text.length < 3);
    if (hasShortToken) {
      // Fall back to substring search for short-token phrases
      return this.search(phrase);
    }

    const tokenTexts = phraseTokens.map((t) => t.text);
    const candidates = this.trigramIndex.intersect(tokenTexts);
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
      const postings = this.trigramIndex.getPostings(token);
      const positions = postings?.get(docId);
      if (!positions || positions.length === 0) return false;
      positionsPerToken.push(positions);
    }

    // Narrow candidates iteratively
    let candidates = new Set(positionsPerToken[0]);
    for (let i = 1; i < positionsPerToken.length; i++) {
      const next = new Set<number>();
      const targetSet = new Set(positionsPerToken[i]);
      for (const pos of candidates) {
        if (targetSet.has(pos + 1)) {
          next.add(pos + 1);
        }
      }
      if (next.size === 0) return false;
      candidates = next;
    }
    return true;
  }
}
