// ============================================================
// content-filter-engine.ts — Rule engine + main filter + display helpers
//
// Contains:
//   - Filter types (FilterRules, FilterResult, FilterSeverity)
//   - Default filter rules + always-on rules config
//   - RULE_CHECKERS table (maps rule keys → check functions)
//   - runContentFilter() — main entry point
//   - hasAlwaysOnReason() — rejection classification
//   - getRejectionMessage() — user-facing error messages
//
// Imports from: content-filter-blocked, content-filter-checks
// ============================================================

import { checkBlockedWords, DEFAULT_SELF_HARM_KEYWORDS, DEFAULT_CSAM_SEXUAL_TERMS, DEFAULT_CSAM_AGE_INDICATORS, DEFAULT_SOLICITATION_SEXUAL_TERMS, DEFAULT_SOLICITATION_PAYMENT_TERMS } from './content-filter-blocked'
import {
  checkJualan,
  checkUrls,
  checkMentions,
  checkPhoneNumbers,
  checkCapsSpam,
  checkRepeatedChars,
  checkTooShort,
  checkCsam,
  checkSolicitation,
  checkPii,
} from './content-filter-checks'

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
  selfHarm: boolean       // Self-harm / suicide keywords (always-on)
  csam: boolean           // CSAM / child safety (always-on)
  solicitation: boolean   // Paid sexual solicitation (always-on)
  pii: boolean            // PII: email, NIK, IP, NPWP
}

export type FilterSeverity = 'none' | 'low' | 'medium' | 'high'

export interface FilterResult {
  passed: boolean          // true = auto-approve, false = needs manual review
  reasons: string[]        // Why it was flagged (empty if passed)
  matchedWords?: string[]  // Which blocked words were found
  severity: FilterSeverity
}

// --- Default Filter Rules ---

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
  selfHarm: true,       // Always-on — cannot be disabled
  csam: true,           // Always-on — cannot be disabled
  solicitation: true,   // Always-on — cannot be disabled
  pii: true,            // ON by default, admin can toggle
}

// Non-toggleable rules (always enforced regardless of settings)
// These cause outright rejection (not pending) — spam/low-quality or safety-critical
const ALWAYS_ON_RULES: (keyof FilterRules)[] = [
  'capsSpam',
  'tooShort',
  'duplicate24h',
  'selfHarm',       // X ban risk + user safety
  'csam',           // X ban risk + child safety
  'solicitation',   // X ban risk — account restriction trigger
]

// Reason prefixes produced by always-on rules.
// Used by hasAlwaysOnReason() — reasons may be exact ('caps_spam')
// or prefixed ('self_harm:bunuh diri'), so we match by prefix.
const ALWAYS_ON_REASON_PREFIXES: string[] = [
  'caps_spam',
  'too_short',
  'duplicate_24h',
  'self_harm',
  'csam_sexual',
  'csam_age',
  'solicitation_sexual',
  'solicitation_payment',
]

// Exported for reference — the canonical list of always-on reason prefixes
export const ALWAYS_ON_REASONS = ALWAYS_ON_REASON_PREFIXES

// Check if any of the given reasons come from always-on rules
// Uses prefix matching: 'self_harm:bunuh diri'.startsWith('self_harm') → true
export function hasAlwaysOnReason(reasons: string[]): boolean {
  return reasons.some(r => ALWAYS_ON_REASON_PREFIXES.some(p => r.startsWith(p)))
}

// --- Table-Driven Rule Engine ---

interface RuleCheckResult {
  reasons: string[]
  matched?: string[]  // Only for word-matching rules (blockedWords, nsfw)
}

interface RuleChecker {
  ruleKey: keyof FilterRules
  severity: FilterSeverity
  alwaysOverrideSeverity?: boolean  // Only blockedWords sets this
  check: (message: string, extra?: { blockedWords?: string[]; nsfwWords?: string[] }) => RuleCheckResult
}

const RULE_CHECKERS: RuleChecker[] = [
  {
    ruleKey: 'blockedWords',
    severity: 'high',
    alwaysOverrideSeverity: true,  // severity = 'high' — unconditional
    check: (message, extra) => {
      if (!extra?.blockedWords?.length) return { reasons: [] }
      const result = checkBlockedWords(message, extra.blockedWords)
      return { reasons: result.reasons, matched: result.matched }
    },
  },
  {
    ruleKey: 'nsfw',
    severity: 'medium',
    check: (message, extra) => {
      if (!extra?.nsfwWords?.length) return { reasons: [] }
      const result = checkBlockedWords(message, extra.nsfwWords, 'nsfw_word')
      return { reasons: result.reasons, matched: result.matched }
    },
  },
  {
    ruleKey: 'selfHarm',
    severity: 'high',
    alwaysOverrideSeverity: true,  // Always high — user safety
    check: (message) => {
      const result = checkBlockedWords(message, DEFAULT_SELF_HARM_KEYWORDS, 'self_harm')
      return { reasons: result.reasons, matched: result.matched }
    },
  },
  {
    ruleKey: 'csam',
    severity: 'high',
    alwaysOverrideSeverity: true,  // Always high — child safety
    check: (message) => {
      return { reasons: checkCsam(message, DEFAULT_CSAM_SEXUAL_TERMS, DEFAULT_CSAM_AGE_INDICATORS) }
    },
  },
  {
    ruleKey: 'solicitation',
    severity: 'high',
    alwaysOverrideSeverity: true,  // Always high — X ban risk
    check: (message) => {
      return { reasons: checkSolicitation(message, DEFAULT_SOLICITATION_SEXUAL_TERMS, DEFAULT_SOLICITATION_PAYMENT_TERMS) }
    },
  },
  {
    ruleKey: 'pii',
    severity: 'high',
    check: (message) => ({ reasons: checkPii(message) }),
  },
  {
    ruleKey: 'jualan',
    severity: 'medium',
    check: (message) => ({ reasons: checkJualan(message) }),
  },
  {
    ruleKey: 'urls',
    severity: 'medium',
    check: (message) => ({ reasons: checkUrls(message) }),
  },
  {
    ruleKey: 'mentions',
    severity: 'medium',
    check: (message) => ({ reasons: checkMentions(message) }),
  },
  {
    ruleKey: 'phoneNumbers',
    severity: 'high',
    // NO alwaysOverrideSeverity — if (severity === 'none') severity = 'high'
    check: (message) => ({ reasons: checkPhoneNumbers(message) }),
  },
  {
    ruleKey: 'capsSpam',
    severity: 'low',
    check: (message) => ({ reasons: checkCapsSpam(message) }),
  },
  {
    ruleKey: 'repeatedChars',
    severity: 'low',
    check: (message) => ({ reasons: checkRepeatedChars(message) }),
  },
  {
    ruleKey: 'tooShort',
    severity: 'low',
    check: (message) => ({ reasons: checkTooShort(message) }),
  },
]

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

  // Run all applicable rule checkers
  const extra = { blockedWords, nsfwWords }

  for (const checker of RULE_CHECKERS) {
    if (!effectiveRules[checker.ruleKey]) continue

    const result = checker.check(message, extra)

    if (result.reasons.length > 0) {
      reasons.push(...result.reasons)
      if (result.matched) {
        matchedWords.push(...result.matched)
      }
      // Update severity — only upgrade, never downgrade
      if (checker.alwaysOverrideSeverity) {
        severity = checker.severity
      } else if (severity === 'none') {
        severity = checker.severity
      }
    }
  }

  // duplicate24h is handled at API level (needs DB), not in RULE_CHECKERS

  const passed = reasons.length === 0

  return {
    passed,
    reasons,
    matchedWords: matchedWords.length > 0 ? matchedWords : undefined,
    severity: passed ? 'none' : severity,
  }
}

// --- Display Helpers ---

// Get user-facing error message for always-on rejections
export function getRejectionMessage(reasons: string[]): string {
  const messages: string[] = []

  for (const reason of reasons) {
    // Extract prefix for matching — reasons may be 'self_harm:bunuh diri'
    const prefix = reason.includes(':') ? reason.split(':')[0] : reason

    switch (prefix) {
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
      case 'self_harm':
        messages.push('Pesan terdeteksi mengandung konten yang berhubungan dengan menyakiti diri. Jika kamu butuh bantuan, hubungi 119 atau Into The Light Indonesia.')
        break
      case 'csam_sexual':
      case 'csam_age':
        messages.push('Pesan terdeteksi mengandung konten yang melanggar keamanan anak.')
        break
      case 'solicitation_sexual':
      case 'solicitation_payment':
        messages.push('Pesan terdeteksi mengandung konten yang melanggar kebijakan X.')
        break
    }
  }

  return messages.join(' ')
}
