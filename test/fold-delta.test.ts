// Conformance for the canonical diacritic delta in `data/fold.json`.
//
// Every language that folds app-side (JS, Go, Rust, Java, .NET, ...) must load
// that file and reproduce these results. This suite is the JS half of that
// contract; port it alongside any new loader.
//
// to run: bun test

import { describe, test, expect } from "bun:test";
import foldData from "../data/fold.json";
import { fold, removeDiacritics } from "../src/unicode";
import type { TokenizerOptions } from "../src/types";

interface Entry {
  from: number;
  to: string;
  char: string;
}

const ENTRIES = foldData.fold as Entry[];

const OPTS: TokenizerOptions = {
  caseSensitive: false,
  removeDiacritics: 1,
};

describe("fold delta (data/fold.json)", () => {
  test("declares a version and at least one rule", () => {
    expect(foldData.version).toBe(1);
    expect(ENTRIES.length).toBeGreaterThan(0);
  });

  test("each rule's `char` matches its `from` codepoint", () => {
    for (const e of ENTRIES) {
      expect(String.fromCodePoint(e.from)).toBe(e.char);
    }
  });

  test("no duplicate `from` codepoints", () => {
    const seen = new Set<number>();
    for (const e of ENTRIES) {
      expect(seen.has(e.from)).toBe(false);
      seen.add(e.from);
    }
  });

  test("removeDiacritics applies every rule", () => {
    for (const e of ENTRIES) {
      expect(removeDiacritics(e.char)).toBe(e.to);
    }
  });

  test("fold() case-folds first, then applies the rule", () => {
    for (const e of ENTRIES) {
      expect(fold(e.char, OPTS)).toBe(e.to.toLowerCase());
    }
  });

  test("delta is applied inside a word, not as a replacement of the whole string", () => {
    expect(fold("Đại dương", OPTS)).toBe("dai duong");
    expect(fold("cửa sổ mới", OPTS)).toBe("cua so moi");
  });

  test("multi-codepoint rules expand", () => {
    expect(fold("Straße", OPTS)).toBe("strasse");
    expect(fold("ﬁn", OPTS)).toBe("fin");
    expect(fold("Œuvre", OPTS)).toBe("oeuvre");
  });

  test("every replacement is 1..N codepoints and never empty", () => {
    for (const e of ENTRIES) {
      expect(e.to.length).toBeGreaterThan(0);
      expect([...e.to].length).toBeGreaterThan(0);
    }
  });
});
