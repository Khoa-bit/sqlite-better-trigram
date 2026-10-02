import { describe, test, expect } from "bun:test";
import { createTieredSearch } from "../src/tiered-search";

// ──────────────────────────────────────────────
// Generic (client-defined) tier ladder
// ──────────────────────────────────────────────
describe("generic tiered search", () => {
  // A completely different schema — the engine knows nothing about
  // title/keyword/description, only the configured fields + rules.
  function seed() {
    const search = createTieredSearch({
      fields: {
        name: {}, // single string
        tags: { multiple: true }, // string[]
        note: { group: "" }, // rankable but NOT indexed
      },
      tiers: [
        { field: "name", match: "exact" }, // 1
        { field: "name", match: "prefix" }, // 2
        { field: "tags", match: "exact" }, // 3
        { field: "tags", match: "prefix" }, // 4
        { field: "name", match: "contains" }, // 5
        { field: "tags", match: "contains" }, // 6
        { field: "note", match: "contains" }, // 7
      ],
      tokenizer: { removeDiacritics: 1 },
    });

    search.addDocument(1, { name: "red car" }); // 1 exact name
    search.addDocument(2, { name: "red car seat" }); // 2 name prefix
    search.addDocument(3, { name: "x", tags: ["red car"] }); // 3 exact tag
    search.addDocument(4, { name: "x", tags: ["red car big"] }); // 4 tag prefix
    search.addDocument(5, { name: "the red car" }); // 5 name contains
    search.addDocument(6, { name: "x", tags: ["a red car thing"] }); // 6 tag contains
    search.addDocument(7, { name: "x", note: "see the red car" }); // 7 (unindexed)
    search.addDocument(8, { name: "red", tags: ["car"] }); // split across indexes
    return search;
  }

  test("ranks by the configured ladder", () => {
    const search = seed();
    expect(search.search("red car").map((h) => [h.docId, h.tier])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 6],
    ]);
  });

  test("group '' is rankable but never a candidate", () => {
    const search = seed();
    // The rule exists and would fire...
    expect(search.tierOf(7, "red car")).toBe(7);
    // ...but the field is unindexed, so it is never retrieved.
    expect(search.candidates("red car")).not.toContain(7);
  });

  test("separate groups cannot satisfy a query across fields", () => {
    const search = seed();
    // doc 8 has "red" in `name` and "car" in `tags` — different indexes.
    expect(search.candidates("red car")).not.toContain(8);
    expect(search.search("red car").map((h) => h.docId)).not.toContain(8);
  });

  test("grouping fields into one index allows cross-field matches", () => {
    const search = createTieredSearch({
      fields: {
        title: { group: "content" },
        description: { group: "content" },
      },
      tiers: [{ field: "title", match: "contains" }],
      tokenizer: { removeDiacritics: 1 },
    });
    // "blue box" spans title + description, so it IS a candidate...
    search.addDocument(1, { title: "blue", description: "box" });
    expect(search.candidates("blue box")).toContain(1);
    // ...but no rule matches the whole query → unranked → dropped.
    expect(search.search("blue box")).toEqual([]);
  });

  test("a multiple field accepts a bare string", () => {
    const search = createTieredSearch({
      fields: { tag: { multiple: true } },
      tiers: [{ field: "tag", match: "exact" }],
      tokenizer: { removeDiacritics: 1 },
    });
    search.addDocument(1, { tag: "arrow" });
    expect(search.search("arrow")).toEqual([{ docId: 1, tier: 1 }]);
  });

  // ── lifecycle (engine API — no SQL counterpart) ──

  test("removeDocument drops a doc; re-adding works", () => {
    const search = seed();
    search.removeDocument(1);
    expect(search.search("red car").map((h) => h.docId)).not.toContain(1);
    expect(search.tierOf(1, "red car")).toBe(0);

    search.addDocument(1, { name: "red car" });
    expect(search.search("red car")[0]).toEqual({ docId: 1, tier: 1 });
  });

  test("empty query returns nothing", () => {
    expect(seed().search("")).toEqual([]);
  });
});
