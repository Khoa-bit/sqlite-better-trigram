// SQL ↔ JS parity for tiered search.
//
// The SQLite extension (better-trigram.test.ts) and the TypeScript engine
// (src/tiered-search.ts) are two independent implementations of the same
// tiered-ranking idea. This file runs the SAME fixtures + queries through
// BOTH and asserts the ranked output is identical, so they cannot silently
// drift apart.
//
// Folding is done app-side, once, on every path: indexed text, generated
// prefixes, the FTS query, and the ranking columns. The tokenizer is a pure
// passthrough (`case_sensitive 1 remove_diacritics 0`), so the app is the only
// place normalization happens — that is what keeps the two sides in lockstep.
//
// to run: bun test

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, test, expect, afterAll } from "bun:test";
import {
  createTieredSearch,
  type TieredSearch,
  type TieredFieldSpec,
  type TierRule,
} from "../src/tiered-search";
import { fold } from "../src/unicode";
import type { TokenizerOptions } from "../src/types";

const EXT =
  process.platform === "win32"
    ? ".dll"
    : process.platform === "darwin"
      ? ".dylib"
      : ".so";

// The SQLite extension must be built first (`make loadable`). If it is not,
// skip this suite rather than failing the whole run.
const EXT_PATH = join(import.meta.dir, "..", "dist", `better-trigram${EXT}`);
const HAS_EXTENSION = existsSync(EXT_PATH);
const suite = HAS_EXTENSION ? describe : describe.skip;
if (!HAS_EXTENSION) {
  console.warn(
    `[sql-js-parity] skipped: ${EXT_PATH} not found (run \`make loadable\`)`
  );
}

// ── Shared fixtures (mirrors better-trigram.test.ts) ──

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
  { id: 20, title: "blue box" },
  { id: 21, title: "blue box icon" },
  { id: 22, title: "topic twentytwo", keywords: ["blue box"] },
  { id: 23, title: "topic twentythree", keywords: ["blue box large"] },
  { id: 24, title: "the blue box" },
  { id: 25, title: "topic twentyfive", keywords: ["my blue box"] },
  { id: 26, title: "topic twentysix", description: "drag the blue box here" },
  { id: 27, title: "topic twentyseven", keywords: ["zzz", "a blue box thing"] },
  // keyword match in a different token order → unranked
  { id: 30, title: "topic thirty", keywords: ["box blue"] },
  // substring only spans title + description → unranked
  { id: 31, title: "blue", description: "box" },
];

// ── The ladder both sides implement (same as tiered-search.test.ts) ──

const DOCUMENT_FIELDS: Record<string, TieredFieldSpec> = {
  title: { group: "content" },
  description: { group: "content" },
  keywords: { multiple: true, group: "keywords" },
};

const DOCUMENT_TIERS: readonly TierRule[] = [
  { field: "title", match: "exact" },
  { field: "title", match: "prefix" },
  { field: "keywords", match: "exact" },
  { field: "keywords", match: "prefix" },
  { field: "title", match: "contains" },
  { field: "keywords", match: "contains" },
  { field: "description", match: "contains" },
];

// Single source of truth for normalization. The JS engine and the SQL side
// both go through `foldText`, so "folded" means the same thing everywhere.
const FOLD_OPTS: TokenizerOptions = {
  caseSensitive: false,
  removeDiacritics: 1,
  prefixSearch: true,
};

const foldText = (text: string): string => fold(text, FOLD_OPTS);

// ── JS side ──

function buildJs(docs: Doc[]): TieredSearch {
  const engine = createTieredSearch({
    fields: DOCUMENT_FIELDS,
    tiers: DOCUMENT_TIERS,
    tokenizer: FOLD_OPTS,
  });
  for (const d of docs) {
    engine.addDocument(d.id, {
      title: d.title,
      description: d.description,
      keywords: d.keywords,
    });
  }
  return engine;
}

function jsRanked(engine: TieredSearch, query: string): number[][] {
  return engine.search(query).map((h) => [h.docId, h.tier]);
}

// ── SQL side ──

function initDatabase(): Database {
  const db = new Database(":memory:");
  try {
    db.loadExtension(join(import.meta.dir, "..", "dist", `fts5${EXT}`));
  } catch {
    // FTS5 may be compiled into SQLite already; skip standalone load
  }
  db.loadExtension(EXT_PATH);
  return db;
}

// App-level word-start prefixes. Runs on FOLDED text, so the prefix tokens
// are already normalized and line up with folded queries.
function wordStartPrefixes(text: string): string {
  return text
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .flatMap((w) =>
      w.length >= 2 ? [w.slice(0, 1), w.slice(0, 2)] : [w.slice(0, 1)]
    )
    .join(" ");
}

// Ranking compares pre-folded shadow columns, so it is plain equality — no
// lower() (which is ASCII-only) and no per-row folding. `$qF` is the folded
// query; the same value drives MATCH as `$q`.
const TIER_CASE = `CASE
  WHEN d.title_fold = $qF THEN 1
  WHEN substr(d.title_fold, 1, length($qF)) = $qF THEN 2
  WHEN EXISTS (
    SELECT 1 FROM doc_keywords k
    WHERE k.doc_id = d.id AND k.keyword_fold = $qF
  ) THEN 3
  WHEN EXISTS (
    SELECT 1 FROM doc_keywords k
    WHERE k.doc_id = d.id
      AND substr(k.keyword_fold, 1, length($qF)) = $qF
  ) THEN 4
  WHEN instr(d.title_fold, $qF) > 0 THEN 5
  WHEN EXISTS (
    SELECT 1 FROM doc_keywords k
    WHERE k.doc_id = d.id AND instr(k.keyword_fold, $qF) > 0
  ) THEN 6
  WHEN instr(d.description_fold, $qF) > 0 THEN 7
  ELSE 0
END`;

function sqlSetup(db: Database, docs: Doc[]): void {
  [
    `CREATE TABLE docs(
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      title_fold TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      description_fold TEXT NOT NULL DEFAULT ''
    );`,
    `CREATE TABLE doc_keywords(
      doc_id INTEGER NOT NULL,
      keyword TEXT NOT NULL,
      keyword_fold TEXT NOT NULL
    );`,
    `CREATE INDEX doc_keywords_doc_fold ON doc_keywords(doc_id, keyword_fold);`,
    // Tokenizer is a pure passthrough: all folding already happened app-side,
    // so the index stores only folded text and no diacritics/​case handling is
    // needed (or wanted) here.
    `CREATE VIRTUAL TABLE docs_fts USING fts5(
      doc_id UNINDEXED, title, title_prefix, description, description_prefix,
      tokenize='better_trigram case_sensitive 1 remove_diacritics 0'
    );`,
    `CREATE VIRTUAL TABLE kw_fts USING fts5(
      doc_id UNINDEXED, keyword, keyword_prefix,
      tokenize='better_trigram case_sensitive 1 remove_diacritics 0'
    );`,
  ].forEach((stmt) => db.query(stmt).run());

  for (const d of docs) {
    insertSqlDoc(db, d.id, d.title, d.description ?? "", d.keywords ?? []);
  }
}

function insertSqlDoc(
  db: Database,
  id: number,
  title: string,
  description = "",
  keywords: string[] = []
): void {
  // Fold once at write. The folded string is both indexed and kept in the
  // shadow column the ranking step compares against.
  const titleFold = foldText(title);
  const descriptionFold = foldText(description);

  db.query(
    `INSERT INTO docs(id, title, title_fold, description, description_fold)
     VALUES ($id, $title, $titleFold, $desc, $descFold)`
  ).run({
    $id: id,
    $title: title,
    $titleFold: titleFold,
    $desc: description,
    $descFold: descriptionFold,
  });
  db.query(
    `INSERT INTO docs_fts(doc_id, title, title_prefix, description, description_prefix)
     VALUES ($id, $title, $titlePfx, $desc, $descPfx)`
  ).run({
    $id: id,
    $title: titleFold,
    $titlePfx: wordStartPrefixes(titleFold),
    $desc: descriptionFold,
    $descPfx: wordStartPrefixes(descriptionFold),
  });
  for (const keyword of keywords) {
    const keywordFold = foldText(keyword);
    db.query(
      `INSERT INTO doc_keywords(doc_id, keyword, keyword_fold)
       VALUES ($id, $keyword, $keywordFold)`
    ).run({ $id: id, $keyword: keyword, $keywordFold: keywordFold });
    db.query(
      `INSERT INTO kw_fts(doc_id, keyword, keyword_prefix)
       VALUES ($id, $keyword, $keywordPfx)`
    ).run({
      $id: id,
      $keyword: keywordFold,
      $keywordPfx: wordStartPrefixes(keywordFold),
    });
  }
}

function sqlRanked(db: Database, query: string): number[][] {
  const q = foldText(query);
  const rows = db
    .query(
      `WITH candidates AS (
         SELECT CAST(doc_id AS INTEGER) AS doc_id FROM docs_fts WHERE docs_fts MATCH $q
         UNION
         SELECT CAST(doc_id AS INTEGER) AS doc_id FROM kw_fts   WHERE kw_fts   MATCH $q
       ),
       tiers AS (
         SELECT d.id AS doc_id, ${TIER_CASE} AS tier
         FROM candidates c JOIN docs d ON d.id = c.doc_id
       )
       SELECT doc_id, tier FROM tiers
       WHERE tier > 0
       ORDER BY tier, doc_id`
    )
    .all({ $q: q, $qF: q }) as { doc_id: number; tier: number }[];
  return rows.map((r) => [r.doc_id, r.tier]);
}

/** Raw candidate doc ids from MATCH across both indexes (no ranking). */
function sqlCandidates(db: Database, query: string): number[] {
  return (
    db
      .query(
        `SELECT CAST(doc_id AS INTEGER) AS doc_id FROM docs_fts WHERE docs_fts MATCH $q
         UNION
         SELECT CAST(doc_id AS INTEGER) AS doc_id FROM kw_fts   WHERE kw_fts   MATCH $q`
      )
      .all({ $q: foldText(query) }) as { doc_id: number }[]
  ).map((r) => r.doc_id);
}

// ──────────────────────────────────────────────
// Every test below drives BOTH implementations — the JS engine and the SQL
// (better-trigram extension) schema — with the same fixtures, and asserts the
// same expected ranking from each.
// ──────────────────────────────────────────────

suite("tiered search: SQL and JS agree", () => {
  // `suite` may be `describe.skip` (extension not built), which still runs this
  // body — so only touch the database when the extension is actually available.
  const db = HAS_EXTENSION ? initDatabase() : (null as unknown as Database);
  const js = buildJs(DOCS);
  if (HAS_EXTENSION) {
    sqlSetup(db, DOCS);
    afterAll(() => db.close());
  }

  /** Run the same query through both engines. */
  function both(query: string) {
    return { sql: sqlRanked(db, query), js: jsRanked(js, query) };
  }

  test("single word ranks all 7 tiers: 'arrow'", () => {
    const expected = [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 6],
      [8, 6],
      [7, 7],
    ];
    const { sql, js: jsr } = both("arrow");
    expect(jsr).toEqual(expected);
    expect(sql).toEqual(expected);
  });

  test("multi-word query ranks all 7 tiers: 'blue box'", () => {
    const expected = [
      [20, 1],
      [21, 2],
      [22, 3],
      [23, 4],
      [24, 5],
      [25, 6],
      [27, 6],
      [26, 7],
    ];
    const { sql, js: jsr } = both("blue box");
    expect(jsr).toEqual(expected);
    expect(sql).toEqual(expected);
  });

  test("short queries use the prefix index: 'ar', 'g'", () => {
    const arExpected = [
      [1, 2],
      [2, 2],
      [3, 4],
      [4, 4],
      [8, 6],
      [7, 7],
    ];
    const ar = both("ar");
    expect(ar.js).toEqual(arExpected);
    expect(ar.sql).toEqual(arExpected);

    // Word-start-only tradeoff, on both sides: 'ar' occurs inside doc 5
    // ("a-arrow-down") and doc 6 ("bow-and-arrow") but not at a word start.
    expect(js.candidates("ar")).not.toContain(5);
    expect(sqlCandidates(db, "ar")).not.toContain(5);
    expect(js.candidates("ar")).not.toContain(6);
    expect(sqlCandidates(db, "ar")).not.toContain(6);

    const gExpected = [[8, 4]];
    const g = both("g");
    expect(g.js).toEqual(gExpected);
    expect(g.sql).toEqual(gExpected);
  });

  test("unranked candidates are dropped: keyword-order + cross-field", () => {
    const expected = [
      [20, 1],
      [21, 2],
      [22, 3],
      [23, 4],
      [24, 5],
      [25, 6],
      [27, 6],
      [26, 7],
    ];
    const { sql, js: jsr } = both("blue box");
    expect(jsr).toEqual(expected);
    expect(sql).toEqual(expected);

    // doc 30 — keyword "box blue". SQL retrieves it (MATCH is AND, order
    // agnostic) then tiers it 0; JS's substring post-filter never retrieves it.
    // Different routes, same visible result: dropped.
    expect(sqlCandidates(db, "blue box")).toContain(30);
    expect(js.candidates("blue box")).not.toContain(30);
    expect(sql.map((r) => r[0])).not.toContain(30);
    expect(jsr.map((r) => r[0])).not.toContain(30);

    // doc 31 — title "blue" + description "box". Both retrieve it (the query
    // spans the shared group) and both drop it as tier 0.
    expect(sqlCandidates(db, "blue box")).toContain(31);
    expect(js.candidates("blue box")).toContain(31);
    expect(sql.map((r) => r[0])).not.toContain(31);
    expect(jsr.map((r) => r[0])).not.toContain(31);
  });

  test("substring-only queries agree: 'blue', 'box'", () => {
    for (const query of ["blue", "box"]) {
      const { sql, js: jsr } = both(query);
      expect(jsr.length).toBeGreaterThan(0);
      expect(sql).toEqual(jsr);
    }
  });

  test("non-ASCII folding agrees: 'đại', 'cafe' and their accented forms", () => {
    // Both sides fold app-side, so accents in the index, the query, and the
    // ranking columns all collapse to the same ASCII form. 'Đại'/'đại' and
    // 'café'/'cafe' therefore rank identically on SQL and JS.
    const docs: Doc[] = [
      { id: 40, title: "Đại" },
      { id: 41, title: "café" },
    ];
    const jsUnicode = buildJs(docs);
    expect(jsRanked(jsUnicode, "đại")).toEqual([[40, 1]]);
    expect(jsRanked(jsUnicode, "cafe")).toEqual([[41, 1]]);

    insertSqlDoc(db, 40, "Đại");
    insertSqlDoc(db, 41, "café");
    expect(sqlRanked(db, "đại")).toEqual([[40, 1]]);
    expect(sqlRanked(db, "cafe")).toEqual([[41, 1]]);
    // unaccented query finds the accented doc, and vice versa
    expect(sqlRanked(db, "dai")).toEqual([[40, 1]]);
    expect(sqlRanked(db, "café")).toEqual([[41, 1]]);
  });
});
