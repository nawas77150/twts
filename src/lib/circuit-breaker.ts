import { db } from '@/lib/db'
import { debug } from '@/lib/debug'

// Circuit breaker protects against cascading X API failures.
// After N consecutive post failures, auto-post is paused for M minutes.
// Manual admin posts are NOT blocked — admin can decide to retry.
// Circuit breaker state is stored in the Setting table so it persists
// across Vercel serverless invocations.
//
// Bug #9 fix: recordPostFailure now uses an atomic SQL increment
// (CAST(CAST(value AS BIGINT) + 1 AS TEXT)) instead of read-modify-write,
// eliminating the race condition where concurrent failures could lose counts.

const FAIL_COUNT_KEY = 'circuit_breaker_fail_count'
const PAUSED_UNTIL_KEY = 'circuit_breaker_paused_until'

interface CircuitBreakerConfig {
  threshold: number       // consecutive failures before pausing (default: 3)
  cooldownMinutes: number // how long to pause (default: 30)
}

/**
 * Get circuit breaker config from rate limit settings (passed in to avoid
 * re-fetching). Falls back to defaults if not available.
 */
function getConfig(rateLimits?: { circuitBreakerThreshold?: number; circuitBreakerCooldownMinutes?: number }): CircuitBreakerConfig {
  return {
    threshold: rateLimits?.circuitBreakerThreshold ?? 3,
    cooldownMinutes: rateLimits?.circuitBreakerCooldownMinutes ?? 30,
  }
}

/**
 * Read a Setting row value as string. Returns null if not found.
 */
async function getSettingValue(key: string): Promise<string | null> {
  const setting = await db.setting.findUnique({ where: { key } })
  return setting?.value ?? null
}

/**
 * Upsert a Setting row value.
 */
async function setSettingValue(key: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
}

/**
 * Check if the circuit breaker is currently paused.
 * If the pause has expired, auto-resets the state.
 */
export async function isCircuitBreakerPaused(rateLimits?: { circuitBreakerThreshold?: number; circuitBreakerCooldownMinutes?: number }): Promise<boolean> {
  const pausedUntilStr = await getSettingValue(PAUSED_UNTIL_KEY)
  if (!pausedUntilStr || pausedUntilStr === '0') return false

  const pausedUntil = parseInt(pausedUntilStr, 10)
  if (isNaN(pausedUntil)) return false

  const now = Date.now()
  if (now < pausedUntil) {
    const remaining = Math.ceil((pausedUntil - now) / 60000)
    debug('[circuit-breaker] Paused, resuming in', remaining, 'minutes')
    return true
  }

  // Pause expired — auto-reset
  debug('[circuit-breaker] Pause expired, auto-resetting')
  await setSettingValue(PAUSED_UNTIL_KEY, '0')
  await setSettingValue(FAIL_COUNT_KEY, '0')
  return false
}

/**
 * Get circuit breaker status for admin UI display.
 */
export async function getCircuitBreakerStatus(rateLimits?: { circuitBreakerThreshold?: number; circuitBreakerCooldownMinutes?: number }): Promise<{
  paused: boolean
  failCount: number
  pausedUntil: number | null
  remainingMinutes: number
  threshold: number
}> {
  const config = getConfig(rateLimits)
  const failCountStr = await getSettingValue(FAIL_COUNT_KEY)
  const failCount = parseInt(failCountStr || '0', 10) || 0
  const pausedUntilStr = await getSettingValue(PAUSED_UNTIL_KEY)
  const pausedUntil = pausedUntilStr && pausedUntilStr !== '0' ? parseInt(pausedUntilStr, 10) : null

  let remainingMinutes = 0
  if (pausedUntil && Date.now() < pausedUntil) {
    remainingMinutes = Math.ceil((pausedUntil - Date.now()) / 60000)
  }

  return {
    paused: pausedUntil ? Date.now() < pausedUntil : false,
    failCount,
    pausedUntil,
    remainingMinutes,
    threshold: config.threshold,
  }
}

/**
 * Record a successful post — resets the fail count atomically.
 * Called after ANY successful post to X (auto-post, manual, test).
 */
export async function recordPostSuccess(): Promise<void> {
  // Atomically set fail count to 0 using UPSERT
  await db.$executeRaw`
    INSERT INTO "Setting" (id, key, value, "updatedAt")
    VALUES (${FAIL_COUNT_KEY}, ${FAIL_COUNT_KEY}, '0', NOW())
    ON CONFLICT (key) DO UPDATE
    SET "value" = '0', "updatedAt" = NOW()
  `
  debug('[circuit-breaker] Post succeeded, resetting fail count to 0')

  // Invalidate API credits cache so next dashboard refresh shows accurate credits
  try {
    const { invalidateCreditsCache } = await import('@/lib/twitter-api-fallback')
    invalidateCreditsCache()
  } catch { /* best effort */ }
}

/**
 * Record a failed post — atomically increments fail count, may trigger pause.
 * Called after ANY failed post to X (auto-post, manual, test).
 *
 * Uses atomic SQL increment to prevent race conditions when multiple
 * failures happen concurrently.
 */
export async function recordPostFailure(rateLimits?: { circuitBreakerThreshold?: number; circuitBreakerCooldownMinutes?: number }): Promise<void> {
  const config = getConfig(rateLimits)

  // Atomically increment the fail count — no read-modify-write race
  await db.$executeRaw`
    INSERT INTO "Setting" (id, key, value, "updatedAt")
    VALUES (${FAIL_COUNT_KEY}, ${FAIL_COUNT_KEY}, '1', NOW())
    ON CONFLICT (key) DO UPDATE
    SET "value" = (("Setting"."value")::INTEGER + 1)::TEXT, "updatedAt" = NOW()
  `

  // Read the new count to check if threshold is reached
  const newCountStr = await getSettingValue(FAIL_COUNT_KEY)
  const newCount = parseInt(newCountStr || '1', 10) || 1

  debug('[circuit-breaker] Post failed, fail count now:', newCount, '(threshold:', config.threshold, ')')

  if (newCount >= config.threshold) {
    const pausedUntil = Date.now() + config.cooldownMinutes * 60 * 1000
    debug('[circuit-breaker] Threshold reached! Pausing auto-post until', new Date(pausedUntil).toISOString())
    await setSettingValue(PAUSED_UNTIL_KEY, String(pausedUntil))
  }
}

/**
 * Manually reset the circuit breaker (admin action).
 */
export async function resetCircuitBreaker(): Promise<void> {
  debug('[circuit-breaker] Manual reset')
  await setSettingValue(FAIL_COUNT_KEY, '0')
  await setSettingValue(PAUSED_UNTIL_KEY, '0')
}
