import { FOLD_DELTA } from "./fold-delta";
import type { TokenizerOptions } from "./types";

/**
 * Whitespace codepoints — ported from tokenizer.c isWhitespace().
 * Tab, LF, VT, FF, CR, Space, NEL, NBSP.
 */
export function isWhitespace(codepoint: number): boolean {
  switch (codepoint) {
    case 0x09:
    case 0x0a:
    case 0x0b:
    case 0x0c:
    case 0x0d:
    case 0x20:
    case 0x85:
    case 0xa0:
      return true;
    default:
      return false;
  }
}

/**
 * CJK codepoint detection — ported from tokenizer.c isCJK().
 * 8 Unicode blocks, checked in order with early exit.
 */
const CJK_RANGES: readonly [number, number][] = [
  [0x3000, 0x30ff], // CJK Symbols, Hiragana, Katakana
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xff00, 0xffef], // Halfwidth and Fullwidth Forms
  [0x20000, 0x2ebef], // CJK Unified Ideographs Ext B/C/D/E/F
  [0x2f800, 0x2fa1f], // CJK Compatibility Ideographs Supplement
  [0x30000, 0x3134f], // CJK Unified Ideographs Extension G
];

export function isCJK(codepoint: number): boolean {
  // Fast-path: ASCII and common non-CJK scripts start well below CJK ranges
  if (codepoint < 0x2e80) return false;
  for (const [lo, hi] of CJK_RANGES) {
    if (codepoint < lo) break;
    if (codepoint <= hi) return true;
  }
  return false;
}

// The app-side diacritic delta lives in `data/fold.json`; `fold-delta.ts`
// loads and validates it. Do not inline mappings here — add them to the data
// file (see `data/README.md`) and its conformance test instead.

/**
 * Fold a single character: case-fold + optional diacritic removal.
 *
 * This is the app-side source of truth — it deliberately goes further than
 * the extension's `remove_diacritics`, which only strips combining marks.
 * Returns null if the character should be skipped (e.g. combining mark
 * that folds to nothing).
 */
export function foldChar(
  char: string,
  options: TokenizerOptions,
): string | null {
  const codepoint = char.codePointAt(0)!;

  // Null byte → skip (C: if(iCode==0) break)
  if (codepoint === 0) return null;

  // Case folding
  let result = options.caseSensitive ? char : char.toLowerCase();

  // ASCII has no diacritics → skip NFD entirely
  if (codepoint < 128) return result;

  // JS toLowerCase can expand for non-ASCII (e.g. ß→ss). Take first codepoint.
  if (result.length > 1) {
    result = String.fromCodePoint(result.codePointAt(0)!);
  }

  // Diacritic removal per-character (combining marks fold to nothing → skip)
  if (options.removeDiacritics) {
    const decomposed = result.normalize("NFD");
    // Strip combining diacritical marks (C: codepoint folds to 0 → skip)
    const stripped = decomposed.replace(/\p{M}/gu, "");
    if (stripped.length === 0) return null; // combining mark → skip
    // Apply delta mappings for chars NFD can't decompose (e.g. Ø, Đ, Ħ, ı, Ł)
    result = FOLD_DELTA.get(stripped.codePointAt(0)!) ?? stripped;
  }

  return result;
}

/**
 * Remove diacritical marks from text.
 *
 * Two steps, in order: NFD-decompose and strip combining marks (Unicode
 * category M), then apply the `data/fold.json` delta for characters NFD
 * cannot decompose. The delta value may be multi-codepoint, so the second
 * pass is a codepoint loop rather than a regex.
 */
export function removeDiacritics(text: string): string {
  const stripped = text.normalize("NFD").replace(/\p{M}/gu, "");
  let result = "";
  for (const ch of stripped) {
    result += FOLD_DELTA.get(ch.codePointAt(0)!) ?? ch;
  }
  return result;
}

/**
 * Apply case folding + optional diacritic removal to the full string.
 * Used for post-filter verification and query folding.
 */
export function fold(text: string, options: TokenizerOptions): string {
  let result = text;
  if (!options.caseSensitive) {
    result = result.toLowerCase();
  }
  if (options.removeDiacritics) {
    result = removeDiacritics(result);
  }
  return result;
}

/**
 * Validate TokenizerOptions — ported from C option validation.
 * remove_diacritics + case_sensitive=1 is rejected.
 */
export function validateOptions(options: TokenizerOptions): void {
  const rd = options.removeDiacritics;
  if (!Number.isInteger(rd) || rd < 0 || rd > 2) {
    throw new Error(
      `remove_diacritics must be 0, 1, or 2 (got ${rd})`,
    );
  }
  if (options.caseSensitive && options.removeDiacritics !== 0) {
    throw new Error(
      "cannot combine case_sensitive=1 with remove_diacritics",
    );
  }
}
