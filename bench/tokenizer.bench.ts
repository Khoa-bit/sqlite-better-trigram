import { run, bench, compact, summary } from "mitata";
import { LoremIpsum } from "lorem-ipsum";
import { Database } from "bun:sqlite";
import { TrigramTokenizer } from "../src/tokenizer";
import { SearchEngine } from "../src/search";
import { fold } from "../src/unicode";
import type { TokenizerOptions } from "../src/types";

// ── Config ──

const OPTIONS: TokenizerOptions = { removeDiacritics: 1, caseSensitive: false };

const EXT =
  process.platform === "win32"
    ? ".dll"
    : process.platform === "darwin"
    ? ".dylib"
    : ".so";

// ══════════════════════════════════════════
// Test data
// ══════════════════════════════════════════

const lorem = new LoremIpsum({
  sentencesPerParagraph: { max: 15, min: 10 },
  wordsPerSentence: { max: 50, min: 20 },
});

const englishText = lorem.generateParagraphs(100);

const diacriticText = [
  "Con đường dài và đẹp, tiếng Việt có dấu. Đại dương xanh thẳm và cửa sổ mới.",
  "Tørv er godt, łódź jest super. ħaba ma sens, bu alıntıdır.",
  "Æther and œuvre: naïve résumé café façade. São Paulo, Curaçao, Sørvágur.",
  "Français: très bien, ça va? Déjà vu, crème brûlée, pâté, écarlate.",
  "Polski: łączność, żółć, gęś, źrebak, dźwięk, ciasto, łódka.",
  "Türkçe: İstanbul, çalışkan, ağaç, şeker, ılık, öğrenci, üzgün.",
  "Dansk: tørv, rødgrød med fløde, søndag, blåbær, kræft, hånd.",
  "中文: 苹果：这是什么？西瓜：那是钢笔。那是杂志吗？",
  "日本語: リンゴを食べます。半角ｶﾀｶﾅと、句読点。「こんにちは」と言った。",
  "한국어: 안녕하세요, 반갑습니다. 감사합니다, 사랑해요.",
].join("\n");

const cjkText = [
  "苹果：这是什么？西瓜：那是钢笔。那是杂志吗？李红：那是钢笔。",
  "你好world，hello世界。リンゴを食べます。半角ｶﾀｶﾅと、句読点。",
  "안녕하세요, 반갑습니다. 감사합니다.",
].join("\n");

const shortQueries = [
  "hello", "world", "lorem", "ipsum", "dolor", "bir", "ird",
  "con đường", "tørv", "łódź", "đẹp", "café", "résumé",
  "苹果", "那是", "日本語", "ｶﾀｶﾅ", "hello world",
  "the quick brown", "xyzzy", "notfound", "lo wo",
];

const PREFIX_OPTIONS: TokenizerOptions = {
  removeDiacritics: 1, caseSensitive: false, prefixSearch: true,
};

// ══════════════════════════════════════════
// Tokenizer setup
// ══════════════════════════════════════════

const tokenizer = new TrigramTokenizer(OPTIONS);

// ══════════════════════════════════════════
// SearchEngine setup
// ══════════════════════════════════════════

const indexDocs = englishText
  .split("\n")
  .filter((s) => s.trim().length > 0)
  .slice(0, 20);

function buildSearchEngine(): SearchEngine {
  const engine = new SearchEngine(OPTIONS);
  for (let i = 0; i < indexDocs.length; i++) {
    engine.addDocument(i, indexDocs[i]!);
  }
  return engine;
}

const searchEngine = buildSearchEngine();

function buildPrefixSearchEngine(): SearchEngine {
  const engine = new SearchEngine(PREFIX_OPTIONS);
  for (let i = 0; i < indexDocs.length; i++) {
    engine.addDocument(i, indexDocs[i]!);
  }
  return engine;
}

const prefixSearchEngine = buildPrefixSearchEngine();

// ── Prefix helpers ──

/**
 * Compute 1-char and 2-char word prefixes matching tokenizer prefix emission
 * (folded, whitespace-delimited). Used for SQLite prefixes column.
 */
function computeWordPrefixes(text: string): string {
  const opts = PREFIX_OPTIONS;
  const result: string[] = [];
  let word = "";
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (cp === 0) continue;
    const isSpace = cp === 0x09 || cp === 0x0a || cp === 0x0b || cp === 0x0c || cp === 0x0d || cp === 0x20 || cp === 0x85 || cp === 0xa0;
    if (isSpace) {
      if (word.length > 0) {
        if (word.length >= 1) result.push(word[0]!);
        if (word.length >= 2) result.push(word.slice(0, 2));
        word = "";
      }
      continue;
    }
    word += fold(char, opts);
  }
  if (word.length > 0) {
    if (word.length >= 1) result.push(word[0]!);
    if (word.length >= 2) result.push(word.slice(0, 2));
  }
  return result.join(" ");
}

// ══════════════════════════════════════════
// C extension setup (conditional)
// ══════════════════════════════════════════

let cInsert: ((text: string) => void) | null = null;
let cPrefixInsert: ((text: string, prefixes: string) => void) | null = null;
let cPrefixSearch1: ((q: string) => unknown[]) | null = null;
let cPrefixSearch2: ((q: string) => unknown[]) | null = null;
let cTrigramSearch: ((q: string) => unknown[]) | null = null;
let cCombinedSearch: ((q: string) => unknown[]) | null = null;
let englishPrefixes = "";

try {
  const db = new Database(":memory:");
  db.loadExtension(`./dist/better-trigram${EXT}`);
  db.query(
    `CREATE VIRTUAL TABLE bt1 USING fts5(y, tokenize='better_trigram remove_diacritics 1');`,
  ).run();
  const stmt = db.query(`INSERT INTO bt1 VALUES( ? );`);
  cInsert = (text: string) => stmt.run(text);

  // Prefix column table
  db.query(
    `CREATE VIRTUAL TABLE bt_prefix USING fts5(content, prefixes, tokenize='better_trigram remove_diacritics 1');`,
  ).run();
  const pStmt = db.query(`INSERT INTO bt_prefix VALUES( ?, ? );`);
  cPrefixInsert = (text: string, prefixes: string) => pStmt.run(text, prefixes);

  // Pre-compute prefixes once (avoid TS fold in bench callback)
  englishPrefixes = computeWordPrefixes(englishText);

  // Pre-populate prefix table with the same 20 docs
  for (let i = 0; i < indexDocs.length; i++) {
    const prefixes = computeWordPrefixes(indexDocs[i]!);
    cPrefixInsert(indexDocs[i]!, prefixes);
  }

  const ps1 = db.query(
    `SELECT rowid FROM bt_prefix WHERE prefixes MATCH 'h'`,
  );
  cPrefixSearch1 = (q: string) => ps1.all(q);

  const ps2 = db.query(
    `SELECT rowid FROM bt_prefix WHERE prefixes MATCH 'he'`,
  );
  cPrefixSearch2 = (q: string) => ps2.all(q);

  const ts = db.query(
    `SELECT rowid FROM bt_prefix WHERE content MATCH 'lorem'`,
  );
  cTrigramSearch = (q: string) => ts.all(q);

  const cs = db.query(
    `SELECT rowid FROM bt_prefix WHERE content MATCH 'lorem' AND prefixes MATCH 'l'`,
  );
  cCombinedSearch = (q: string) => cs.all(q);
} catch {
  // C extension not built — skip comparison
}

// ══════════════════════════════════════════
// Phase C — Tokenizer benchmarks
// ══════════════════════════════════════════

compact(() => {
  summary(() => {
    bench("tokenize English lorem-ipsum", () => {
      tokenizer.tokenize(englishText);
    });

    bench("tokenize diacritic-heavy text", () => {
      tokenizer.tokenize(diacriticText);
    });

    bench("tokenize CJK text", () => {
      tokenizer.tokenize(cjkText);
    });

    bench("tokenize 22 short queries", () => {
      for (const q of shortQueries) {
        tokenizer.tokenize(q);
      }
    });
  });
});

// ══════════════════════════════════════════
// Phase D — SearchEngine benchmarks
// ══════════════════════════════════════════

compact(() => {
  summary(() => {
    bench("index 20 documents", () => {
      const e = new SearchEngine(OPTIONS);
      for (let i = 0; i < indexDocs.length; i++) {
        e.addDocument(i, indexDocs[i]!);
      }
    });

    bench("substring search hit", () => {
      searchEngine.search("lorem");
    });

    bench("substring search miss", () => {
      searchEngine.search("xyzzy");
    });

    bench("cross-word substring search", () => {
      searchEngine.search("em ip");
    });

    bench("phrase search", () => {
      searchEngine.searchPhrase("lorem ipsum");
    });

    bench("index 20 docs (prefixSearch)", () => {
      const e = new SearchEngine(PREFIX_OPTIONS);
      for (let i = 0; i < indexDocs.length; i++) {
        e.addDocument(i, indexDocs[i]!);
      }
    });

    bench("search prefix 1-char", () => {
      prefixSearchEngine.search("h");
    });

    bench("search prefix 2-char", () => {
      prefixSearchEngine.search("he");
    });

    bench("search prefix miss", () => {
      prefixSearchEngine.search("xy");
    });

    bench("search prefix mixed", () => {
      prefixSearchEngine.search("h wor");
    });

    bench("phrase search (prefixSearch)", () => {
      prefixSearchEngine.searchPhrase("lorem ipsum");
    });
  });
});

// ══════════════════════════════════════════
// Phase E — C extension comparison
// ══════════════════════════════════════════

if (cInsert) {
  compact(() => {
    summary(() => {
      bench("C INSERT (remove_diacritics 1)", () => {
        cInsert!(englishText);
      });

      bench("C INSERT with prefixes", () => {
        cPrefixInsert!(englishText, englishPrefixes);
      });

      bench("TS tokenize (removeDiacritics:1)", () => {
        tokenizer.tokenize(englishText);
      });

      bench("TS addDocument (removeDiacritics:1)", () => {
        const e = new SearchEngine(OPTIONS);
        e.addDocument(0, englishText);
      });

      bench("TS addDocument (prefixSearch)", () => {
        const e = new SearchEngine(PREFIX_OPTIONS);
        e.addDocument(0, englishText);
      });

      bench("C prefix search 1-char", () => {
        cPrefixSearch1!("h");
      });

      bench("C prefix search 2-char", () => {
        cPrefixSearch2!("he");
      });

      bench("C trigram search", () => {
        cTrigramSearch!("lorem");
      });

      bench("C combined search", () => {
        cCombinedSearch!("lorem");
      });
    });
  });
}

await run();
