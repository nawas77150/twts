import { describe, it, expect } from 'vitest'
import { getEffectiveLimit, resolveEffectiveLimits, hasCustomLimits } from '@/lib/limit-resolver'
import type { RateLimitSettings } from '@/lib/rate-limit-defaults'

describe('getEffectiveLimit', () => {
  it('returns global default when no custom limits', () => {
    expect(getEffectiveLimit('submissionCooldown', null, 30)).toBe(30)
  })

  it('returns custom override when valid', () => {
    const custom = { submissionCooldown: 60 }
    expect(getEffectiveLimit('submissionCooldown', custom, 30)).toBe(60)
  })

  it('falls through to global default for missing key', () => {
    const custom = { submissionDailyCap: 5 }
    expect(getEffectiveLimit('submissionCooldown', custom, 30)).toBe(30)
  })

  it('ignores non-number custom values', () => {
    const custom = { submissionCooldown: 'fast' }
    expect(getEffectiveLimit('submissionCooldown', custom, 30)).toBe(30)
  })

  it('ignores negative custom values', () => {
    const custom = { submissionCooldown: -5 }
    expect(getEffectiveLimit('submissionCooldown', custom, 30)).toBe(30)
  })

  it('accepts zero as valid override', () => {
    const custom = { submissionCooldown: 0 }
    expect(getEffectiveLimit('submissionCooldown', custom, 30)).toBe(0)
  })

  it('ignores array custom limits', () => {
    expect(getEffectiveLimit('submissionCooldown', [1, 2, 3], 30)).toBe(30)
  })
})

describe('resolveEffectiveLimits', () => {
  const globalLimits: RateLimitSettings = {
    submissionCooldown: 2,
    submissionDailyCap: 20,
    autoPostCooldown: 10,
    autoPostWindowCap: 25,
    autoPostWindowMinutes: 30,
    globalPostDailyCap: 100,
    userPostDailyCap: 5,
    userPendingCap: 5,
    globalSubmissionDailyCap: 200,
    circuitBreakerThreshold: 3,
    circuitBreakerCooldownMinutes: 30,
    circuitBreakerFailureWindowMinutes: 10,
  }

  it('returns all global defaults when no custom limits', () => {
    const result = resolveEffectiveLimits(null, globalLimits)
    expect(result.submissionCooldown).toBe(2)
    expect(result.submissionDailyCap).toBe(20)
    expect(result.userPendingCap).toBe(5)
    expect(result.userPostDailyCap).toBe(5)
  })

  it('merges custom overrides with global defaults', () => {
    const custom = { submissionCooldown: 60, userPendingCap: 10 }
    const result = resolveEffectiveLimits(custom, globalLimits)
    expect(result.submissionCooldown).toBe(60)
    expect(result.submissionDailyCap).toBe(20) // global default
    expect(result.userPendingCap).toBe(10)
    expect(result.userPostDailyCap).toBe(5) // global default
  })
})

describe('hasCustomLimits', () => {
  it('returns false for null', () => {
    expect(hasCustomLimits(null)).toBe(false)
  })

  it('returns false for empty object', () => {
    expect(hasCustomLimits({})).toBe(false)
  })

  it('returns false for object with no valid keys', () => {
    expect(hasCustomLimits({ foo: 'bar' })).toBe(false)
  })

  it('returns true for object with valid override', () => {
    expect(hasCustomLimits({ submissionCooldown: 60 })).toBe(true)
  })

  it('returns false for object with invalid override (negative)', () => {
    expect(hasCustomLimits({ submissionCooldown: -5 })).toBe(false)
  })

  it('returns false for array', () => {
    expect(hasCustomLimits([1, 2, 3])).toBe(false)
  })
})
