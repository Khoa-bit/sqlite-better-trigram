import { SearchEngine } from "./search";
import type { TokenizerOptions } from "./types";
import { fold } from "./unicode";

/**
 * Generic tiered multi-field search.
 *
 * Ranking is NOT bm25 (noisy with trigram tokenizers); it is an explicit,
 * CLIENT-DEFINED tier ladder — the rule at index i is tier i + 1, and a lower
 * tier always outranks a higher one.
 *
 * Usage:
 *
 *   const search = createTieredSearch({
 *     fields: {
 *       title:       {},                        // single string
 *       tags:        { multiple: true },        // string[]
 *       description: { group: "content" },      // shares an index with title
 *     },
 *     tiers: [
 *       { field: "title",       match: "exact"    },  // tier 1
 *       { field: "title",       match: "prefix"   },  // tier 2
 *       { field: "tags",        match: "exact"    },  // tier 3
 *       { field: "title",       match: "contains" },  // tier 4
 *       { field: "tags",        match: "contains" },  // tier 5
 *       { field: "description", match: "contains" },  // tier 6
 *     ],
 *   });
 *   search.addDocument(1, { title: "arrow", tags: ["icon"] });
 *   search.search("arrow");   // [{ docId: 1, tier: 1 }]
 *
 * ── How retrieval works ──
 *
 * Fields are grouped by `group` (default: the field's own name). Each group
 * becomes one `SearchEngine` over the group's values joined by spaces, so a
 * multi-word query can span fields that share a group. Field values that are
 * `multiple` are joined into their group. `group: ""` keeps a field rankable
 * but unindexed (it can never be a retrieval candidate).
 *
 * Every index runs with `prefixSearch: true`, so each word also emits 1-2 char
 * word-start prefix tokens — the app-level "prefix column" trick. 1-2 char
 * queries therefore hit the prefix index instead of a full scan. Tradeoff:
 * short queries are word-start only.
 *
 * Retrieval unions the candidate doc ids from every index; ranking is then
 * computed from the stored raw fields (so `match: "exact"` on a `multiple`
 * field means "some value === query" — which a concatenated index could not
 * express).
 *
 * Unranked (tier 0) candidates — no rule matches, e.g. a match that only spans
 * two fields sharing an index — are dropped.
 */

export type MatchKind = "exact" | "prefix" | "contains";

export interface TieredFieldSpec {
  /**
   * Value is `string[]` (zero-to-many) instead of a single string. The
   * `exact` / `prefix` / `contains` rules then match if ANY value matches.
   */
  multiple?: boolean;
  /**
   * Retrieval group. Fields sharing a group are concatenated into ONE search
   * index (needed so a multi-word query can span them). Defaults to the field
   * name, i.e. one index per field. Use `""` to keep the field rankable but
   * unindexed.
   */
  group?: string;
}

export interface TierRule {
  /** Field name from `config.fields`. */
  field: string;
  /** How to compare the (folded) query against the (folded) field value. */
  match: MatchKind;
}

export interface TieredSearchConfig {
  /** Field name → spec. Field order is preserved. */
  fields: Record<string, TieredFieldSpec>;
  /** Ordered rules; rule at index `i` becomes tier `i + 1`. */
  tiers: readonly TierRule[];
  /** Tokenizer options. `prefixSearch` is always forced on. */
  tokenizer?: Partial<TokenizerOptions>;
}

/** A document: field name → value (single string, or string[] when multiple). */
export type TieredRecord = Record<string, string | readonly string[] | undefined>;

export interface TieredHit {
  docId: number;
  /** Tier number (1-based); tier 0 candidates are never returned. */
  tier: number;
}

function matches(value: string, kind: MatchKind, query: string): boolean {
  switch (kind) {
    case "exact":
      return value === query;
    case "prefix":
      return value.startsWith(query);
    case "contains":
      return value.includes(query);
  }
}

interface IndexGroup {
  engine: SearchEngine;
  fields: string[];
}

export class TieredSearch {
  private readonly fieldNames: string[];
  private readonly indexGroups: IndexGroup[] = [];
  private readonly tierRules: readonly TierRule[];
  private readonly options: TokenizerOptions;
  private readonly docs = new Map<
    number,
    Record<string, string | readonly string[]>
  >();

  constructor(private readonly config: TieredSearchConfig) {
    this.fieldNames = Object.keys(config.fields);
    this.tierRules = config.tiers;
    this.options = {
      caseSensitive: false,
      removeDiacritics: 0,
      ...config.tokenizer,
      prefixSearch: true, // supplies the app-level prefix "column"
    };

    // Group fields → one SearchEngine per group.
    const groups = new Map<string, string[]>();
    for (const name of this.fieldNames) {
      const spec = config.fields[name]!;
      if (spec.group === "") continue; // rankable but not indexed
      const group = spec.group ?? name;
      const list = groups.get(group);
      if (list) list.push(name);
      else groups.set(group, [name]);
    }
    for (const fields of groups.values()) {
      this.indexGroups.push({ engine: new SearchEngine(this.options), fields });
    }
  }

  // ── Indexing ──

  addDocument(docId: number, record: TieredRecord): void {
    const norm = this.normalize(record);
    this.docs.set(docId, norm);

    for (const { engine, fields } of this.indexGroups) {
      const parts: string[] = [];
      for (const field of fields) {
        const value = norm[field]!;
        parts.push(typeof value === "string" ? value : value.join(" "));
      }
      engine.addDocument(docId, parts.join(" "));
    }
  }

  removeDocument(docId: number): void {
    for (const { engine } of this.indexGroups) engine.removeDocument(docId);
    this.docs.delete(docId);
  }

  // ── Query ──

  /** Documents ranked by tier (ascending), then docId. Tier 0 is dropped. */
  search(query: string): TieredHit[] {
    if (fold(query, this.options).length === 0) return [];

    const hits: TieredHit[] = [];
    for (const docId of this.candidates(query)) {
      const tier = this.tierOf(docId, query);
      if (tier > 0) hits.push({ docId, tier });
    }

    hits.sort((a, b) => a.tier - b.tier || a.docId - b.docId);
    return hits;
  }

  /** The tier a document would receive for `query` (0 = unranked). */
  tierOf(docId: number, query: string): number {
    const doc = this.docs.get(docId);
    const q = fold(query, this.options);
    if (!doc || q.length === 0) return 0;

    for (let i = 0; i < this.tierRules.length; i++) {
      const rule = this.tierRules[i]!;
      const value = doc[rule.field];
      if (value === undefined) continue;
      const values = typeof value === "string" ? [value] : value;
      for (const v of values) {
        if (matches(fold(v, this.options), rule.match, q)) return i + 1;
      }
    }
    return 0;
  }

  /** Raw candidate doc ids from the indexes, before tiering. */
  candidates(query: string): number[] {
    const set = new Set<number>();
    for (const { engine } of this.indexGroups) {
      for (const docId of engine.search(query)) set.add(docId);
    }
    return [...set];
  }

  // ── Internals ──

  private normalize(
    record: TieredRecord
  ): Record<string, string | readonly string[]> {
    const out: Record<string, string | readonly string[]> = {};
    for (const name of this.fieldNames) {
      const raw = record[name];
      const multiple = this.config.fields[name]!.multiple === true;
      if (multiple) {
        out[name] =
          raw == null ? [] : (Array.isArray(raw) ? raw : [raw]).map(String);
      } else {
        out[name] =
          raw == null
            ? ""
            : Array.isArray(raw)
              ? raw.join(" ")
              : String(raw);
      }
    }
    return out;
  }
}

/** Convenience factory — same as `new TieredSearch(config)`. */
export function createTieredSearch(config: TieredSearchConfig): TieredSearch {
  return new TieredSearch(config);
}

