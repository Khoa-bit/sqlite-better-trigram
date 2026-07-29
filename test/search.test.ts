import { describe, test, expect, beforeEach } from "bun:test";
import { SearchEngine } from "../src/search";

// ──────────────────────────────────────────────
// 1. Basic substring search
// ──────────────────────────────────────────────
describe("substring search", () => {
  let engine: SearchEngine;

  beforeEach(() => {
    engine = new SearchEngine();
    engine.addDocument(1, "hello world");
    engine.addDocument(2, "hello there");
    engine.addDocument(3, "goodbye world");
    engine.addDocument(4, "a-arrow-down");
    engine.addDocument(5, "arrow-up");
  });

  test("search 'hello' returns docs 1 and 2", () => {
    const result = engine.search("hello").sort();
    expect(result).toEqual([1, 2]);
  });

  test("search 'world' returns docs 1 and 3", () => {
    const result = engine.search("world").sort();
    expect(result).toEqual([1, 3]);
  });

  test("search 'lo wo' cross-word substring", () => {
    const result = engine.search("lo wo");
    expect(result).toEqual([1]);
  });

  test("search 'xyz' not found", () => {
    expect(engine.search("xyz")).toEqual([]);
  });

  test("search 'arrow' return 4 and 5", () => {
    expect(engine.search("arrow")).toEqual([4, 5]);
  });
});

// ──────────────────────────────────────────────
// 2. Case-insensitive search (default)
// ──────────────────────────────────────────────
describe("case-insensitive search", () => {
  let engine: SearchEngine;

  beforeEach(() => {
    engine = new SearchEngine();
    engine.addDocument(1, "Hello World");
  });

  test("lowercase query matches uppercase doc", () => {
    expect(engine.search("hello")).toEqual([1]);
  });

  test("uppercase query matches mixed-case doc", () => {
    expect(engine.search("WORLD")).toEqual([1]);
  });
});

// ──────────────────────────────────────────────
// 3. Case-sensitive search
// ──────────────────────────────────────────────
describe("case-sensitive search", () => {
  let engine: SearchEngine;

  beforeEach(() => {
    engine = new SearchEngine({ caseSensitive: true });
    engine.addDocument(1, "Hello World");
  });

  test("exact case matches", () => {
    expect(engine.search("Hello")).toEqual([1]);
  });

  test("wrong case no match", () => {
    expect(engine.search("hello")).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// 4. Diacritic-insensitive search
// ──────────────────────────────────────────────
describe("diacritic search", () => {
  let engine: SearchEngine;

  beforeEach(() => {
    engine = new SearchEngine({ removeDiacritics: 1 });
    engine.addDocument(1, "café résumé");
  });

  test("search 'cafe' matches 'café'", () => {
    expect(engine.search("cafe")).toEqual([1]);
  });

  test("search 'resume' matches 'résumé'", () => {
    expect(engine.search("resume")).toEqual([1]);
  });

  test("search with diacritics also matches", () => {
    expect(engine.search("café")).toEqual([1]);
  });

  // ── custom diacritic patch chars ──

  test("search 'tor' matches 'tørv' (ø→o)", () => {
    engine.addDocument(2, "tørv");
    expect(engine.search("tor")).toContain(2);
  });

  test("search 'duc' matches 'đức' (đ→d)", () => {
    engine.addDocument(2, "đức");
    expect(engine.search("duc")).toContain(2);
  });

  test("search 'hab' matches 'ħaba' (ħ→h)", () => {
    engine.addDocument(2, "ħaba");
    expect(engine.search("hab")).toContain(2);
  });

  test("search 'ali' matches 'alı' (ı→i)", () => {
    engine.addDocument(2, "alı");
    expect(engine.search("ali")).toContain(2);
  });

  test("search 'lod' matches 'łódź' (ł→l)", () => {
    engine.addDocument(2, "łódź");
    expect(engine.search("lod")).toContain(2);
  });

  test("original diacritics query also matches custom chars", () => {
    engine.addDocument(2, "tørv");
    expect(engine.search("tørv")).toContain(2);
  });

  test("custom patch chars work with removeDiacritics=2", () => {
    const engine2 = new SearchEngine({ removeDiacritics: 2 });
    engine2.addDocument(1, "tørv đức ħaba");
    expect(engine2.search("tor")).toContain(1);
    expect(engine2.search("duc")).toContain(1);
    expect(engine2.search("hab")).toContain(1);
  });
});

// ──────────────────────────────────────────────
// 5. Phrase search
// ──────────────────────────────────────────────
describe("phrase search", () => {
  let engine: SearchEngine;

  beforeEach(() => {
    engine = new SearchEngine();
    engine.addDocument(1, "the quick brown fox");
    engine.addDocument(2, "quick brown fox jumps");
    engine.addDocument(3, "the lazy brown fox");
  });

  test("'quick brown' matches docs 1 and 2", () => {
    expect(engine.searchPhrase("quick brown").sort()).toEqual([1, 2]);
  });

  test("'the quick' matches doc 1", () => {
    expect(engine.searchPhrase("the quick")).toEqual([1]);
  });

  test("'the fox' not adjacent → no match", () => {
    expect(engine.searchPhrase("the fox")).toEqual([]);
  });

  test("'brown fox' matches all docs", () => {
    expect(engine.searchPhrase("brown fox").sort()).toEqual([1, 2, 3]);
  });
});

// ──────────────────────────────────────────────
// 6. Document removal
// ──────────────────────────────────────────────
describe("document removal", () => {
  let engine: SearchEngine;

  beforeEach(() => {
    engine = new SearchEngine();
    engine.addDocument(1, "hello world");
    engine.addDocument(2, "hello there");
  });

  test("after removal, doc no longer found", () => {
    engine.removeDocument(1);
    expect(engine.search("hello")).toEqual([2]);
    expect(engine.search("world")).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// 7. False positive prevention
// ──────────────────────────────────────────────
describe("false positive prevention", () => {
  let engine: SearchEngine;

  beforeEach(() => {
    engine = new SearchEngine();
    engine.addDocument(1, "abcxyd");
  });

  test("'abcd' should not match 'abcxyd'", () => {
    // doc "abcxyd": tokens = ["abc", "bcx", "cxy", "xyd"]
    // query "abcd": tokens = ["abc", "bcd"]
    // "abc" matches, but "bcd" not in index → intersection = []
    expect(engine.search("abcd")).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// 8. Edge cases
// ──────────────────────────────────────────────
describe("edge cases", () => {
  let engine: SearchEngine;

  beforeEach(() => {
    engine = new SearchEngine();
  });

  test("empty query returns empty", () => {
    engine.addDocument(1, "anything");
    expect(engine.search("")).toEqual([]);
    expect(engine.searchPhrase("")).toEqual([]);
  });

  test("single char search works", () => {
    engine.addDocument(1, "a b c");
    expect(engine.search("a")).toEqual([1]);
  });

  test("empty doc doesn't break search", () => {
    engine.addDocument(1, "");
    engine.addDocument(2, "hello");
    expect(engine.search("hello")).toEqual([2]);
  });
});

// ──────────────────────────────────────────────
// 9. Multiple documents
// ──────────────────────────────────────────────
describe("multiple document index", () => {
  let engine: SearchEngine;

  beforeEach(() => {
    engine = new SearchEngine();
    for (let i = 0; i < 100; i++) {
      engine.addDocument(i, `document number ${i} has some text`);
    }
  });

  test("search finds correct docs from 100", () => {
    const result = engine.search("document");
    expect(result.length).toBe(100);
  });

  test("search specific substring", () => {
    const result = engine.search("number 42");
    expect(result).toContain(42);
    expect(result.length).toBe(1);
  });

  test("phrase search across 100 docs", () => {
    const result = engine.searchPhrase("has some");
    expect(result.length).toBe(100);
  });
});

// ──────────────────────────────────────────────
// 10. Prefix search (1-char and 2-char queries)
// ──────────────────────────────────────────────
describe("prefix search", () => {
  let engine: SearchEngine;

  beforeEach(() => {
    engine = new SearchEngine({ removeDiacritics: 1, prefixSearch: true });
    engine.addDocument(1, "hello world");
    engine.addDocument(2, "hello there");
    engine.addDocument(3, "goodbye world");
    engine.addDocument(4, "hippopotamus");
    engine.addDocument(5, "café");
    engine.addDocument(6, "a x y");
    engine.addDocument(7, "a-arrow-down");
    engine.addDocument(8, "arrow-up");
  });

  test("1-char query 'h' matches docs with words starting with h", () => {
    const result = engine.search("h").sort();
    expect(result).toEqual([1, 2, 4]);
  });

  test("1-char query 'w' matches docs with words starting with w", () => {
    const result = engine.search("w").sort();
    expect(result).toEqual([1, 3]);
  });

  test("2-char query 'he' matches docs with words starting with he", () => {
    const result = engine.search("he").sort();
    expect(result).toEqual([1, 2]);
  });

  test("2-char query 'wo' matches docs with words starting with wo", () => {
    const result = engine.search("wo").sort();
    expect(result).toEqual([1, 3]);
  });

  test("3-char query 'hel' works via trigram path", () => {
    const result = engine.search("hel").sort();
    expect(result).toEqual([1, 2]);
  });

  test("mixed 1-char + 2-char query 'h wo' intersects results", () => {
    const result = engine.search("h wo").sort();
    expect(result).toEqual([1]);
  });

  test("mixed 1-char + 3-char query 'h wor' intersects results", () => {
    const result = engine.search("h wor").sort();
    expect(result).toEqual([1]);
  });

  test("query 'hi' matches 'hippopotamus' but not 'hello'", () => {
    const result = engine.search("hi");
    expect(result).toEqual([4]);
  });

  test("prefix search with diacritics", () => {
    expect(engine.search("c")).toContain(5);
    expect(engine.search("ca")).toContain(5);
    expect(engine.search("caf")).toContain(5);
    expect(engine.search("cafe")).toContain(5);
  });

  test("phrase search with all-long tokens uses position adjacency", () => {
    expect(engine.searchPhrase("hello world")).toEqual([1]);
  });

  test("phrase search with short tokens falls back to substring", () => {
    const result = engine.searchPhrase("he wo");
    expect(result).toContain(1);
  });

  test("non-matching prefix query returns empty", () => {
    // No docs have words starting with "x", so prefix index returns empty
    const result = engine.search("xy");
    expect(result).toEqual([]);
  });

  test("removal works with prefix search", () => {
    engine.removeDocument(1);
    const result = engine.search("h").sort();
    expect(result).toEqual([2, 4]);
  });

  test("empty query returns empty", () => {
    expect(engine.search("")).toEqual([]);
    expect(engine.searchPhrase("")).toEqual([]);
  });

  test("backward compat: engine without prefixSearch uses trigram substrings", () => {
    const old = new SearchEngine();
    old.addDocument(1, "hello world");
    expect(old.search("hello")).toEqual([1]);
    // Without prefixSearch, 2-char "he" falls through to full-text scan → matches
    expect(old.search("he")).toEqual([1]);
    expect(old.search("xyz")).toEqual([]);
    expect(old.searchPhrase("hello world")).toEqual([1]);
  });

  test("single-char prefix in longer query still works", () => {
    expect(engine.search("a")).toContain(6);
    expect(engine.search("x")).toContain(6);
    expect(engine.search("y")).toContain(6);
  });

  test("search 'arrow' return 7 and 8", () => {
    expect(engine.search("arrow")).toEqual([7, 8]);
  });
});
