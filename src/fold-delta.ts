// Loads and validates the canonical diacritic delta in `data/fold.json`.
//
// This module is deliberately separate from `unicode.ts` so the data file has
// exactly one owner. Any language (Go, Rust, Java, .NET, ...) loads the same
// file; the rules below are the contract it must satisfy.
//
// See `data/README.md` for the format.

import foldData from "../data/fold.json" with { type: "json" };

interface FoldDeltaEntry {
  /** Source codepoint. Exactly one codepoint — sequences are not supported. */
  from: number;
  /** Replacement. 1..N codepoints — may expand (e.g. ß → "ss", ﬁ → "fi"). */
  to: string;
}

const SUPPORTED_VERSION = 1;
const MAX_CODEPOINT = 0x10ffff;
const SURROGATE_LO = 0xd800;
const SURROGATE_HI = 0xdfff;

function fail(message: string): never {
  throw new Error(`data/fold.json: ${message}`);
}

function isSurrogate(codepoint: number): boolean {
  return codepoint >= SURROGATE_LO && codepoint <= SURROGATE_HI;
}

function loadEntries(): FoldDeltaEntry[] {
  const data = foldData as { version?: unknown; fold?: unknown };

  if (data.version !== SUPPORTED_VERSION) {
    fail(
      `unsupported version ${String(data.version)} (expected ${SUPPORTED_VERSION})`,
    );
  }
  if (!Array.isArray(data.fold)) {
    fail("`fold` must be an array");
  }

  const seen = new Set<number>();

  return data.fold.map((raw, i) => {
    const entry = raw as Record<string, unknown>;
    const where = `fold[${i}]`;
    const from = entry.from;
    const to = entry.to;
    const char = entry.char;

    if (
      typeof from !== "number" ||
      !Number.isInteger(from) ||
      from < 0 ||
      from > MAX_CODEPOINT
    ) {
      fail(`${where}.from must be an integer codepoint 0..0x10FFFF`);
    }
    if (isSurrogate(from)) {
      fail(`${where}.from must not be a surrogate (0xD800..0xDFFF)`);
    }
    if (typeof to !== "string" || to.length === 0) {
      fail(`${where}.to must be a non-empty string`);
    }
    if (char !== undefined) {
      if (typeof char !== "string" || [...char].length !== 1) {
        fail(`${where}.char must be exactly one codepoint`);
      }
      if (String.fromCodePoint(from) !== char) {
        fail(`${where}.char "${char}" does not match from ${from}`);
      }
    }
    if (seen.has(from)) {
      fail(`${where}.from ${from} is duplicated`);
    }
    seen.add(from);

    return { from, to };
  });
}

/**
 * The diacritic delta: source codepoint → replacement.
 *
 * Applied after NFD decomposition and combining-mark stripping. Values may be
 * multi-codepoint; consumers must expand one output codepoint at a time.
 */
export const FOLD_DELTA: ReadonlyMap<number, string> = new Map(
  loadEntries().map((e) => [e.from, e.to]),
);
