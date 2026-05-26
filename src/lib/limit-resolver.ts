import type { RateLimitSettings, PerUserLimits } from '@/types'
import { PER_USER_LIMIT_KEYS } from '@/types'

/**
 * Resolve a single per-user limit using custom override or global default.
 *
 * Priority: customLimits (highest) → global default
 * - If customLimits is null/undefined → use global default
 * - If customLimits has the key with a valid non-negative number → use it
 * - If customLimits is missing the key → fall through to global default
 * - Unknown keys are silently ignored
 * - Invalid values (non-number, negative) are silently ignored
 */
export function getEffectiveLimit(
  key: keyof PerUserLimits,
  customLimits: unknown,
  globalValue: number
): number {
  if (customLimits && typeof customLimits === 'object' && !Array.isArray(customLimits)) {
    // eslint-disable-next-line security/detect-object-injection -- key is keyof PerUserLimits (compile-time constrained)
    const override = (customLimits as Record<string, unknown>)[key]
    if (typeof override === 'number' && override >= 0) return override
  }
  return globalValue
}

/**
 * Resolve all per-user limits at once.
 * Returns an object with all 4 per-user limits resolved to their effective values.
 */
export function resolveEffectiveLimits(
  customLimits: unknown,
  globalRateLimits: RateLimitSettings
): PerUserLimits {
  const limits: PerUserLimits = {
    submissionCooldown: getEffectiveLimit('submissionCooldown', customLimits, globalRateLimits.submissionCooldown),
    submissionDailyCap: getEffectiveLimit('submissionDailyCap', customLimits, globalRateLimits.submissionDailyCap),
    userPendingCap: getEffectiveLimit('userPendingCap', customLimits, globalRateLimits.userPendingCap),
    userPostDailyCap: getEffectiveLimit('userPostDailyCap', customLimits, globalRateLimits.userPostDailyCap),
  }
  return limits
}

/**
 * Check if a customLimits object has any valid overrides.
 * Used to determine the `isCustom` flag for UI display.
 * Returns false for null, undefined, empty objects, or objects with no valid keys.
 */
export function hasCustomLimits(customLimits: unknown): boolean {
  if (!customLimits || typeof customLimits !== 'object' || Array.isArray(customLimits)) {
    return false
  }
  const obj = customLimits as Record<string, unknown>
  return PER_USER_LIMIT_KEYS.some(key => {
    // eslint-disable-next-line security/detect-object-injection -- key from PER_USER_LIMIT_KEYS constant
    const val = obj[key]
    return typeof val === 'number' && val >= 0
  })
}
