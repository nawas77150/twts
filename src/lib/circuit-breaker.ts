import { db } from '@/lib/db'
import { upsertSetting } from '@/lib/db-helpers'
import { debug } from '@/lib/debug'
import type { ErrorClass } from '@/lib/twitter-post-error'

// Circuit breaker protects against cascading X API failures.
// After N consecutive post failures within a configurable time window,
// auto-post is paused for M minutes.
//
// Manual admin posts are NOT blocked — admin can decide to retry.
// Circuit breaker state is stored in the Setting table so it persists
// across Vercel serverless invocations.
//
// Failure window: Only failures that happen within N minutes of the
// PREVIOUS failure count as "consecutive." If the gap between two
// failures exceeds the window, the counter resets. This prevents
// stale failures from days ago from triggering a false-positive pause.

// Database key names for the Setting table (not passwords — Opengrep false positive
// on individual const string assignments; consolidating into an object avoids the flag).
const CB_KEYS = {
  failCount: 'circuit_breaker_fail_count',
  pausedUntil: 'circuit_breaker_paused_until',
  lastFailureAt: 'circuit_breaker_last_failure_at',
} as const

interface CircuitBreakerConfig {
  threshold: number              // consecutive failures before pausing (default: 3)
  cooldownMinutes: number        // how long to pause (default: 30)
  failureWindowMinutes: number   // max gap between consecutive failures (default: 30)
}

/**
 * Get circuit breaker config from rate limit settings (passed in to avoid
 * re-fetching). Falls back to defaults if not available.
 */
function getConfig(rateLimits?: { circuitBreakerThreshold?: number; circuitBreakerCooldownMinutes?: number; circuitBreakerFailureWindowMinutes?: number }): CircuitBreakerConfig {
  return {
    threshold: rateLimits?.circuitBreakerThreshold ?? 3,
    cooldownMinutes: rateLimits?.circuitBreakerCooldownMinutes ?? 30,
    failureWindowMinutes: rateLimits?.circuitBreakerFailureWindowMinutes ?? 30,
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
  await upsertSetting(key, value)
}

/**
 * Check if the circuit breaker is currently paused.
 * If the pause has expired, auto-resets the state with conditional
 * multi-statement SQL to prevent race conditions with concurrent recordPostFailure().
 */
export async function isCircuitBreakerPaused(_rateLimits?: { circuitBreakerThreshold?: number; circuitBreakerCooldownMinutes?: number; circuitBreakerFailureWindowMinutes?: number }): Promise<boolean> {
  const pausedUntilStr = await getSettingValue(CB_KEYS.pausedUntil)
  if (!pausedUntilStr || pausedUntilStr === '0') return false

  const pausedUntil = parseInt(pausedUntilStr, 10)
  if (isNaN(pausedUntil)) return false

  const now = Date.now()
  if (now < pausedUntil) {
    const remaining = Math.ceil((pausedUntil - now) / 60000)
    debug('circuit-breaker', 'Paused, resuming in', remaining, 'minutes')
    return true
  }

  // Pause expired — conditional multi-statement reset:
  // Only clears paused_until if the stored value still matches what we read
  // (prevents erasing a newer pause), and resets fail_count only if
  // paused_until was successfully cleared (no concurrent failure set a new pause).
  // Also conditionally clears last_failure_at so the next failure starts a fresh streak.
  // Statement 3 is conditional on fail_count='0' to prevent erasing a concurrent
  // recordPostFailure's timestamp (matches recordPostSuccess pattern).
  debug('circuit-breaker', 'Pause expired, auto-resetting')
  await db.$executeRaw`
    UPDATE "Setting" SET "value" = '0', "updatedAt" = NOW()
    WHERE "key" = ${CB_KEYS.failCount} AND (
      SELECT "value" FROM "Setting"
      WHERE "key" = ${CB_KEYS.pausedUntil} AND "value" = ${pausedUntilStr}
    ) = ${pausedUntilStr}
  `
  await db.$executeRaw`
    UPDATE "Setting" SET "value" = '0', "updatedAt" = NOW()
    WHERE "key" = ${CB_KEYS.pausedUntil} AND "value" = ${pausedUntilStr}
  `
  await db.$executeRaw`
    UPDATE "Setting" SET "value" = '0', "updatedAt" = NOW()
    WHERE "key" = ${CB_KEYS.lastFailureAt}
      AND (SELECT "value" FROM "Setting" WHERE "key" = ${CB_KEYS.failCount}) = '0'
  `
  return false
}

/**
 * Get circuit breaker status for admin UI display.
 */
export async function getCircuitBreakerStatus(rateLimits?: { circuitBreakerThreshold?: number; circuitBreakerCooldownMinutes?: number; circuitBreakerFailureWindowMinutes?: number }): Promise<{
  paused: boolean
  failCount: number
  pausedUntil: number | null
  remainingMinutes: number
  threshold: number
}> {
  const config = getConfig(rateLimits)

  // Single findMany instead of 2 separate findUnique calls
  const settings = await db.setting.findMany({
    where: { key: { in: [CB_KEYS.failCount, CB_KEYS.pausedUntil] } },
  })
  const settingsMap = new Map(settings.map(s => [s.key, s.value]))

  const failCount = parseInt(settingsMap.get(CB_KEYS.failCount) || '0', 10) || 0
  const pausedUntilStr = settingsMap.get(CB_KEYS.pausedUntil) ?? null
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
 * Record a successful post — resets the fail count and clears any pause.
 * Called after ANY successful post to X (auto-post, manual, test).
 *
 * Uses a conditional clear to avoid erasing a new legitimate pause set
 * by a concurrent recordPostFailure() between our two writes.
 *
 * IMPORTANT: We also clear last_failure_at so that the next failure
 * starts a fresh streak instead of inheriting a stale timestamp.
 */
export async function recordPostSuccess(): Promise<void> {
  // Atomically set fail count to 0 using UPSERT
  await db.$executeRaw`
    INSERT INTO "Setting" (id, key, value, "updatedAt")
    VALUES (${CB_KEYS.failCount}, ${CB_KEYS.failCount}, '0', NOW())
    ON CONFLICT (key) DO UPDATE
    SET "value" = '0', "updatedAt" = NOW()
  `

  // Only clear the pause if fail_count is still 0 (no concurrent failure intervened)
  await db.$executeRaw`
    UPDATE "Setting"
    SET "value" = '0', "updatedAt" = NOW()
    WHERE "key" = ${CB_KEYS.pausedUntil}
      AND (SELECT "value" FROM "Setting" WHERE "key" = ${CB_KEYS.failCount}) = '0'
  `

  // Clear last_failure_at so next failure starts fresh (no stale timestamp)
  await db.$executeRaw`
    UPDATE "Setting"
    SET "value" = '0', "updatedAt" = NOW()
    WHERE "key" = ${CB_KEYS.lastFailureAt}
      AND (SELECT "value" FROM "Setting" WHERE "key" = ${CB_KEYS.failCount}) = '0'
  `

  debug('circuit-breaker', 'Post succeeded, resetting fail count and clearing pause')

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
 *
 * Failure window: If the gap between THIS failure and the PREVIOUS failure
 * exceeds the configured window (default 30 min), the counter resets to 1
 * before incrementing. This prevents stale failures from days ago from
 * counting toward the threshold.
 *
 * Bug fix: Uses >= instead of === to handle concurrent failures that may
 * skip past the exact threshold. Only sets pausedUntil if not already paused
 * (conditional write), which prevents resetting the cooldown timer when
 * failures occur while the circuit is already paused.
 */
export async function recordPostFailure(
  errorClass: ErrorClass,
  rateLimits?: { circuitBreakerThreshold?: number; circuitBreakerCooldownMinutes?: number; circuitBreakerFailureWindowMinutes?: number }
): Promise<void> {
  // Don't count these toward circuit breaker:
  // - auth_failure / rate_limit / stealth_ban: need admin intervention, not cooldown
  // - duplicate_posted: the tweet IS on X (phantom success), not a real failure
  if (errorClass === 'auth_failure' || errorClass === 'rate_limit' || errorClass === 'stealth_ban' || errorClass === 'duplicate_posted') {
    debug('circuit-breaker', 'Skipping failure record —', errorClass, '(requires admin intervention)')
    return
  }

  const config = getConfig(rateLimits)
  const now = Date.now()
  const windowMs = config.failureWindowMinutes * 60 * 1000

  // Check if the streak is broken (gap between this failure and the previous exceeds window)
  const lastFailureStr = await getSettingValue(CB_KEYS.lastFailureAt)
  const lastFailure = lastFailureStr ? parseInt(lastFailureStr, 10) : 0

  if (lastFailure > 0 && (now - lastFailure) > windowMs) {
    // Streak broken — reset counter before this new failure
    debug('circuit-breaker', 'Stale streak — gap', Math.round((now - lastFailure) / 60000), 'min exceeds window', config.failureWindowMinutes, 'min. Resetting count.')
    await db.$executeRaw`
      INSERT INTO "Setting" (id, key, value, "updatedAt")
      VALUES (${CB_KEYS.failCount}, ${CB_KEYS.failCount}, '0', NOW())
      ON CONFLICT (key) DO UPDATE
      SET "value" = '0', "updatedAt" = NOW()
    `
  }

  // Upsert last_failure_at BEFORE incrementing, so concurrent failures
  // can see the fresh timestamp and won't also reset.
  // Conditional write: on conflict (row exists), only update if the stored
  // value is older than now — preventing a concurrent failure from
  // overwriting a newer timestamp. On first failure (no row), inserts.
  await db.$executeRaw`
    INSERT INTO "Setting" (id, key, value, "updatedAt")
    VALUES (${CB_KEYS.lastFailureAt}, ${CB_KEYS.lastFailureAt}, ${String(now)}, NOW())
    ON CONFLICT (key) DO UPDATE
    SET "value" = ${String(now)}, "updatedAt" = NOW()
    WHERE COALESCE(("Setting"."value")::BIGINT, 0) < ${now}
  `

  // Atomically increment the fail count — no read-modify-write race
  await db.$executeRaw`
    INSERT INTO "Setting" (id, key, value, "updatedAt")
    VALUES (${CB_KEYS.failCount}, ${CB_KEYS.failCount}, '1', NOW())
    ON CONFLICT (key) DO UPDATE
    SET "value" = (("Setting"."value")::INTEGER + 1)::TEXT, "updatedAt" = NOW()
  `

  // Read the new count to check if threshold is reached
  const newCountStr = await getSettingValue(CB_KEYS.failCount)
  const newCount = parseInt(newCountStr ?? '0', 10) || 0

  debug('circuit-breaker', 'Post failed, fail count now:', newCount, '(threshold:', config.threshold, ', window:', config.failureWindowMinutes, 'min)')

  // Set pause when threshold is reached or exceeded — handles concurrent failures
  // that may skip past the exact threshold count. Conditional write prevents
  // resetting the cooldown timer when failures occur while already paused.
  if (newCount >= config.threshold) {
    const pausedUntil = now + config.cooldownMinutes * 60 * 1000
    debug('circuit-breaker', 'Threshold reached! Pausing auto-post until', new Date(pausedUntil).toISOString())
    // Atomic conditional set: INSERT if row missing, UPDATE only if not already
    // paused (value='0' or expired). Skips update when already paused, preventing
    // concurrent failures from resetting the cooldown timer.
    await db.$executeRaw`
      INSERT INTO "Setting" (id, key, value, "updatedAt")
      VALUES (${CB_KEYS.pausedUntil}, ${CB_KEYS.pausedUntil}, ${String(pausedUntil)}, NOW())
      ON CONFLICT (key) DO UPDATE
      SET "value" = ${String(pausedUntil)}, "updatedAt" = NOW()
      WHERE "Setting"."value" = '0' OR ("Setting"."value")::BIGINT < ${now}
    `
  }
}

/**
 * Manually reset the circuit breaker (admin action).
 */
export async function resetCircuitBreaker(): Promise<void> {
  debug('circuit-breaker', 'Manual reset')
  await setSettingValue(CB_KEYS.failCount, '0')
  await setSettingValue(CB_KEYS.pausedUntil, '0')
  await setSettingValue(CB_KEYS.lastFailureAt, '0')
}
