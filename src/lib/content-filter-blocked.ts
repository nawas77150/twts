// ============================================================
// content-filter-blocked.ts — Blocked word lists + word matching
//
// Contains the default blocked words (Indonesian profanity + English
// profanity + leet-speak variants), the default NSFW words list,
// and keyword lists for always-on safety rules (self-harm, CSAM,
// solicitation). Also contains checkBlockedWords() — the word-
// boundary matching function reused by multiple rule checkers.
//
// Imports from: content-filter-normalize (normalizeText only)
// ============================================================

import { normalizeText } from './content-filter-normalize'

// --- Default Blocked Words List ---
// Indonesian profanity (from community wordlists: Filter-Kata-Kotor, menfess rules)
// + English profanity
// + Marketplace tags (WTS/WTB/WTT) are handled by checkJualan() with more context
// For Alter menfess: NSFW/explicit is OFF by default — the community is more permissive.

export const DEFAULT_BLOCKED_WORDS: string[] = [
  // Indonesian profanity
  'anjing', 'anjim', 'anjir', 'anjrit', 'anjrot', 'asu', 'babi', 'bacot',
  'bajingan', 'banci', 'bangke', 'bangor', 'bangsat', 'bego', 'bejad',
  'bencong', 'bodat', 'bugil', 'bundir', 'bunuh', 'kontol', 'memek',
  'ngentot', 'pentil', 'perek', 'pepek', 'pecun', 'maho', 'lonte',
  'hencet', 'taptei', 'kampang', 'pilat', 'keparat', 'gembel', 'brengsek',
  'tai', 'taek', 'jembut', 'totong', 'kolop', 'pukimak', 'heang',
  'jancuk', 'dancuk', 'burit', 'titit', 'nenen', 'bejat', 'silit',
  'sempak', 'pantek', 'pantat', 'bagudung', 'babami', 'kanciang',
  'bungul', 'kimak', 'henceut', 'kacuk', 'borjong', 'klitoris',
  'kelentit', 'ngulum',
  // Leet-speak variants
  'ngntd', 'ngntt', 'kmk', 'mmk', 'jmbt', 'ppk', 'anjg',
  'bgsat', 'bgst', 'ktl', 'ktrll', 'bgn',
  // English profanity
  'fuck', 'fucking', 'shit', 'asshole', 'bitch', 'dick', 'pussy',
  'penis', 'vagina', 'damn', 'blowjob',
  // Marketplace tags (WTS/WTB/WTT) are handled by checkJualan() with more context
]

// NSFW/explicit words (OFF by default for Alter menfess, admin can enable)
export const DEFAULT_NSFW_WORDS: string[] = [
  'ngentod', 'entot', 'entod', 'colmek', 'coli', 'bokep',
  'telanjang', 'gangbang', 'sange', 'horny',
]

// --- Always-on Safety Rule Keyword Lists ---
// These are NOT admin-configurable — hardcoded to prevent weakening.

// Self-harm / suicide keywords — always-on rule
// Multi-word phrases use substring match in checkBlockedWords()
export const DEFAULT_SELF_HARM_KEYWORDS: string[] = [
  // Phrases (multi-word — checkBlockedWords uses substring match)
  'bunuh diri', 'mau mati', 'mau bunuh diri', 'pengen mati',
  'nggak mau hidup lagi', 'udah capek hidup', 'mau pergi aja',
  'gantung diri', 'minum racun', 'tidak ada alasan hidup',
  'pengen mati aja', 'udah gak tahan', 'nyawa udah habis',
  'lompat dari', 'udah nyerah', 'udah males hidup',
  // Single words (token match)
  'suicide', 'kill myself', 'end it all',
]

// CSAM — sexual term triggers (combined with age indicators via two-list intersection)
export const DEFAULT_CSAM_SEXUAL_TERMS: string[] = [
  'colmek', 'coli', 'coliin', 'colmekan', 'bokep',
  'ngentot', 'ngentod', 'entot', 'entod',
  'telanjang', 'sange', 'horny',
]

// CSAM — age indicator triggers (combined with sexual terms via two-list intersection)
export const DEFAULT_CSAM_AGE_INDICATORS: string[] = [
  // Multi-word phrases
  'anak kecil', 'anak smp', 'anak sd', 'anak tk',
  '10 tahun', '11 tahun', '12 tahun', '13 tahun',
  '14 tahun', '15 tahun', '16 tahun',
  'umur 10', 'umur 11', 'umur 12', 'umur 13',
  'umur 14', 'umur 15', 'umur 16',
  // Single words
  'underage', 'minor',
  // Abbreviations
  '10thn', '11thn', '12thn', '13thn', '14thn', '15thn',
]

// Solicitation — sexual euphemisms (combined with payment terms via two-list intersection)
// Only includes unambiguous terms — "temenin" alone is innocent, so it's not here
export const DEFAULT_SOLICITATION_SEXUAL_TERMS: string[] = [
  'beu', 'open bo', 'open booking', 'bookingan',
  'sepong', 'escort', 'ml', 'ons', 'fwb',
]

// Solicitation — payment indicators (combined with sexual euphemisms via two-list intersection)
export const DEFAULT_SOLICITATION_PAYMENT_TERMS: string[] = [
  'fee', 'berbayar', 'tarif', 'mahar', 'rate',
  'harga', 'donasi', 'dp', 'full bayar',
]

// --- Blocked Word Matching ---

/**
 * Check a message against a list of blocked words.
 * Different signature from other check functions:
 *   - Takes a word list + reason prefix (reused for both blockedWords and nsfw rules)
 *   - Returns { matched, reasons } instead of string[]
 *
 * Single words: exact token match (word-boundary semantics via split(/[^\w]+/)).
 * Also checks consecutive token pairs to catch punctuation-insertion bypasses
 * (e.g. "kon.tol" → tokens ["kon","tol"] → pair "kontol" matches).
 * Multi-word terms: substring match in normalized text.
 */
export function checkBlockedWords(
  message: string,
  blockedWords: string[],
  reasonPrefix = 'blocked_word',
): { matched: string[]; reasons: string[] } {
  const normalized = normalizeText(message).toLowerCase() // toLowerCase is redundant but safe — normalizeText already lowercases
  // Split on non-word chars (not just whitespace) to handle @prefix and other
  // non-word boundaries. After normalizeText(), text contains only \w chars,
  // spaces, and @ — so splitting on non-word chars gives exact word tokens
  // equivalent to \b word-boundary matching, without needing RegExp constructor.
  const words = normalized.split(/[^\w]+/).filter(Boolean)

  // Build a Set of tokens + consecutive token pairs for matching.
  // Pairs catch punctuation-insertion bypasses like "kon.tol" → "kontol"
  // without false positives on unrelated adjacent words like "ikon tol".
  const tokenSet = new Set<string>(words)
  for (let i = 0; i < words.length - 1; i++) {
    tokenSet.add(words[i] + words[i + 1])
  }

  const matched: string[] = []
  const reasons: string[] = []

  for (const blocked of blockedWords) {
    const blockedLower = blocked.toLowerCase().trim()
    if (!blockedLower) continue

    // For multi-word blocked terms (e.g. "bunuh diri"), check substring in normalized text
    if (blockedLower.includes(' ')) {
      if (normalized.includes(blockedLower)) {
        matched.push(blocked)
        reasons.push(`${reasonPrefix}:${blocked}`)
      }
      continue
    }

    // Single word: match against token set (exact tokens + consecutive pairs)
    // This replaces the previous RegExp constructor approach (Vercel CRITICAL:
    // "RegExp constructor with non-literal value") while preserving the same
    // word-boundary semantics. split(/[^\w]+/) produces the same word tokens
    // that \b would delineate. Consecutive pairs catch punctuation bypasses.
    if (tokenSet.has(blockedLower) && !matched.includes(blocked)) {
      matched.push(blocked)
      reasons.push(`${reasonPrefix}:${blocked}`)
    }
  }

  return { matched, reasons }
}
