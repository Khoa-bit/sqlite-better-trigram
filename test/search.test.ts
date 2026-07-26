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
