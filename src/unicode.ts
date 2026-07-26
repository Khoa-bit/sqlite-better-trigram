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
  for (const [lo, hi] of CJK_RANGES) {
    if (codepoint < lo) break;
    if (codepoint <= hi) return true;
  }
  return false;
}

/**
 * Custom diacritic mappings for characters not handled by NFD decomposition.
 * Mirrors the custom patch in gen-fold-table.c.
 *
 * These characters (Ø, Đ, Ħ, ı, Ł, Ơ, Ư) have strokes or marks that don't
 * decompose in NFD, so stripping combining marks alone is insufficient.
 */
const CUSTOM_DIACRITIC_MAP: Record<number, string> = {
  0x00C6: "A", // Æ
  0x00E6: "a", // æ
  0x00D0: "D", // Ð
  0x00D8: "O", // Ø
  0x00F0: "d", // ð
  0x00F8: "o", // ø
  0x00DE: "T", // Þ
  0x00FE: "t", // þ
  0x0110: "D", // Đ
  0x0111: "d", // đ
  0x0126: "H", // Ħ
  0x0127: "h", // ħ
  0x0130: "I", // İ (dotted i)
  0x0131: "i", // ı (dotless i)
  0x0141: "L", // Ł
  0x0142: "l", // ł
  0x0152: "O", // Œ
  0x0153: "o", // œ
  0x01A0: "O", // Ơ
  0x01A1: "o", // ơ
  0x01AF: "U", // Ư
  0x01B0: "u", // ư
};

const CUSTOM_DIACRITIC_RX =
  /[\u00C6\u00E6\u00D0\u00D8\u00F0\u00F8\u00DE\u00FE\u0110\u0111\u0126\u0127\u0130\u0131\u0141\u0142\u0152\u0153\u01A0\u01A1\u01AF\u01B0]/g;

/**
 * Fold a single character: case-fold + optional diacritic removal.
 *
 * Mirrors C customFold() — each codepoint maps to exactly one output.
 * Returns null if the character should be skipped (e.g. combining mark
 * that folds to nothing), matching C's do-while(iCode==0) skip.
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
  // JS toLowerCase can expand (e.g. ß→ss). Take first codepoint.
  if (result.length > 1) {
    result = String.fromCodePoint(result.codePointAt(0)!);
  }

  // Diacritic removal per-character (C: customFold → aFoldDiacriticTable → 0)
  if (options.removeDiacritics) {
    const decomposed = result.normalize("NFD");
    // Strip combining diacritical marks (C: codepoint folds to 0 → skip)
    const stripped = decomposed.replace(/\p{M}/gu, "");
    if (stripped.length === 0) return null; // combining mark → skip
    // Apply custom mappings for chars NFD can't decompose (e.g. Ø, Đ, Ħ, ı, Ł)
    result = CUSTOM_DIACRITIC_MAP[stripped.codePointAt(0)!] ?? stripped;
  }

  return result;
}

/**
 * Remove diacritical marks from text.
 * NFD decompose → strip all marks (Unicode category M).
 */
export function removeDiacritics(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(CUSTOM_DIACRITIC_RX, (ch) => CUSTOM_DIACRITIC_MAP[ch.codePointAt(0)!] ?? ch);
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
