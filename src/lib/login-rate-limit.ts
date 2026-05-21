// ============================================================
// login-rate-limit.ts — IP-based rate limiter for admin login
// ============================================================
// Prevents brute-force attacks by limiting login attempts per IP.
//
// Uses in-memory storage (Map + TTL). On Vercel serverless, state
// resets on cold starts — but this is acceptable because:
//   1. Admin login is very low traffic (one admin)
//   2. Even per-instance limits make rapid-fire brute-force impractical
//   3. Each instance allows 5 attempts / 15 min — an attacker would
//      need to hit hundreds of distinct instances to brute-force
//
// For multi-instance coordination, swap this with a DB-backed store
// (e.g. the LoginAttempt model in Prisma).
// ============================================================

interface AttemptRecord {
  count: number
  firstAttemptAt: number // epoch ms
}

/** Max failed login attempts per window */
const MAX_ATTEMPTS = 5

/** Time window in ms (15 minutes) */
const WINDOW_MS = 15 * 60 * 1000

/** Lockout duration in ms (30 minutes — longer than the window) */
const LOCKOUT_MS = 30 * 60 * 1000

// In-memory store: IP → AttemptRecord
const store = new Map<string, AttemptRecord>()

// Periodic cleanup: prune expired entries every 10 minutes
let lastCleanup = Date.now()
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000

function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  for (const [ip, record] of store) {
    if (now - record.firstAttemptAt > LOCKOUT_MS) {
      store.delete(ip)
    }
  }
}

/**
 * Extract client IP from request headers.
 * Vercel provides x-forwarded-for and x-real-ip.
 */
export function getClientIp(req: Request): string {
  // x-forwarded-for may contain multiple IPs — first is the client
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  const realIp = req.headers.get('x-real-ip')
  if (realIp) {
    return realIp.trim()
  }
  // Fallback: unknown (won't rate-limit effectively, but won't block either)
  return 'unknown'
}

/**
 * Check if an IP is currently rate-limited.
 * Returns { allowed: true } or { allowed: false, retryAfterSec: number }.
 *
 * Call this BEFORE checking the password.
 */
export function checkLoginRateLimit(ip: string): { allowed: true } | { allowed: false; retryAfterSec: number } {
  cleanup()

  const record = store.get(ip)

  if (!record) {
    return { allowed: true }
  }

  const now = Date.now()
  const elapsed = now - record.firstAttemptAt

  // If the lockout period has passed, reset
  if (elapsed > LOCKOUT_MS) {
    store.delete(ip)
    return { allowed: true }
  }

  // If the window has passed but lockout hasn't, check if they hit the limit
  if (elapsed > WINDOW_MS) {
    if (record.count >= MAX_ATTEMPTS) {
      // Still locked out — window expired but lockout period hasn't
      const retryAfterMs = record.firstAttemptAt + LOCKOUT_MS - now
      return { allowed: false, retryAfterSec: Math.ceil(retryAfterMs / 1000) }
    }
    // Under the limit and window expired — reset for a new window
    store.delete(ip)
    return { allowed: true }
  }

  // Within the window — check count
  if (record.count >= MAX_ATTEMPTS) {
    const retryAfterMs = record.firstAttemptAt + LOCKOUT_MS - now
    return { allowed: false, retryAfterSec: Math.ceil(retryAfterMs / 1000) }
  }

  return { allowed: true }
}

/**
 * Record a failed login attempt for an IP.
 * Call this AFTER a failed password check.
 */
export function recordFailedAttempt(ip: string): void {
  cleanup()

  const existing = store.get(ip)
  const now = Date.now()

  if (existing && (now - existing.firstAttemptAt) < WINDOW_MS) {
    // Within the 15-min window — increment
    existing.count++
  } else if (existing && existing.count >= MAX_ATTEMPTS && (now - existing.firstAttemptAt) < LOCKOUT_MS) {
    // Window expired but still in lockout period — don't reset to 1,
    // carry forward the count and restart the window so future checks
    // measure elapsed from this point.
    existing.count++
    existing.firstAttemptAt = now
  } else {
    // No record, or lockout expired — fresh window
    store.set(ip, { count: 1, firstAttemptAt: now })
  }
}

/**
 * Clear rate limit for an IP (on successful login).
 * Optional — prevents a previous failed attempt from another person
 * on the same IP from blocking the real admin.
 */
export function clearFailedAttempts(ip: string): void {
  store.delete(ip)
}
