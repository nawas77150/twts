// ============================================================
// content-filter-checks.ts — Individual filter checks + duplicate
//
// All individual filter check functions (except checkBlockedWords,
// which lives in content-filter-blocked.ts due to its different
// signature).
//
// Each check function takes a message string and returns string[]
// of reason codes. They use normalizeText or normalizeForFilter
// from content-filter-normalize depending on their needs.
//
// Also contains checkDuplicate24h (async, DB-dependent) and its
// return type DuplicateCheckResult.
//
// Imports from: content-filter-normalize, @/lib/constants
// ============================================================

import { normalizeText, normalizeForFilter } from './content-filter-normalize'
import { MS_24H } from '@/lib/constants'

// --- Marketplace Tag Check ---

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

// --- URL Check ---

function checkUrls(message: string): string[] {
  const reasons: string[] = []
  // Normalize to strip zero-width characters that break URL regex patterns
  // (e.g. "https\u200B://evil.com" bypasses /https?:\/\/\S+/ without normalization)
  const normalized = normalizeForFilter(message)
  const urlPatterns = [
    /https?:\/\/\S+/i,
    /\bbit\.ly\/\S+/i,
    /\bt\.co\/\S+/i,
    /\btinyurl\.com\/\S+/i,
    /\bcutt\.ly\/\S+/i,
  ]
  for (const pattern of urlPatterns) {
    if (pattern.test(normalized)) {
      reasons.push('contains_url')
      break // one reason is enough
    }
  }
  return reasons
}

// --- Mention Check ---

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

// --- Phone Number Check ---

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

// --- Caps Spam Check ---

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

// --- Repeated Characters Check ---

function checkRepeatedChars(message: string): string[] {
  const reasons: string[] = []
  // 6+ consecutive identical characters
  if (/(.)\1{5,}/.test(message)) {
    reasons.push('repeated_characters')
  }
  return reasons
}

// --- Too Short Check ---

function checkTooShort(message: string): string[] {
  const reasons: string[] = []
  const trimmed = message.trim()
  if (trimmed.length > 0 && trimmed.length < 5) {
    reasons.push('too_short')
  }
  return reasons
}

// --- Duplicate 24h Check ---

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
  // Empty string can't be a meaningful duplicate fingerprint — skip the query
  // to avoid false-positive matches against legacy rows with @default("")
  if (!normalized) return { isDuplicate: false }
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

// --- Re-export check functions for engine ---
// These are used by RULE_CHECKERS in content-filter-engine.ts.
// They are not exported to external consumers — only to engine.

export {
  checkJualan,
  checkUrls,
  checkMentions,
  checkPhoneNumbers,
  checkCapsSpam,
  checkRepeatedChars,
  checkTooShort,
}
