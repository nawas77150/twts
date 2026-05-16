// ============================================================
// content-filter.ts — Auto-approve filter engine for tweetfess
// ============================================================
// Submissions that pass the filter are auto-approved & posted.
// Flagged submissions go to pending for manual admin review.
// ============================================================

import { MS_24H } from '@/lib/constants'

// --- Default Blocked Words List ---
// Indonesian profanity (from community wordlists: Filter-Kata-Kotor, menfess rules)
// + English profanity
// + Marketplace tags (WTS/WTB/WTT/LF)
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

// --- Filter Rule Types ---

export interface FilterRules {
  blockedWords: boolean    // Profanity + SARA blocked words
  jualan: boolean          // WTS/WTB/WTT/LF marketplace tags
  urls: boolean            // Links/URLs
  mentions: boolean        // @username tagging
  phoneNumbers: boolean   // Doxxing: phone number patterns
  nsfw: boolean           // NSFW/explicit content (OFF by default)
  capsSpam: boolean       // ALL CAPS spam (>80% uppercase)
  repeatedChars: boolean  // Repeated characters (6+ in a row)
  tooShort: boolean       // Too short (< 5 chars)
  duplicate24h: boolean   // Exact duplicate within 24h
}

export const DEFAULT_FILTER_RULES: FilterRules = {
  blockedWords: true,
  jualan: true,
  urls: true,
  mentions: true,
  phoneNumbers: true,
  nsfw: false,          // OFF by default for Alter menfess
  capsSpam: true,
  repeatedChars: true,
  tooShort: true,
  duplicate24h: true,
}

// Non-toggleable rules (always enforced regardless of settings)
// These cause outright rejection (not pending) — spam/low-quality with zero chance of approval
const ALWAYS_ON_RULES: (keyof FilterRules)[] = [
  'capsSpam',
  'tooShort',
  'duplicate24h',
]

// Reason strings produced by always-on rules
export const ALWAYS_ON_REASONS: string[] = [
  'caps_spam',
  'too_short',
  'duplicate_24h',
]

// Check if any of the given reasons come from always-on rules
export function hasAlwaysOnReason(reasons: string[]): boolean {
  return reasons.some(r => ALWAYS_ON_REASONS.includes(r))
}

// Get user-friendly error message for always-on rejections
export function getRejectionMessage(reasons: string[]): string {
  const messages: string[] = []

  for (const reason of reasons) {
    switch (reason) {
      case 'caps_spam':
        messages.push('Pesan menggunakan huruf kapital semua (ALL CAPS). Gunakan huruf biasa.')
        break
      case 'repeated_characters':
        messages.push('Pesan mengandung karakter berulang berlebihan.')
        break
      case 'too_short':
        messages.push('Pesan terlalu pendek. Minimal 5 karakter.')
        break
      case 'duplicate_24h':
        messages.push('Pesan ini sudah dikirim dalam 24 jam terakhir.')
        break
    }
  }

  return messages.join(' ')
}

// --- Filter Result ---

export type FilterSeverity = 'none' | 'low' | 'medium' | 'high'

export interface FilterResult {
  passed: boolean          // true = auto-approve, false = needs manual review
  reasons: string[]        // Why it was flagged (empty if passed)
  matchedWords?: string[]  // Which blocked words were found
  severity: FilterSeverity
}

// --- Text Normalization ---
// Removes zero-width chars, normalizes Unicode, strips diacritical tricks,
// and transliterates confusable homoglyphs (Cyrillic/Greek → Latin).

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

export function normalizeText(text: string): string {
  return text
    // 1. Strip ALL invisible/control characters
    .replace(/[\u200B-\u200D\uFEFF\u00AD\u200E-\u200F\u2028-\u202F\u180E\u2060-\u2069\u034F\uFE00-\uFE0F]/g, '')
    // 2. Decompose → separate base chars from combining marks
    .normalize('NFD')
    // 3. Strip combining marks (Zalgo, strikethroughs, diacritics)
    .replace(/[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g, '')
    // 4. NFKC normalize (fullwidth → ASCII, etc.)
    .normalize('NFKC')
    // 5. Replace homoglyphs (Cyrillic/Greek → Latin)
    .replace(/[^\x00-\x7F]/g, (ch) => HOMOGLYPH_MAP[ch] || ch)
    // 6. Strip remaining non-word chars (keep word chars, spaces, @)
    .replace(/[^\w\s@]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// --- Individual Filter Checks ---

function checkBlockedWords(
  message: string,
  blockedWords: string[],
): { matched: string[]; reasons: string[] } {
  const normalized = normalizeText(message).toLowerCase()
  const words = normalized.split(/\s+/)
  const matched: string[] = []
  const reasons: string[] = []

  for (const blocked of blockedWords) {
    const blockedLower = blocked.toLowerCase().trim()
    if (!blockedLower) continue

    // For multi-word blocked terms (e.g. "bunuh diri"), check substring in normalized text
    if (blockedLower.includes(' ')) {
      if (normalized.includes(blockedLower)) {
        matched.push(blocked)
        reasons.push(`blocked_word:${blocked}`)
      }
      continue
    }

    // Single word: match whole word only (word boundary)
    const escaped = blockedLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`\\b${escaped}\\b`, 'i')
    if (regex.test(normalized)) {
      matched.push(blocked)
      reasons.push(`blocked_word:${blocked}`)
    }

    // Also check each individual word for exact match
    if (words.includes(blockedLower) && !matched.includes(blocked)) {
      matched.push(blocked)
      reasons.push(`blocked_word:${blocked}`)
    }
  }

  return { matched, reasons }
}

function checkJualan(message: string): string[] {
  const reasons: string[] = []
  const normalized = normalizeText(message).toUpperCase()
  // Match WTS/WTB/WTT/LF as standalone tags (at word boundary or start of message)
  const patterns = [
    /\b(WTS|WTB|WTT)\b/,
    /\b(LF)\b(?=\s|$)/,  // LF followed by space or end-of-message (avoid matching "self" etc.)
  ]
  for (const pattern of patterns) {
    if (pattern.test(normalized)) {
      const match = normalized.match(pattern)
      if (match) {
        reasons.push(`jualan:${match[1]}`)
      }
    }
  }
  return reasons
}

function checkUrls(message: string): string[] {
  const reasons: string[] = []
  const urlPatterns = [
    /https?:\/\/\S+/i,
    /\bbit\.ly\/\S+/i,
    /\bt\.co\/\S+/i,
    /\btinyurl\.com\/\S+/i,
    /\bcutt\.ly\/\S+/i,
  ]
  for (const pattern of urlPatterns) {
    if (pattern.test(message)) {
      reasons.push('contains_url')
      break // one reason is enough
    }
  }
  return reasons
}

/**
 * Strip invisible/zero-width characters and normalize full-width characters
 * to prevent filter bypass via unicode tricks (e.g. zero-width chars between
 * phone number digits, full-width ＠ for mentions).
 */
function normalizeForFilter(text: string): string {
  return text
    .replace(/[\u200B-\u200D\uFEFF\u00AD\u200E-\u200F\u2028-\u202F]/g, '')
    .normalize('NFKC')
}

function checkMentions(message: string): string[] {
  const reasons: string[] = []
  // Normalize to catch full-width ＠ and zero-width chars between @ and username
  const normalized = normalizeForFilter(message)
  // Match @username (X/Twitter handles: letters, numbers, underscores)
  // Negative lookbehind for \w prevents matching email addresses (e.g. user@example.com)
  const mentionPattern = /(?<!\w)@(\w{1,15})\b/g
  const matches = normalized.match(mentionPattern)
  if (matches && matches.length > 0) {
    reasons.push(`contains_mention:${matches.length}`)
  }
  return reasons
}

function checkPhoneNumbers(message: string): string[] {
  const reasons: string[] = []
  // Normalize to strip zero-width chars between digits that bypass \d patterns
  const normalized = normalizeForFilter(message)
  // Indonesian phone numbers: 08xx, +62xx, 62xx
  const phonePatterns = [
    /(?:^|\s|\()(08\d{8,12})(?:\s|\)|$)/,
    /(?:^|\s|\()(\+62\d{8,12})(?:\s|\)|$)/,
    /(?:^|\s|\()(62\d{8,12})(?:\s|\)|$)/,
  ]
  for (const pattern of phonePatterns) {
    if (pattern.test(normalized)) {
      reasons.push('contains_phone_number')
      break
    }
  }
  return reasons
}

function checkCapsSpam(message: string): string[] {
  const reasons: string[] = []
  const alphaChars = message.replace(/[^a-zA-Z]/g, '')
  if (alphaChars.length > 10) {
    const upperChars = alphaChars.replace(/[^A-Z]/g, '')
    const ratio = upperChars.length / alphaChars.length
    if (ratio > 0.8) {
      reasons.push('caps_spam')
    }
  }
  return reasons
}

function checkRepeatedChars(message: string): string[] {
  const reasons: string[] = []
  // 6+ consecutive identical characters
  if (/(.)\1{5,}/.test(message)) {
    reasons.push('repeated_characters')
  }
  return reasons
}

function checkTooShort(message: string): string[] {
  const reasons: string[] = []
  const trimmed = message.trim()
  if (trimmed.length > 0 && trimmed.length < 5) {
    reasons.push('too_short')
  }
  return reasons
}

// Duplicate check is handled at the API level (needs DB query)
// This is the interface for the duplicate check result
export interface DuplicateCheckResult {
  isDuplicate: boolean
  reason?: string
}

export async function checkDuplicate24h(
  message: string,
  db: { submission: { findFirst: (args: { where: { submitterId: string; normalizedMessage: string; createdAt: { gte: Date } } }) => Promise<{ id: string } | null> } },
  submitterId: string,
): Promise<DuplicateCheckResult> {
  const twentyFourHoursAgo = new Date(Date.now() - MS_24H)
  const normalized = normalizeText(message)
  const existing = await db.submission.findFirst({
    where: {
      submitterId,
      normalizedMessage: normalized,
      createdAt: { gte: twentyFourHoursAgo },
    },
  })
  if (existing) {
    return { isDuplicate: true, reason: 'duplicate_24h' }
  }
  return { isDuplicate: false }
}

// --- Main Filter Function ---

export function runContentFilter(
  message: string,
  blockedWords: string[],
  rules: FilterRules,
  nsfwWords?: string[],
): FilterResult {
  // Merge always-on rules with user-configurable rules
  const effectiveRules = { ...rules }
  for (const key of ALWAYS_ON_RULES) {
    effectiveRules[key] = true // Always-on rules cannot be disabled
  }

  const reasons: string[] = []
  const matchedWords: string[] = []
  let severity: FilterSeverity = 'none'

  // 1. Blocked words (profanity + SARA)
  if (effectiveRules.blockedWords) {
    const result = checkBlockedWords(message, blockedWords)
    if (result.matched.length > 0) {
      matchedWords.push(...result.matched)
      reasons.push(...result.reasons)
      severity = 'high'
    }
  }

  // 2. NSFW words (OFF by default for Alter menfess)
  if (effectiveRules.nsfw && nsfwWords && nsfwWords.length > 0) {
    const result = checkBlockedWords(message, nsfwWords)
    if (result.matched.length > 0) {
      matchedWords.push(...result.matched)
      reasons.push(...result.reasons)
      if (severity === 'none') severity = 'medium'
    }
  }

  // 3. Jualan/Promosi
  if (effectiveRules.jualan) {
    const result = checkJualan(message)
    if (result.length > 0) {
      reasons.push(...result)
      if (severity === 'none') severity = 'medium'
    }
  }

  // 4. URLs
  if (effectiveRules.urls) {
    const result = checkUrls(message)
    if (result.length > 0) {
      reasons.push(...result)
      if (severity === 'none') severity = 'medium'
    }
  }

  // 5. @mentions
  if (effectiveRules.mentions) {
    const result = checkMentions(message)
    if (result.length > 0) {
      reasons.push(...result)
      if (severity === 'none') severity = 'medium'
    }
  }

  // 6. Phone numbers
  if (effectiveRules.phoneNumbers) {
    const result = checkPhoneNumbers(message)
    if (result.length > 0) {
      reasons.push(...result)
      if (severity === 'none') severity = 'high'
    }
  }

  // 7. ALL CAPS spam (always on)
  if (effectiveRules.capsSpam) {
    const result = checkCapsSpam(message)
    if (result.length > 0) {
      reasons.push(...result)
      if (severity === 'none') severity = 'low'
    }
  }

  // 8. Repeated characters (always on)
  if (effectiveRules.repeatedChars) {
    const result = checkRepeatedChars(message)
    if (result.length > 0) {
      reasons.push(...result)
      if (severity === 'none') severity = 'low'
    }
  }

  // 9. Too short (always on)
  if (effectiveRules.tooShort) {
    const result = checkTooShort(message)
    if (result.length > 0) {
      reasons.push(...result)
      if (severity === 'none') severity = 'low'
    }
  }

  // 10. Duplicate 24h — handled separately at API level (needs DB)
  // This check is NOT included here, it's added in the route handler

  const passed = reasons.length === 0

  return {
    passed,
    reasons,
    matchedWords: matchedWords.length > 0 ? matchedWords : undefined,
    severity: passed ? 'none' : severity,
  }
}

// --- Filter Reason Display Helpers ---
// NOTE: getFilterReasonLabel and getFilterReasonColor are defined in src/types/index.ts
// and imported by UI components. These helpers are kept only for the filter engine itself.

export function getFilterReasonColor(reason: string): string {
  if (reason.startsWith('blocked_word:') || reason === 'contains_phone_number') {
    return 'destructive' // red
  }
  if (reason.startsWith('nsfw_word:') || reason.startsWith('jualan:') || reason === 'contains_url') {
    return 'warning' // orange/yellow
  }
  return 'secondary' // gray
}
