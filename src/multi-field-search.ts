import { SearchEngine } from "./search";
import type { TokenizerOptions } from "./types";

/**
 * Multi-field search — the JS twin of the app-level SQL schema in
 * `test/multi-column-search.test.ts`.
 *
 *   SQL                              JS
 *   ─────────────────────────────    ──────────────────────────────────────
 *   one FTS table per field          one SearchEngine per field
 *   `_prefix` columns (app-filled)   SearchEngine prefixSearch (word starts)
 *   `SELECT … MATCH` UNION `… `      `search()` unions every field's hits
 *
 * Retrieval only — no ranking. ONE search engine per field, so a match can
 * never span fields: a doc is returned iff some SINGLE field contains every
 * query word (same-field AND, any order). This is exactly what a per-field
 * SQLite `MATCH` does, so SQL needs no post-filter and can paginate directly.
 *
 * `multiple` fields (e.g. keywords) are joined into that field's one engine,
 * so SQL must join the same values per doc.
 */

export interface MultiFieldSpec {
  /** Value is `string[]` (zero-to-many) instead of a single string. */
  multiple?: boolean;
}

export interface MultiFieldSearchConfig {
  /** Field name → spec. Field order is preserved. */
  fields: Record<string, MultiFieldSpec>;
  /** Tokenizer options. `prefixSearch` is always forced on. */
  tokenizer?: Partial<TokenizerOptions>;
}

/** A document: field name → value (string, or string[] when `multiple`). */
export type MultiFieldRecord = Record<
  string,
  string | readonly string[] | undefined
>;

interface FieldIndex {
  engine: SearchEngine;
  field: string;
}

export class MultiFieldSearch {
  private readonly indexes: FieldIndex[] = [];
  private readonly options: TokenizerOptions;

  constructor(private readonly config: MultiFieldSearchConfig) {
    this.options = {
      caseSensitive: false,
      removeDiacritics: 0,
      ...config.tokenizer,
      prefixSearch: true, // word-start 1-2 char "prefix column"
    };

    for (const field of Object.keys(config.fields)) {
      this.indexes.push({ engine: new SearchEngine(this.options), field });
    }
  }

  addDocument(docId: number, record: MultiFieldRecord): void {
    for (const { engine, field } of this.indexes) {
      engine.addDocument(docId, this.fieldText(field, record[field]));
    }
  }

  removeDocument(docId: number): void {
    for (const { engine } of this.indexes) engine.removeDocument(docId);
  }

  /** Empty every index so the search can be repopulated from scratch. */
  clear(): void {
    for (const { engine } of this.indexes) engine.clear();
  }

  /** Doc ids any single field matches. */
  search(query: string): number[] {
    const hits = new Array<number>();
    const seen = new Set<number>();
    for (const { engine } of this.indexes) {
      for (const docId of engine.search(query)) {
        if (!seen.has(docId)) {
          seen.add(docId);
          hits.push(docId);
        }
      }
    }
    return hits;
  }

  private fieldText(name: string, raw: MultiFieldRecord[string]): string {
    if (raw == null) return "";
    if (this.config.fields[name]!.multiple === true) {
      return (Array.isArray(raw) ? raw : [raw]).map(String).join(" ");
    }
    return Array.isArray(raw) ? raw.join(" ") : String(raw);
  }
}

/** Convenience factory — same as `new MultiFieldSearch(config)`. */
export function createMultiFieldSearch(
  config: MultiFieldSearchConfig
): MultiFieldSearch {
  return new MultiFieldSearch(config);
}
