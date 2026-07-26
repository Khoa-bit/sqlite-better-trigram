import { describe, test, expect } from "bun:test";
import { TrigramTokenizer } from "../src/tokenizer";

// ──────────────────────────────────────────────
// 1. Basic tokenization
// ──────────────────────────────────────────────
describe("basic tokenization", () => {
  const t = new TrigramTokenizer();

  test("3 chars → 1 trigram", () => {
    expect(t.tokenize("abc").map((x) => x.text)).toEqual(["abc"]);
  });

  test("4 chars → 2 trigrams", () => {
    expect(t.tokenize("abcd").map((x) => x.text)).toEqual(["abc", "bcd"]);
  });

  test("6 chars → 4 trigrams", () => {
    expect(t.tokenize("abcdef").map((x) => x.text)).toEqual([
      "abc",
      "bcd",
      "cde",
      "def",
    ]);
  });

  test("2 chars → emitted as-is", () => {
    expect(t.tokenize("ab").map((x) => x.text)).toEqual(["ab"]);
  });

  test("1 char → emitted as-is", () => {
    expect(t.tokenize("a").map((x) => x.text)).toEqual(["a"]);
  });

  test("empty string → no tokens", () => {
    expect(t.tokenize("").map((x) => x.text)).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// 2. Word boundaries (spaces)
// ──────────────────────────────────────────────
describe("word boundaries", () => {
  const t = new TrigramTokenizer();

  test("i am a bird", () => {
    expect(t.tokenize("i am a bird").map((x) => x.text)).toEqual([
      "i",
      "am",
      "a",
      "bir",
      "ird",
    ]);
  });

  test("a bird", () => {
    expect(t.tokenize("a bird").map((x) => x.text)).toEqual([
      "a",
      "bir",
      "ird",
    ]);
  });

  test("leading/trailing whitespace", () => {
    expect(t.tokenize("  spaced  ").map((x) => x.text)).toEqual([
      "spa",
      "pac",
      "ace",
      "ced",
    ]);
  });
});

// ──────────────────────────────────────────────
// 3. Case folding (default, case-insensitive)
// ──────────────────────────────────────────────
describe("case folding (default)", () => {
  const t = new TrigramTokenizer();

  test("HELLO → lowercased trigrams", () => {
    expect(t.tokenize("HELLO").map((x) => x.text)).toEqual([
      "hel",
      "ell",
      "llo",
    ]);
  });

  test("Hello World", () => {
    expect(t.tokenize("Hello World").map((x) => x.text)).toEqual([
      "hel",
      "ell",
      "llo",
      "wor",
      "orl",
      "rld",
    ]);
  });
});

// ──────────────────────────────────────────────
// 4. Case sensitive mode
// ──────────────────────────────────────────────
describe("case sensitive mode", () => {
  const t = new TrigramTokenizer({ caseSensitive: true });

  test("HELLO preserves uppercase", () => {
    expect(t.tokenize("HELLO").map((x) => x.text)).toEqual([
      "HEL",
      "ELL",
      "LLO",
    ]);
  });

  test("CamelCase", () => {
    expect(t.tokenize("CamelCase").map((x) => x.text)).toEqual([
      "Cam",
      "ame",
      "mel",
      "elC",
      "lCa",
      "Cas",
      "ase",
    ]);
  });
});

// ──────────────────────────────────────────────
// 5. Diacritic removal
// ──────────────────────────────────────────────
describe("diacritic removal", () => {
  const t = new TrigramTokenizer({ removeDiacritics: 1 });

  test("café → cafe", () => {
    expect(t.tokenize("café").map((x) => x.text)).toEqual(["caf", "afe"]);
  });

  test("naïve", () => {
    expect(t.tokenize("naïve").map((x) => x.text)).toEqual([
      "nai",
      "aiv",
      "ive",
    ]);
  });

  test("combining tilde (abc̃def)", () => {
    expect(t.tokenize("abc\u0303def").map((x) => x.text)).toEqual([
      "abc",
      "bcd",
      "cde",
      "def",
    ]);
  });

  test("Đức → duc", () => {
    expect(t.tokenize("Đức").map((x) => x.text)).toEqual(["duc"]);
  });

  // ── custom diacritic patch chars ──

  test("tørv → tor orv (ø→o)", () => {
    expect(t.tokenize("tørv").map((x) => x.text)).toEqual(["tor", "orv"]);
  });

  test("độc → doc (đ→d)", () => {
    expect(t.tokenize("độc").map((x) => x.text)).toEqual(["doc"]);
  });

  test("ħaba → hab aba (ħ→h)", () => {
    expect(t.tokenize("ħaba").map((x) => x.text)).toEqual(["hab", "aba"]);
  });

  test("alı → ali (ı→i)", () => {
    expect(t.tokenize("alı").map((x) => x.text)).toEqual(["ali"]);
  });

  test("łódź → lod odz (ł→l)", () => {
    expect(t.tokenize("łódź").map((x) => x.text)).toEqual(["lod", "odz"]);
  });

  test("Æther → ath (Æ→a)", () => {
    expect(t.tokenize("Æther").map((x) => x.text)).toEqual(["ath", "the", "her"]);
  });

  test("æon → aon (æ→a)", () => {
    expect(t.tokenize("æon").map((x) => x.text)).toEqual(["aon"]);
  });

  test("Ðe → de (Ð→d)", () => {
    expect(t.tokenize("Ðe").map((x) => x.text)).toEqual(["de"]);
  });

  test("ðe → de (ð→d)", () => {
    expect(t.tokenize("ðe").map((x) => x.text)).toEqual(["de"]);
  });

  test("Þorn → tor (Þ→t)", () => {
    expect(t.tokenize("Þorn").map((x) => x.text)).toEqual(["tor", "orn"]);
  });

  test("þorn → tor (þ→t)", () => {
    expect(t.tokenize("þorn").map((x) => x.text)).toEqual(["tor", "orn"]);
  });

  test("İzmir → izm (İ→i)", () => {
    expect(t.tokenize("İzmir").map((x) => x.text)).toEqual(["izm", "zmi", "mir"]);
  });

  test("Œuvre → ouv (Œ→o)", () => {
    expect(t.tokenize("Œuvre").map((x) => x.text)).toEqual(["ouv", "uvr", "vre"]);
  });

  test("œuvre → ouv (œ→o)", () => {
    expect(t.tokenize("œuvre").map((x) => x.text)).toEqual(["ouv", "uvr", "vre"]);
  });

  test("works with level 2", () => {
    const t2 = new TrigramTokenizer({ removeDiacritics: 2 });
    expect(t2.tokenize("tørv").map((x) => x.text)).toEqual(["tor", "orv"]);
    expect(t2.tokenize("alı").map((x) => x.text)).toEqual(["ali"]);
    expect(t2.tokenize("Æther").map((x) => x.text)).toEqual(["ath", "the", "her"]);
    expect(t2.tokenize("Þorn").map((x) => x.text)).toEqual(["tor", "orn"]);
    expect(t2.tokenize("İzmir").map((x) => x.text)).toEqual(["izm", "zmi", "mir"]);
    expect(t2.tokenize("Œuvre").map((x) => x.text)).toEqual(["ouv", "uvr", "vre"]);
  });
});

// ──────────────────────────────────────────────
// 6. CJK tokenization
// ──────────────────────────────────────────────
describe("CJK tokenization", () => {
  const t = new TrigramTokenizer();

  test("Chinese characters each emit as single tokens", () => {
    expect(t.tokenize("李红：那是钢笔").map((x) => x.text)).toEqual([
      "李",
      "红",
      "：",
      "那",
      "是",
      "钢",
      "笔",
    ]);
  });

  test("CJK + Latin mixed", () => {
    expect(t.tokenize("你好world").map((x) => x.text)).toEqual([
      "你",
      "好",
      "wor",
      "orl",
      "rld",
    ]);
  });

  test("Latin + CJK mixed", () => {
    expect(t.tokenize("hello世界").map((x) => x.text)).toEqual([
      "hel",
      "ell",
      "llo",
      "世",
      "界",
    ]);
  });
});

// ──────────────────────────────────────────────
// 7. Option validation
// ──────────────────────────────────────────────
describe("option validation", () => {
  test("remove_diacritics 3 → throws", () => {
    expect(() => new TrigramTokenizer({ removeDiacritics: 3 })).toThrow();
  });

  test("remove_diacritics -1 → throws", () => {
    expect(() => new TrigramTokenizer({ removeDiacritics: -1 })).toThrow();
  });

  test("case_sensitive + remove_diacritics → throws", () => {
    expect(
      () => new TrigramTokenizer({ caseSensitive: true, removeDiacritics: 1 }),
    ).toThrow();
  });

  test("remove_diacritics 2 → OK", () => {
    expect(
      () => new TrigramTokenizer({ removeDiacritics: 2 }),
    ).not.toThrow();
  });
});

// ──────────────────────────────────────────────
// 8. Offset correctness
// ──────────────────────────────────────────────
describe("offset correctness", () => {
  const t = new TrigramTokenizer();

  test("simple offsets", () => {
    const tokens = t.tokenize("hello world");
    expect(tokens[0]).toEqual({ text: "hel", startOffset: 0, endOffset: 3 });
    // "hello" → tokens[0]=hel(0-3), [1]=ell(1-4), [2]=llo(2-5)
    // space resets
    // "world" → tokens[3]=wor(6-9), [4]=orl(7-10), [5]=rld(8-11)
    expect(tokens[2]).toEqual({ text: "llo", startOffset: 2, endOffset: 5 });
    expect(tokens[3]).toEqual({ text: "wor", startOffset: 6, endOffset: 9 });
  });
});

// ──────────────────────────────────────────────
// 9. Null byte filtering
// ──────────────────────────────────────────────
describe("null byte filtering", () => {
  const t = new TrigramTokenizer();
  test("null byte skipped", () => {
    expect(t.tokenize("ab\u0000cd").map((x) => x.text)).toEqual([
      "abc",
      "bcd",
    ]);
  });
});

// ──────────────────────────────────────────────
// 10. Edge cases
// ──────────────────────────────────────────────
describe("edge cases", () => {
  const t = new TrigramTokenizer();

  test("whitespace only → no tokens", () => {
    expect(t.tokenize("   ").map((x) => x.text)).toEqual([]);
  });

  test("multiple spaces between words", () => {
    expect(t.tokenize("hello   world").map((x) => x.text)).toEqual([
      "hel",
      "ell",
      "llo",
      "wor",
      "orl",
      "rld",
    ]);
  });
});

// ──────────────────────────────────────────────
// 11. Emoji
// ──────────────────────────────────────────────
describe("emoji", () => {
  const t = new TrigramTokenizer();

  test("single emoji", () => {
    const tokens = t.tokenize("🎉").map((x) => x.text);
    // Emoji treated as regular char in buffer
    // Single surrogate pair → should emit as-is (< 3 chars)
    expect(tokens).toEqual(["🎉"]);
  });

  test("emoji surrounded by text", () => {
    const tokens = t.tokenize("abc🎉def").map((x) => x.text);
    // a b c 🎉 d e f → trigrams cross emoji boundary
    expect(tokens).toContain("abc");
    expect(tokens).toContain("def");
  });
});
