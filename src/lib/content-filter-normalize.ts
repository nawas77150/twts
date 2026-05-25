// ============================================================
// content-filter-normalize.ts — Text normalization + sanitization
//
// Provides all text transformation primitives used by the content
// filter pipeline: HTML stripping, entity decoding, Unicode
// normalization, homoglyph transliteration, and zero-width char removal.
//
// No internal deps — fully self-contained. All other content-filter-*
// modules import from here.
// ============================================================

// --- Homoglyph Map ---
// Common cross-script homoglyphs that NFKC doesn't catch.
// These are visually identical but have different codepoints.

const HOMOGLYPH_MAP: Record<string, string> = {
  // Cyrillic → Latin
  '\u0430': 'a', // а → a
  '\u0435': 'e', // е → e
  '\u043E': 'o', // о → o
  '\u0440': 'p', // р → p
  '\u0441': 'c', // с → c
  '\u0443': 'y', // у → y
  '\u0445': 'x', // х → x
  '\u0456': 'i', // і → i
  '\u04BB': 'h', // һ → h
  '\u0458': 'j', // ј → j
  '\u0455': 's', // ѕ → s
  // Greek → Latin
  '\u03BF': 'o', // ο → o
  '\u03B9': 'i', // ι → i
  '\u03B1': 'a', // α → a
  '\u03B5': 'e', // ε → e
  '\u03BA': 'k', // κ → k
  '\u03BD': 'v', // ν → v
  '\u03C1': 'p', // ρ → p
  '\u03C4': 't', // τ → t
  '\u03C7': 'x', // χ → x
}

// --- HTML Sanitization ---

/**
 * Strip HTML tags and null bytes from user input.
 * Does NOT HTML-encode special characters — the stored text must be:
 *   - Plain text for X API (tweets are not HTML)
 *   - Rendered via React JSX ({message}) which auto-escapes for display
 *
 * Handles:
 * - HTML tags: <script>, <img onerror=...>, <a href=javascript:...>, etc.
 * - Event handlers in "hrefless" tags: <b onclick=...>
 * - Null bytes that can truncate strings in some parsers
 */
export function sanitizeInput(input: string): string {
  return input
    // Null bytes — can truncate strings in some C-derived parsers
    .replace(/\0/g, '')
    // HTML tags — strip anything between < and >
    // This catches <script>, <img onerror=...>, <svg/onload=...>, etc.
    .replace(/<[^>]*>/g, '')
}

// --- HTML Entity Decoding ---

/**
 * Decode HTML entities back to their literal characters.
 * Needed for backward compatibility with existing DB records that were
 * stored by the old sanitizeHtml() which HTML-encoded &, <, >, ", '.
 * Those entities render literally in X tweets (plain text, not HTML).
 *
 * Safe to call on already-decoded text — decodes only known entities.
 */
export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
}

// --- Full Text Normalization (for word matching) ---

/**
 * Normalize text for content filtering:
 * 1. Strip invisible/format characters (non-combining only)
 * 2. NFD decompose → separate base chars from combining marks
 * 3. Strip combining marks (Zalgo, strikethroughs, diacritics, variation selectors)
 * 4. NFKC normalize (fullwidth → ASCII, etc.)
 * 5. Replace homoglyphs (Cyrillic/Greek → Latin)
 * 6. Lowercase
 * 7. Strip remaining non-word chars
 *
 * Used by checkBlockedWords (word matching) and checkDuplicate24h (dedup).
 */
export function normalizeText(text: string): string {
  return text
    // 1. Strip invisible/format characters (non-combining only)
    //    Combining chars (\u034F, \uFE00-\uFE0F) are stripped after NFD on step 3.
    .replace(/[\u200B-\u200D\uFEFF\u00AD\u200E-\u200F\u2028-\u202F\u180E\u2060-\u2069]/g, '')
    // 2. Decompose → separate base chars from combining marks
    .normalize('NFD')
    // 3. Strip combining marks (Zalgo, strikethroughs, diacritics, variation selectors)
    //    \u034F (Combining Grapheme Joiner) is within \u0300-\u036F range.
    //    \uFE00-\uFE0F (Variation Selectors) moved here from step 1.
    .replace(/[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F\uFE00-\uFE0F]/g, '')
    // 4. NFKC normalize (fullwidth → ASCII, etc.)
    .normalize('NFKC')
    // 5. Replace homoglyphs (Cyrillic/Greek → Latin)
    //    \P{ASCII} matches non-ASCII — semantically identical to [^\u0000-\u007F]
    //    but avoids referencing control character code points (Vercel HIGH warning).
    .replace(/\P{ASCII}/gu, (ch) => HOMOGLYPH_MAP[ch] || ch)
    // 6. Lowercase — ensures case-insensitive duplicate detection and
    //    consistent blocked word matching (prevents bypass by toggling case)
    .toLowerCase()
    // 7. Strip remaining non-word chars (keep word chars, spaces, @)
    .replace(/[^\w\s@]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// --- Light Normalization (for regex-based checks) ---

/**
 * Strip invisible/zero-width characters, combining marks, and normalize
 * full-width characters to prevent filter bypass via unicode tricks
 * (e.g. zero-width chars between phone number digits, full-width ＠ for
 * mentions, combining grapheme joiner \u034F between characters).
 *
 * Lighter than normalizeText() — preserves case and structure for regex matching.
 * Used by checkUrls, checkMentions, checkPii, checkCapsSpam,
 * checkRepeatedChars.
 */
export function normalizeForFilter(text: string): string {
  return text
    // 1. Strip invisible/format characters (non-combining only)
    //    Split into non-combining ranges to avoid mixing combining and
    //    base characters in one character class (SAST: character class
    //    cannot match a character and a combining character).
    //    - \u200B-\u200D: Zero-width space/joiner/non-joiner (non-combining)
    //    - \uFEFF: BOM / zero-width no-break space (non-combining)
    //    - \u00AD: Soft hyphen (non-combining)
    //    - \u200E-\u200F: LRM/RLM (non-combining directional marks)
    //    - \u2028-\u202E: Line/paragraph separators + directional controls
    //    - \u2060-\u2069: Word joiner + directional isolate controls
    //    - \uFE00-\uFE0F: Variation selectors (combining) — stripped after NFD on step 3
    .replace(/[\u200B-\u200D\uFEFF\u00AD\u200E-\u200F\u2028-\u202E\u2060-\u2069]/g, '')
    // 2. Decompose → separate base chars from combining marks
    .normalize('NFD')
    // 3. Strip combining marks (Zalgo, diacritics, \u034F CGJ, variation selectors)
    .replace(/[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F\uFE00-\uFE0F]/g, '')
    // 4. Compose → fullwidth → ASCII, etc.
    .normalize('NFKC')
}
