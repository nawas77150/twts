// ============================================================
// content-filter.ts — Auto-approve filter engine for tweetfess
// ============================================================
// Submissions that pass the filter are auto-approved & posted.
// Flagged submissions go to pending for manual admin review.
// ============================================================

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
  'ngntd', 'ngntt', 'kmk', 'mmk', 'jmbt', 'ppk', 'anjg', 'anjg',
  'bgsat', 'bgst', 'ktl', 'mmk', 'ktrll', 'bgn',
  // English profanity
  'fuck', 'fucking', 'shit', 'asshole', 'bitch', 'dick', 'pussy',
  'penis', 'vagina', 'damn', 'blowjob',
  // Marketplace tags
  'wts', 'wtb', 'wtt',
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
const ALWAYS_ON_RULES: (keyof FilterRules)[] = [
  'capsSpam',
  'repeatedChars',
  'tooShort',
  'duplicate24h',
]

// --- Filter Result ---

export type FilterSeverity = 'none' | 'low' | 'medium' | 'high'

export interface FilterResult {
  passed: boolean          // true = auto-approve, false = needs manual review
  reasons: string[]        // Why it was flagged (empty if passed)
  matchedWords?: string[]  // Which blocked words were found
  severity: FilterSeverity
}

// --- Text Normalization ---
// Removes zero-width chars, normalizes Unicode, strips diacritical tricks

function normalizeText(text: string): string {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')     // Zero-width chars
    .replace(/[\u00AD\u200B-\u200F\u2028-\u202F]/g, '') // More invisible chars
    .normalize('NFKC')                            // Normalize Unicode (e.g. Ａ → A)
    .replace(/[^\w\s@]/g, ' ')                    // Keep word chars, spaces, @
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
    /\bLF\b(?=\s)/,  // LF followed by space (to avoid matching "self" etc.)
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

function checkMentions(message: string): string[] {
  const reasons: string[] = []
  // Match @username (X/Twitter handles: letters, numbers, underscores)
  const mentionPattern = /@(\w{1,15})/g
  const matches = message.match(mentionPattern)
  if (matches && matches.length > 0) {
    reasons.push(`contains_mention:${matches.length}`)
  }
  return reasons
}

function checkPhoneNumbers(message: string): string[] {
  const reasons: string[] = []
  // Indonesian phone numbers: 08xx, +62xx, 62xx
  const phonePatterns = [
    /(?:^|\s|\()(08\d{8,12})(?:\s|\)|$)/,
    /(?:^|\s|\()(\+62\d{8,12})(?:\s|\)|$)/,
    /(?:^|\s|\()(62\d{8,12})(?:\s|\)|$)/,
  ]
  for (const pattern of phonePatterns) {
    if (pattern.test(message)) {
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
  submitterId: string,
  db: { submission: { findFirst: (args: { where: { message: string; createdAt: { gte: Date }; NOT?: { submitterId: string } } }) => Promise<{ id: string } | null> } },
): Promise<DuplicateCheckResult> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const existing = await db.submission.findFirst({
    where: {
      message,
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

export function getFilterReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    'caps_spam': 'ALL CAPS',
    'repeated_characters': 'Repeated Chars',
    'too_short': 'Too Short',
    'duplicate_24h': 'Duplicate (24h)',
    'contains_url': 'Contains Link',
    'contains_phone_number': 'Phone Number',
  }

  // Blocked word
  if (reason.startsWith('blocked_word:')) {
    const word = reason.replace('blocked_word:', '')
    const masked = word.length > 2
      ? word[0] + '*'.repeat(word.length - 2) + word[word.length - 1]
      : '**'
    return `Blocked: "${masked}"`
  }

  // NSFW word
  if (reason.startsWith('nsfw_word:')) {
    const word = reason.replace('nsfw_word:', '')
    const masked = word.length > 2
      ? word[0] + '*'.repeat(word.length - 2) + word[word.length - 1]
      : '**'
    return `NSFW: "${masked}"`
  }

  // Jualan
  if (reason.startsWith('jualan:')) {
    const tag = reason.replace('jualan:', '')
    return `Marketplace (${tag})`
  }

  // Mentions
  if (reason.startsWith('contains_mention:')) {
    return '@Mention'
  }

  return labels[reason] || reason
}

export function getFilterReasonColor(reason: string): string {
  if (reason.startsWith('blocked_word:') || reason === 'contains_phone_number') {
    return 'destructive' // red
  }
  if (reason.startsWith('nsfw_word:') || reason.startsWith('jualan:') || reason === 'contains_url') {
    return 'warning' // orange/yellow
  }
  return 'secondary' // gray
}
