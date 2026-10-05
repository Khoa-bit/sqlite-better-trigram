// Multi-column search (app-level) — production shape.
//
// One FTS table PER FIELD (same two-column prefix trick as better-trigram.test.ts):
//
//   title_fts: doc_id | title, title_prefix
//   desc_fts:  doc_id | description, description_prefix
//   kw_fts:    doc_id | keyword, keyword_prefix   (keyword values joined per doc)
//
// One index per field, so a MATCH can never span fields: a doc matches iff ONE
// field contains every query word (same-field AND, any order). The app fills the
// *_prefix columns with 1-2 char word-start prefixes, so a short query (<3 chars)
// hits the prefix columns; a longer query hits the trigram columns. Retrieval is
// ONE query: the field indexes UNIONed, each with plain MATCH — no post-filter,
// so SQL can LIMIT/OFFSET directly.
//
// Every case runs through BOTH the SQLite extension and the JS
// `MultiFieldSearch` (src/multi-field-search.ts) and asserts identical doc ids.
//
// to run: bun test

import { Database } from "bun:sqlite";
import { describe, test, expect, afterAll } from "bun:test";
import { createMultiFieldSearch } from "../src/multi-field-search";
import { fold } from "../src/unicode";
import type { TokenizerOptions } from "../src/types";

const EXT =
  process.platform === "win32"
    ? ".dll"
    : process.platform === "darwin"
      ? ".dylib"
      : ".so";

function initDatabase(): Database {
  const db = new Database(":memory:");
  try {
    db.loadExtension(`./dist/fts5${EXT}`);
  } catch {
    // FTS5 may be compiled into SQLite already; skip standalone load
  }
  db.loadExtension(`./dist/better-trigram${EXT}`);
  return db;
}

interface Doc {
  id: number;
  title: string;
  description?: string;
  keywords?: string[];
}

const DOCS: Doc[] = [
  { id: 1, title: "arrow" },
  { id: 2, title: "arrow down" },
  { id: 3, title: "topic three", keywords: ["arrow"] },
  { id: 4, title: "topic four", keywords: ["arrow-up"] },
  { id: 5, title: "a-arrow-down" },
  { id: 6, title: "topic six", keywords: ["bow-and-arrow"] },
  { id: 7, title: "topic seven", description: "follow the arrow marker" },
  { id: 8, title: "topic eight", keywords: ["nope", "green arrow", "another"] },
  { id: 9, title: "topic nine", description: "marker that follows the arrow" },
  // diacritics (folded app-side on both engines)
  { id: 10, title: "café" },
  { id: 11, title: "Đại" },
  { id: 12, title: "topic eleven", description: "résumé", keywords: ["tørv"] },
];

// Single source of truth for normalization, used on BOTH sides: SQL folds every
// value and every query app-side (NFD + strip marks), and the JS engine does the
// same via its tokenizer options. So "café"/"cafe" and "Đại"/"dai" all collapse.
const FOLD_OPTS: TokenizerOptions = {
  caseSensitive: false,
  removeDiacritics: 1,
  prefixSearch: true,
};

const foldText = (text: string): string => fold(text, FOLD_OPTS);

// App-side word-start prefixes: "arrow" → "a ar", "a-arrow-down" → "a a-".
function wordPrefixes(text: string): string {
  return text
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .flatMap((w) =>
      w.length >= 2 ? [w.slice(0, 1), w.slice(0, 2)] : [w.slice(0, 1)]
    )
    .join(" ");
}

describe("multi-column search (app-level)", () => {
  const db = initDatabase();
  afterAll(() => db.close());

  test("0.0 setup", () => {
    [
      `CREATE VIRTUAL TABLE title_fts USING fts5(
        doc_id UNINDEXED, title, title_prefix,
        tokenize='better_trigram case_sensitive 1 remove_diacritics 0'
      );`,
      `CREATE VIRTUAL TABLE desc_fts USING fts5(
        doc_id UNINDEXED, description, description_prefix,
        tokenize='better_trigram case_sensitive 1 remove_diacritics 0'
      );`,
      `CREATE VIRTUAL TABLE kw_fts USING fts5(
        doc_id UNINDEXED, keyword, keyword_prefix,
        tokenize='better_trigram case_sensitive 1 remove_diacritics 0'
      );`,
    ].forEach((stmt) => db.query(stmt).run());

    for (const d of DOCS) {
      const title = foldText(d.title);
      const desc = foldText(d.description ?? "");
      db.query(
        `INSERT INTO title_fts(doc_id, title, title_prefix) VALUES (?, ?, ?)`
      ).run(d.id, title, wordPrefixes(title));
      db.query(
        `INSERT INTO desc_fts(doc_id, description, description_prefix) VALUES (?, ?, ?)`
      ).run(d.id, desc, wordPrefixes(desc));
      const keyword = foldText((d.keywords ?? []).join(" "));
      db.query(
        `INSERT INTO kw_fts(doc_id, keyword, keyword_prefix) VALUES (?, ?, ?)`
      ).run(d.id, keyword, wordPrefixes(keyword));
    }
  });

  // The JS twin of this schema (src/multi-field-search.ts). Same folding as SQL.
  const js = createMultiFieldSearch({
    fields: {
      title: {},
      description: {},
      keywords: { multiple: true },
    },
    tokenizer: { removeDiacritics: 1 },
  });
  for (const d of DOCS) {
    js.addDocument(d.id, {
      title: d.title,
      description: d.description,
      keywords: d.keywords,
    });
  }

  // One query for every case: fold the query app-side, UNION the per-field
  // indexes with plain MATCH each. No post-filter — each field MATCH already
  // requires all query words in that field. Asserts JS returns the SAME ids.
  function search(q: string): number[] {
    const folded = foldText(q);
    const sql = (
      db
        .query(
          `SELECT CAST(doc_id AS INTEGER) AS doc_id FROM title_fts WHERE title_fts MATCH $q
           UNION
           SELECT CAST(doc_id AS INTEGER) AS doc_id FROM desc_fts  WHERE desc_fts  MATCH $q
           UNION
           SELECT CAST(doc_id AS INTEGER) AS doc_id FROM kw_fts    WHERE kw_fts    MATCH $q`
        )
        .all({ $q: folded }) as { doc_id: number }[]
    )
      .map((r) => r.doc_id)
      .sort((a, b) => a - b);

    expect(js.search(q).sort((a, b) => a - b)).toEqual(sql); // JS ↔ SQL parity
    return sql;
  }

  test("1. exact word / substring matches across title, keywords, description", () => {
    // 1,2 title; 3,4,6,8 keywords; 5 title substring; 7 description
    expect(search("arrow")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("2. short query hits word-start prefix columns", () => {
    // "ar" is a word-start of "arrow" in docs 1,2,3,4,7,8.
    // doc 5 prefix is "a a-" and doc 6 "bow-and-arrow" prefix is "b bo".
    expect(search("ar")).toEqual([1, 2, 3, 4, 7, 8, 9]);
  });

  test("3. multi-word query: all words in the same field, any order", () => {
    // doc 2 title "arrow down": both words in the title field → matches.
    // doc 5 "a-arrow-down" is one title word that contains both → same field,
    // no adjacency requirement → matches too.
    expect(search("arrow down")).toEqual([2, 5]);
    // mixed 1-char + 2-char: "a" is a word-start, "do" a word-start of "down".
    expect(search("a do")).toEqual([2]);
    // duplicate tokens are collapsed: "a do do" behaves like "a do".
    expect(search("a do do")).toEqual([2]);
    // separate fields cannot satisfy a query: doc 3 has "arrow" in keywords and
    expect(search("topic follow")).toEqual([]);
    // Unexpected result: backwards is still searchable
    expect(search("m f f f")).toEqual([7, 9]);
  });

  test("4. description column is searched too", () => {
    expect(search("marker")).toEqual([7, 9]);
  });

  test("5. every keyword value is searched (multiple per doc)", () => {
    expect(search("green")).toEqual([8]);
    expect(search("nope")).toEqual([8]);
  });

  test("6. diacritics fold identically (app-side NFD on both sides)", () => {
    // SQL inserts + queries the folded form; JS folds via its tokenizer options.
    expect(search("cafe")).toEqual([10]);
    expect(search("café")).toEqual([10]);
    expect(search("dai")).toEqual([11]);
    expect(search("Đại")).toEqual([11]);
    // description + keyword columns fold too
    expect(search("resume")).toEqual([12]);
    expect(search("tørv")).toEqual([12]);
  });
});
