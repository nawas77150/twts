import { describe, it, expect } from 'vitest'
import { runContentFilter, hasAlwaysOnReason, getRejectionMessage } from '@/lib/content-filter-engine'
import type { FilterRules } from '@/lib/content-filter-engine'

const ALL_OFF: FilterRules = {
  blockedWords: false,
  jualan: false,
  urls: false,
  mentions: false,
  nsfw: false,
  capsSpam: false,
  repeatedChars: false,
  tooShort: false,
  duplicate24h: false,
  selfHarm: false,
  csam: false,
  solicitation: false,
  pii: false,
}

describe('runContentFilter', () => {
  it('passes clean messages', () => {
    const result = runContentFilter('halo apa kabar', [], { ...ALL_OFF })
    expect(result.passed).toBe(true)
    expect(result.reasons).toEqual([])
    expect(result.severity).toBe('none')
  })

  it('flags blocked words with high severity', () => {
    const rules: FilterRules = { ...ALL_OFF, blockedWords: true }
    const result = runContentFilter('anjing bodoh', ['anjing'], rules)
    expect(result.passed).toBe(false)
    expect(result.severity).toBe('high')
    expect(result.reasons).toContain('blocked_word:anjing')
  })

  it('always-on rules cannot be disabled', () => {
    const rules: FilterRules = { ...ALL_OFF, capsSpam: false }
    const allCaps = 'A'.repeat(20)
    const result = runContentFilter(allCaps, [], rules)
    expect(result.passed).toBe(false)
    expect(result.reasons).toContain('caps_spam')
  })

  it('NSFW words are off by default', () => {
    const rules: FilterRules = { ...ALL_OFF, nsfw: false }
    const result = runContentFilter('bokep', [], rules)
    expect(result.passed).toBe(true)
  })

  it('NSFW words flagged when enabled', () => {
    const rules: FilterRules = { ...ALL_OFF, nsfw: true }
    const result = runContentFilter('bokep', [], rules, ['bokep'])
    expect(result.passed).toBe(false)
    expect(result.severity).toBe('medium')
  })

  it('NSFW rule returns empty when no nsfwWords provided', () => {
    const rules: FilterRules = { ...ALL_OFF, nsfw: true }
    const result = runContentFilter('bokep', [], rules) // no nsfwWords
    expect(result.passed).toBe(true) // no words to match against
  })

  it('NSFW rule returns empty when nsfwWords is empty array', () => {
    const rules: FilterRules = { ...ALL_OFF, nsfw: true }
    const result = runContentFilter('bokep', [], rules, [])
    expect(result.passed).toBe(true)
  })

  it('severity stays at highest level (blocked words > jualan)', () => {
    const rules: FilterRules = { ...ALL_OFF, blockedWords: true, jualan: true }
    const result = runContentFilter('WTS anjing', ['anjing'], rules)
    expect(result.passed).toBe(false)
    expect(result.severity).toBe('high')
  })

  it('populates matchedWords for blocked word matches', () => {
    const rules: FilterRules = { ...ALL_OFF, blockedWords: true }
    const result = runContentFilter('anjing', ['anjing'], rules)
    expect(result.matchedWords).toBeDefined()
    expect(result.matchedWords).toContain('anjing')
  })

  it('flags too-short messages (always-on)', () => {
    const rules: FilterRules = { ...ALL_OFF }
    const result = runContentFilter('ab', [], rules)
    expect(result.passed).toBe(false)
    expect(result.reasons).toContain('too_short')
  })

  // ── Additional rule checkers for coverage ──

  it('flags jualan (marketplace tags)', () => {
    const rules: FilterRules = { ...ALL_OFF, jualan: true }
    const result = runContentFilter('WTS jaket murah', [], rules)
    expect(result.passed).toBe(false)
    expect(result.severity).toBe('medium')
  })

  it('flags URLs', () => {
    const rules: FilterRules = { ...ALL_OFF, urls: true }
    const result = runContentFilter('visit https://example.com', [], rules)
    expect(result.passed).toBe(false)
    expect(result.severity).toBe('medium')
  })

  it('flags mentions', () => {
    const rules: FilterRules = { ...ALL_OFF, mentions: true }
    const result = runContentFilter('hey @john', [], rules)
    expect(result.passed).toBe(false)
    expect(result.severity).toBe('medium')
  })

  it('flags caps spam (always-on)', () => {
    const rules: FilterRules = { ...ALL_OFF }
    const result = runContentFilter('A'.repeat(20), [], rules)
    expect(result.passed).toBe(false)
    expect(result.reasons).toContain('caps_spam')
  })

  it('flags repeated characters (always-on)', () => {
    const rules: FilterRules = { ...ALL_OFF, repeatedChars: true }
    const result = runContentFilter('waaaaaa', [], rules)
    expect(result.passed).toBe(false)
  })

  it('flags self-harm keywords with high severity', () => {
    const rules: FilterRules = { ...ALL_OFF, selfHarm: true }
    const result = runContentFilter('mau bunuh diri', [], rules)
    expect(result.passed).toBe(false)
    expect(result.severity).toBe('high')
  })

  it('flags CSAM with high severity', () => {
    const rules: FilterRules = { ...ALL_OFF, csam: true }
    const result = runContentFilter('bokep anak smp', [], rules)
    expect(result.passed).toBe(false)
    expect(result.severity).toBe('high')
  })

  it('flags solicitation with high severity', () => {
    const rules: FilterRules = { ...ALL_OFF, solicitation: true }
    const result = runContentFilter('open bo berbayar', [], rules)
    expect(result.passed).toBe(false)
    expect(result.severity).toBe('high')
  })

  it('flags PII (email)', () => {
    const rules: FilterRules = { ...ALL_OFF, pii: true }
    const result = runContentFilter('email me at user@example.com', [], rules)
    expect(result.passed).toBe(false)
    expect(result.severity).toBe('high')
  })

  it('skips rules when disabled', () => {
    const rules: FilterRules = { ...ALL_OFF, urls: false }
    const result = runContentFilter('visit https://example.com', [], rules)
    expect(result.passed).toBe(true)
  })

  it('returns passed=true with empty matchedWords when no word matches', () => {
    const rules: FilterRules = { ...ALL_OFF, blockedWords: true }
    const result = runContentFilter('clean message', [], rules)
    expect(result.passed).toBe(true)
    expect(result.matchedWords).toBeUndefined()
  })

  it('severity escalation: first match sets severity, high overrides', () => {
    const rules: FilterRules = { ...ALL_OFF, jualan: true, pii: true }
    const result = runContentFilter('WTS email me at user@example.com', [], rules)
    expect(result.passed).toBe(false)
    expect(result.severity).toBe('high') // pii overrides jualan's medium
  })
})

describe('hasAlwaysOnReason', () => {
  it('returns true for caps_spam', () => {
    expect(hasAlwaysOnReason(['caps_spam'])).toBe(true)
  })

  it('returns true for too_short', () => {
    expect(hasAlwaysOnReason(['too_short'])).toBe(true)
  })

  it('returns true for duplicate_24h', () => {
    expect(hasAlwaysOnReason(['duplicate_24h'])).toBe(true)
  })

  it('returns false for non-always-on reasons', () => {
    expect(hasAlwaysOnReason(['blocked_word:anjing'])).toBe(false)
    expect(hasAlwaysOnReason(['contains_url'])).toBe(false)
  })

  it('returns false for empty reasons', () => {
    expect(hasAlwaysOnReason([])).toBe(false)
  })
})

describe('getRejectionMessage', () => {
  it('returns message for caps_spam', () => {
    const msg = getRejectionMessage(['caps_spam'])
    expect(msg).toContain('huruf kapital')
  })

  it('returns message for too_short', () => {
    const msg = getRejectionMessage(['too_short'])
    expect(msg).toContain('pendek')
  })

  it('returns message for duplicate_24h', () => {
    const msg = getRejectionMessage(['duplicate_24h'])
    expect(msg).toContain('24 jam')
  })

  it('returns empty string for non-always-on reasons', () => {
    const msg = getRejectionMessage(['blocked_word:anjing'])
    expect(msg).toBe('')
  })

  it('combines multiple always-on messages', () => {
    const msg = getRejectionMessage(['caps_spam', 'too_short'])
    expect(msg).toContain('huruf kapital')
    expect(msg).toContain('pendek')
  })
})
