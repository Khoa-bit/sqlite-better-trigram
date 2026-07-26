import { run, bench, compact, summary } from "mitata";
import { LoremIpsum } from "lorem-ipsum";
import { Database } from "bun:sqlite";
import { TrigramTokenizer } from "../src/tokenizer";
import { SearchEngine } from "../src/search";
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

// ══════════════════════════════════════════
// C extension setup (conditional)
// ══════════════════════════════════════════

let cInsert: ((text: string) => void) | null = null;

try {
  const db = new Database(":memory:");
  db.loadExtension(`./dist/better-trigram${EXT}`);
  db.query(
    `CREATE VIRTUAL TABLE bt1 USING fts5(y, tokenize='better_trigram remove_diacritics 1');`,
  ).run();
  const stmt = db.query(`INSERT INTO bt1 VALUES( ? );`);
  cInsert = (text: string) => stmt.run(text);
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

      bench("TS tokenize (removeDiacritics:1)", () => {
        tokenizer.tokenize(englishText);
      });

      bench("TS addDocument (removeDiacritics:1)", () => {
        const e = new SearchEngine(OPTIONS);
        e.addDocument(0, englishText);
      });
    });
  });
}

await run();
