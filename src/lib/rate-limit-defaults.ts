// ============================================================
// rate-limit-defaults.ts — Pure constants, safe for client bundles
// ============================================================
// This file has ZERO server-only imports (no db, no encrypt, no crypto).
// It exists so 'use client' hooks can import DEFAULT_RATE_LIMITS
// without pulling PrismaClient + crypto-browserify into the browser.
// ============================================================

/**
 * Safely parse an integer from a setting value, returning the fallback
 * only when the value is missing/null/empty/NaN. Unlike `parseInt(x) || fallback`,
 * this correctly returns 0 when the admin intentionally sets a value to 0.
 */
export function parseIntSafe(raw: string | null, fallback: number): number {
  if (raw === null || raw === '') return fallback
  const parsed = parseInt(raw, 10)
  if (Number.isNaN(parsed)) return fallback
  return parsed
}

export interface RateLimitSettings {
  submissionCooldown: number             // minutes
  submissionDailyCap: number             // count
  autoPostCooldown: number               // seconds
  autoPostWindowCap: number              // max posts per window
  autoPostWindowMinutes: number          // window size in minutes
  globalPostDailyCap: number             // max posts to X from all users per day
  userPostDailyCap: number               // max posts per user per day on X
  userPendingCap: number                 // max pending submissions per user
  globalSubmissionDailyCap: number       // max submissions from ALL users per day
  circuitBreakerThreshold: number        // consecutive failures before pause
  circuitBreakerCooldownMinutes: number  // how long to pause
  circuitBreakerFailureWindowMinutes: number  // max gap between failures (streak breaker)
}

// Default rate limit settings
export const DEFAULT_RATE_LIMITS: RateLimitSettings = {
  submissionCooldown: 2,                // minutes between submissions
  submissionDailyCap: 20,               // max submissions per user per day
  autoPostCooldown: 10,                 // seconds between auto-posts to X
  autoPostWindowCap: 25,                // max auto-posts per time window
  autoPostWindowMinutes: 30,            // the time window in minutes
  globalPostDailyCap: 100,              // max posts to X from all users per day
  userPostDailyCap: 5,                  // max posts per user per day on X
  userPendingCap: 5,                    // max pending submissions per user
  globalSubmissionDailyCap: 200,        // max submissions from ALL users per day
  circuitBreakerThreshold: 3,           // consecutive failures before circuit breaker pauses
  circuitBreakerCooldownMinutes: 30,    // how long circuit breaker pauses auto-post
  circuitBreakerFailureWindowMinutes: 30, // max gap between consecutive failures (streak breaker)
}

export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite'
