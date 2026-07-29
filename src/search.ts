import { InvertedIndex } from "./inverted-index";
import { TrigramTokenizer } from "./tokenizer";
import { TokenKind, type Token, type TokenizerOptions } from "./types";
import { fold, isWhitespace } from "./unicode";

/**
 * High-level search engine combining tokenizer + inverted index.
 *
 * ── Architecture ──
 *
 * Three layers:
 *   TrigramTokenizer  →  InvertedIndex(es)  →  SearchEngine
 *
 * 1. **TrigramTokenizer** (src/tokenizer.ts) — char-by-char sliding window
 *    over text. Emits 3-char trigrams. Word boundaries = whitespace + CJK
 *    only. Hyphens, punctuation, etc. do NOT break words — they become
 *    part of trigrams (e.g. "a-" is a valid token).
 *
 * 2. **InvertedIndex** (src/inverted-index.ts) —
 *    Map<token, Map<docId, position[]>>. Each token maps to docs
 *    containing it, with positional info for phrase search. Supports
 *    intersect(tokens) for AND semantics and remove(docId) for cleanup.
 *
 * 3. **SearchEngine** — orchestrates tokenizer + one or two inverted
 *    indexes depending on whether prefixSearch is enabled.
 *
 * ── Two Modes ──
 *
 * **Without prefixSearch** (default)
 * ──────────────────────────────────
 * Single trigramIndex. All tokens (trigrams + partials) go there.
 *
 * Query flow:
 *   1. Tokenize query → trigram tokens
 *   2. trigramIndex.intersect(trigrams) → candidate docIds
 *   3. Post-filter: verify folded query appears as substring in folded
 *      document text
 *   4. If intersection empty, fallback to full-text scan (handles
 *      cross-word substrings like "lo wo" in "hello world")
 *
 * **With prefixSearch** (enabled)
 * ────────────────────────────────
 * Two indexes: trigramIndex + prefixIndex. The tokenizer emits BOTH
 * prefix tokens (1-2 char word-start markers) and trigram tokens from
 * the same text. Prefix tokens go to prefixIndex, trigrams to trigramIndex.
 *
 * Purpose: enables fast single-character and two-character queries
 * ("h", "he") via prefix index, avoiding full-text scan fallback.
 *
 * Example — tokenizing "arrow" with prefixSearch:
 *   'a'  → Prefix("a")     [word start, count=1 → 1-char prefix]
 *   'r'  → Prefix("ar")    [word start, count=2 → 2-char prefix]
 *   'r'  → Trigram("arr")  [count=3 → full trigram, buf= "rr"]
 *   'o'  → Trigram("rro")
 *   'w'  → Trigram("row")
 *   EOF  → Trigram("ow")   [flush partial]
 *
 * Example — tokenizing "a-arrow-down" with prefixSearch:
 *   Prefix:  "a", "a-"
 *   Trigram: "a-a", "-ar", "arr", "rro", "row", "ow-", "w-d",
 *            "-do", "dow", "own"
 *   (Hyphens don't break word boundaries, so the whole string is
 *    one word. The 2-char prefix is "a-", not "ar".)
 *
 * Query routing in searchWithPrefix():
 *   - Trigram tokens (≥3 chars) → trigram index (standard path)
 *   - Prefix tokens at word boundary/EOF → prefix index (exact word-start)
 *   - Prefix tokens mid-word → SKIPPED (see bug note below)
 *   - Intersect results from both indexes (AND semantics)
 *
 * ── Important: Mid-word Prefix Artifacts ──
 *
 * When a query word is 3+ characters (e.g. "arrow"), the tokenizer emits
 * prefix tokens "a" and "ar" followed by trigrams "arr", "rro", "row".
 * The prefix tokens "a" and "ar" are **artifacts** — they represent the
 * first 1-2 chars of a longer word, not independent short search terms.
 *
 * These artifacts must NOT be sent to the prefix index as independent
 * filters. Consider:
 *   Doc 5: "a-arrow-down" → Prefix("a"), Prefix("a-"), ...
 *   Doc 6: "arrow-up"    → Prefix("a"), Prefix("ar"), ...
 *
 * Query "arrow" → prefix tokens "a", "ar":
 *   prefixIndex.intersect(["a", "ar"]) = [6]  (doc 5 excluded:
 *   its 2-char prefix is "a-" not "ar")
 *   trigramIndex.intersect(["arr","rro","row"]) = [5, 6]
 *   Intersection = [6]  ← WRONG, should be [5, 6]
 *
 * Fix: skip prefix tokens whose next character in the query is
 * non-whitespace (mid-word). Only genuine 1-2 char query words
 * (at whitespace/EOF) reach the prefix index.
 *
 * ── Substring vs. Prefix Semantics ──
 *
 * The prefix index stores ONLY word-start prefixes. Searching for "ar"
 * in prefix index means "documents with a word starting with 'ar'".
 * This is different from trigram substring search where "ar" matches
 * anywhere in a word. This intentional tradeoff means 1-2 char queries
 * using prefixSearch are word-start-only, not arbitrary substrings.
 *
 * ── Phrase Search ──
 *
 * searchPhrase() verifies that phrase tokens appear at consecutive
 * positions in the document. Uses iterative candidate-set narrowing:
 * start with positions of first token, keep only positions where
 * each subsequent token is at prev_position + 1.
 *
 * With prefixSearch, if any token is < 3 chars (a genuinely short word),
 * phrase search falls back to substring search because prefix tokens
 * lack the ordered position data needed for adjacency checks.
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
    // (e.g. cross-word-boundary substrings like "lo wo" in "hello world").
    //
    // With prefixSearch: if no token has postings, it's a certain miss.
    // Without prefixSearch: always try the scan (short queries like "he"
    // have no trigram postings but may still match via substring scan).
    if (!this.prefixIndex || this.trigramIndex.hasAnyPosting(tokenTexts)) {
      return this.trigramIndex.getAllDocIds().filter((docId) => {
        const doc = this.trigramIndex.getFoldedDoc(docId);
        return (
          doc !== undefined &&
          doc.includes(foldedQuery)
        );
      });
    }
    return [];
  }

  /**
   * Search with dual-index routing (prefixSearch enabled).
   *
   * Tokens are routed to either prefixIndex or trigramIndex depending on
   * kind and length. Critically, prefix tokens that are mid-word artifacts
   * (e.g. "a" from "arrow") are SKIPPED — they come from the first 1-2
   * chars of a 3+ char word and would produce incorrect intersection
   * results when the document's prefix differs (e.g. "a-arrow-down" has
   * prefix "a-" not "ar").
   *
   * Routing rules:
   *   - Trigram tokens (≥3 chars) → trigram index (standard path)
   *   - Prefix tokens at word boundary/EOF → prefix index (exact word-start)
   *   - Prefix tokens mid-word → SKIP (artifacts of longer words)
   *   - Partial trigram tokens (<3 chars, EOF flush) → prefix index
   *
   * Post-filter is skipped for prefix-index results because the prefix
   * index is already exact (word-starts only). For mixed queries the
   * intersection of prefix + trigram results is likewise correct.
   *
   * When all tokens route to trigram index (no genuine short tokens),
   * delegates to searchWithTrigram for standard trigram + post-filter.
   *
   * Full-text scan fallback handles cross-word substrings like "lo wo".
   */
  private searchWithPrefix(query: string, queryTokens: Token[]): number[] {
    const shortTokens: string[] = [];
    const longTokens: string[] = [];
    let hasShort = false;

    for (const t of queryTokens) {
      // Skip prefix tokens that fall mid-word in the query — they are
      // artifacts of tokenizing a longer word (e.g. "a" from "arrow").
      // Only genuine short-word prefixes (at whitespace or EOF) are used.
      if (t.kind === TokenKind.Prefix && this.isMidWordPrefix(query, t)) {
        continue;
      }
      // Route by token kind: trigrams → trigram index, prefixes → prefix index
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
    // Only if at least one token has postings — otherwise it's a certain miss.
    if (this.trigramIndex.hasAnyPosting(longTokens) || this.prefixIndex?.hasAnyPosting(shortTokens)) {
      const foldedQuery = fold(query, this.tokenizer.options);
      return this.trigramIndex.getAllDocIds().filter((docId) => {
        const doc = this.trigramIndex.getFoldedDoc(docId);
        return (
          doc !== undefined &&
          doc.includes(foldedQuery)
        );
      });
    }
    return [];
  }

  /**
   * Check if a prefix token is mid-word in the query, i.e. the next
   * character after the prefix is non-whitespace and exists.
   *
   * Mid-word prefix tokens are artifacts of tokenizing longer words.
   * For example, query "arrow" produces Prefix("a") and Prefix("ar"),
   * but both fall mid-word (next chars "r", "r") → they are skipped.
   * In contrast, query "h wo" produces Prefix("h") at endOffset=1
   * where query[1] = ' ' → not mid-word → used for prefix lookup.
   */
  private isMidWordPrefix(query: string, token: Token): boolean {
    const nextChar = query[token.endOffset];
    return nextChar !== undefined && !isWhitespace(nextChar.codePointAt(0)!);
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
