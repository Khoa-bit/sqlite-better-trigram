import type { Token } from "./types";

/**
 * Inverted index mapping tokens → docIds → position arrays.
 *
 * Core structure:
 *   postings:  Map<token, Map<docId, number[]>>
 *   docs:      Map<docId, originalText>  — for post-filter verification
 *   docTokens: Map<docId, Set<token>>     — O(tokens_in_doc) removal
 */
export class InvertedIndex {
  private postings = new Map<string, Map<number, number[]>>();
  private docs = new Map<number, string>();
  private foldedDocs = new Map<number, string>();
  private docTokens = new Map<number, Set<string>>();

  // ── Mutation ──

  add(docId: number, tokens: Token[], originalText: string, foldedText?: string): void {
    this.docs.set(docId, originalText);
    this.foldedDocs.set(docId, foldedText ?? originalText);

    let tokenSet = this.docTokens.get(docId);
    if (!tokenSet) {
      tokenSet = new Set();
      this.docTokens.set(docId, tokenSet);
    }

    for (let pos = 0; pos < tokens.length; pos++) {
      const token = tokens[pos]!.text;
      tokenSet.add(token);

      let docMap = this.postings.get(token);
      if (!docMap) {
        docMap = new Map();
        this.postings.set(token, docMap);
      }
      let positions = docMap.get(docId);
      if (!positions) {
        positions = [];
        docMap.set(docId, positions);
      }
      positions.push(pos);
    }
  }

  remove(docId: number): void {
    const tokens = this.docTokens.get(docId);
    if (tokens) {
      for (const token of tokens) {
        const docMap = this.postings.get(token);
        if (docMap) {
          docMap.delete(docId);
          if (docMap.size === 0) {
            this.postings.delete(token);
          }
        }
      }
    }
    this.docTokens.delete(docId);
    this.docs.delete(docId);
    this.foldedDocs.delete(docId);
  }

  clear(): void {
    this.postings.clear();
    this.docs.clear();
    this.foldedDocs.clear();
    this.docTokens.clear();
  }

  // ── Query ──

  getPostings(token: string): Map<number, number[]> | undefined {
    return this.postings.get(token);
  }

  getDoc(docId: number): string | undefined {
    return this.docs.get(docId);
  }

  getFoldedDoc(docId: number): string | undefined {
    return this.foldedDocs.get(docId);
  }

  /** All doc IDs — used for fallback full-text scan. */
  getAllDocIds(): number[] {
    return Array.from(this.docs.keys());
  }

  /**
   * Intersect posting lists for multiple tokens.
   * Shortest-list-first optimization to minimize iterations.
   * Returns docIds that contain ALL tokens.
   */
  intersect(tokens: string[]): number[] {
    const lists: Map<number, number[]>[] = [];
    for (const token of tokens) {
      const list = this.postings.get(token);
      if (list) lists.push(list);
    }

    if (lists.length !== tokens.length) return [];

    if (lists.length === 0) return [];

    lists.sort((a, b) => a.size - b.size);
    const smallest = lists[0]!;
    const result: number[] = [];

    for (const docId of smallest.keys()) {
      let found = true;
      for (let i = 1; i < lists.length; i++) {
        if (!lists[i]!.has(docId)) {
          found = false;
          break;
        }
      }
      if (found) result.push(docId);
    }

    return result;
  }

  // ── Stats ──

  get docCount(): number {
    return this.docs.size;
  }

  get tokenCount(): number {
    return this.postings.size;
  }
}
