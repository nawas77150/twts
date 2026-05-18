// ============================================================
// content-filter-blocked.ts — Blocked word lists + word matching
//
// Contains the default blocked words (Indonesian profanity + English
// profanity + leet-speak variants) and the default NSFW words list.
// Also contains checkBlockedWords() — the word-boundary matching
// function used by both the blockedWords and nsfw rule checkers.
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

// --- Blocked Word Matching ---

/**
 * Check a message against a list of blocked words.
 * Different signature from other check functions:
 *   - Takes a word list + reason prefix (reused for both blockedWords and nsfw rules)
 *   - Returns { matched, reasons } instead of string[]
 *
 * Single words: exact token match (word-boundary semantics via split(/[^\w]+/)).
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

    // Single word: match whole word only (exact token match)
    // This replaces the previous RegExp constructor approach (Vercel CRITICAL:
    // "RegExp constructor with non-literal value") while preserving the same
    // word-boundary semantics. split(/[^\w]+/) produces the same word tokens
    // that \b would delineate.
    if (words.includes(blockedLower) && !matched.includes(blocked)) {
      matched.push(blocked)
      reasons.push(`${reasonPrefix}:${blocked}`)
    }
  }

  return { matched, reasons }
}
