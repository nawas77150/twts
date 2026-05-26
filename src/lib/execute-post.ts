// ============================================================
// execute-post.ts — Shared posting lifecycle
//
// Handles the lock → CAS → post → CAS → record → release
// lifecycle shared by all 4 posting route callers:
//   1. POST /api/submissions          (auto-post on submit)
//   2. PATCH /api/submissions/[id]     (admin approve)
//   3. POST /api/submissions/[id]/post (admin manual retry)
//   4. GET  /api/autopost              (cron auto-post)
//
// Lock safety improvements over the original 4 callers:
// - Lock released and null-tracked on EVERY exit path
//   (fixes CAS-abort double-release risk in original Files 1-3)
// - `if (!lockReleased)` guard in outer catch instead of
//   `lockValue!` non-null assertion (adopted from autopost)
// - Warning path checked for ALL callers (was missing in autopost)
// ============================================================

import { db } from '@/lib/db'
import { postingService } from '@/lib/posting-service'
import { acquirePostingLock, releasePostingLock } from '@/lib/posting-lock'
import { recordPostSuccess, recordPostFailure } from '@/lib/circuit-breaker'
import { getStartOfTodayWIB } from '@/lib/constants'
import { debug, debugError } from '@/lib/debug'
import type { RateLimitSettings } from '@/lib/rate-limit-defaults'
import { NextResponse } from 'next/server'

// ── Shared DB queries ──────────────────────────────────
// Used by both execute-post.ts (under-lock checks) and
// submissions/route.ts (pre-lock fast-path checks).

/** Count posted submissions today (WIB). Uses updatedAt to match actual post time. */
export async function countGlobalPostsToday(): Promise<number> {
  const startOfToday = getStartOfTodayWIB()
  return db.submission.count({
    where: { status: 'posted', updatedAt: { gte: startOfToday } },
  })
}

/** Get the updatedAt timestamp of the most recently posted submission. */
export async function getLastPostedTime(): Promise<Date | null> {
  const last = await db.submission.findFirst({
    where: { status: 'posted' },
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true },
  })
  return last?.updatedAt ?? null
}

// ── Phantom success recovery ───────────────────────────
// When X returns error 187 ("Status is a duplicate"), the tweet was
// already created by a previous Vercel invocation that crashed/502'd
// before saving the tweetId. This helper detects that case and
// recovers the submission to 'posted' status instead of 'post_failed'.

/**
 * Check if a duplicate_posted error is actually a phantom success.
 * Error 187 means the tweet IS on X — we just don't have the tweetId.
 *
 * Logic:
 * 1. Read the submission's normalizedMessage from DB (already computed at submit time)
 * 2. Look for another 'posted' submission with the same normalizedMessage
 *    - Found → true duplicate (another submission already posted this) → not phantom
 *    - Not found → phantom success (this submission's tweet IS on X) → recover
 *
 * @returns true if this was a phantom success (submission recovered to 'posted')
 */
async function handleDuplicatePosted(
  submissionId: string,
): Promise<boolean> {
  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    select: { message: true },
  })
  if (!submission?.message) return false

  // Check if another submission already posted the exact same tweet text.
  // Uses `message` (exact text) not `normalizedMessage` because error 187
  // only fires when X sees the identical tweet — aggressive normalization
  // (strip emoji, punctuation, lowercase) can match unrelated submissions.
  const alreadyPosted = await db.submission.findFirst({
    where: {
      message: submission.message,
      status: 'posted',
      id: { not: submissionId },
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  })

  if (alreadyPosted) {
    // True duplicate — different submission already posted same content
    debug('execute-post', 'Error 187 is a true duplicate — submission', alreadyPosted.id, 'already posted this content')
    return false
  }

  // Phantom success — the tweet IS on X but we lost the tweetId
  debug('execute-post', 'Phantom success detected — recovering submission', submissionId, 'to posted')
  const result = await db.submission.updateMany({
    where: { id: submissionId, status: 'posting' },
    data: {
      status: 'posted',
      tweetId: null,
      postMethod: 'direct',
      postError: '[Phantom success] Tweet posted on X but tweetId was lost due to server crash. Check X account for the tweet.',
    },
  })

  if (result.count > 0) {
    // Successfully recovered — reset circuit breaker (this was actually a success)
    await recordPostSuccess()
    return true
  }

  // CAS failed — status changed between our check and update (race condition)
  debug('execute-post', 'Phantom success CAS failed — status changed before recovery')
  return false
}

// ── Input ──────────────────────────────────────────────

export interface ExecutePostInput {
  /** Submission ID to update */
  submissionId: string

  /** Decoded message text, ready for X API */
  message: string

  /**
   * Rate limits — passed in to eliminate redundant getFilterSettings() calls.
   * Files 2 & 3 previously called getFilterSettings() 2-3x per request
   * (once for globalPostDailyCap, again in each failure path for
   * recordPostFailure). Now called once before executePostAndRecord.
   */
  rateLimits: RateLimitSettings

  /**
   * CAS statuses for the mark→posting transition.
   * Always uses Prisma `{ in: casStatuses }` form — handles single-element
   * arrays correctly (equivalent to scalar equality).
   *
   * File 1: ['pending']
   * File 2: ['pending', 'post_failed', 'censored']
   * File 3: ['pending', 'post_failed', 'censored']
   * File 4: ['pending', 'post_failed']
   */
  casStatuses: ('pending' | 'post_failed' | 'censored')[]

  /**
   * Optional extra rate checks to run under the lock.
   * Called after lock acquisition + built-in globalPostDailyCap check,
   * before CAS mark→posting.
   * Return a non-null ExecutePostResult to release lock and exit early.
   * Return null to continue to CAS mark→posting.
   *
   * Used by File 1 (cooldown + window cap) and File 4 (cooldown + window cap).
   * Files 2 & 3 pass nothing (only globalPostDailyCap is built-in).
   */
  extraUnderLockChecks?: () => Promise<ExecutePostResult | null>
}

// ── Output ─────────────────────────────────────────────

export interface ExecutePostResult {
  // Core result from postTweetViaCookie
  success: boolean
  tweetId?: string
  error?: string
  method?: string
  retriesUsed?: number

  // Lifecycle flags — callers use these to determine HTTP status + response shape
  lockBusy?: boolean             // couldn't acquire lock
  casAborted?: boolean           // CAS mark→posting failed (status changed by another process)
  warning?: string               // CAS posted succeeded but result.count === 0 (admin changed status mid-flight)

  // Under-lock early-exit reasons (from extraUnderLockChecks or built-in globalPostDailyCap)
  underLockAbortReason?: string  // e.g. 'cooldown_active', 'window_cap_reached', 'global_post_daily_cap_reached'
}

/**
 * Handles the lock → CAS → post → CAS → record → release lifecycle.
 * Returns a structured result — each caller decides HTTP status and response shape.
 *
 * Bug fixes vs. original 4 callers:
 * - Lock released on EVERY exit path via releaseAndReturn helper
 *   (original Files 1-3 had CAS-abort paths that released but didn't null lockValue)
 * - Warning path (result.count === 0 on success CAS) checked for all callers
 *   (was missing in autopost/route.ts — tweet posted but status not updated)
 * - recordPostFailure receives rateLimits by parameter instead of calling
 *   getFilterSettings() redundantly (original Files 2-3 called it 2-3x per request)
 */
export async function executePostAndRecord(
  input: ExecutePostInput,
): Promise<ExecutePostResult> {
  const { submissionId, message, rateLimits, casStatuses } = input

  // ── 1. Acquire distributed posting lock ─────────────
  const lockValue = await acquirePostingLock()
  if (!lockValue) {
    return { success: false, lockBusy: true }
  }

  let lockReleased = false

  /** Release lock and return result. Every exit path must go through here. */
  async function releaseAndReturn(
    result: ExecutePostResult,
  ): Promise<ExecutePostResult> {
    if (!lockReleased && lockValue) {
      await releasePostingLock(lockValue)
      lockReleased = true
    }
    return result
  }

  try {
    // ── 2. Extra under-lock checks (caller-specific) ──
    if (input.extraUnderLockChecks) {
      const earlyExit = await input.extraUnderLockChecks()
      if (earlyExit) {
        return await releaseAndReturn(earlyExit)
      }
    }

    // ── 3. Built-in globalPostDailyCap check ───────────
    if (rateLimits.globalPostDailyCap > 0) {
      const globalPostCount = await countGlobalPostsToday()
      if (globalPostCount >= rateLimits.globalPostDailyCap) {
        debug('execute-post', 'Global post daily cap reached:', globalPostCount)
        return await releaseAndReturn({
          success: false,
          underLockAbortReason: 'global_post_daily_cap_reached',
          error: `${globalPostCount}/${rateLimits.globalPostDailyCap}`,
        })
      }
    }

    // ── 4. CAS mark→posting ────────────────────────────
    // Always uses { in: casStatuses } — Prisma handles single-element arrays correctly
    const marked = await db.submission.updateMany({
      where: { id: submissionId, status: { in: casStatuses } },
      data: { status: 'posting' },
    })
    if (marked.count === 0) {
      debug('execute-post', 'CAS abort — status changed before posting')
      return await releaseAndReturn({ success: false, casAborted: true })
    }

    // ── 5. Post to X ───────────────────────────────────
    try {
      const tweetResult = await postingService.post(message)

      if (tweetResult.success) {
        debug('execute-post', 'Post succeeded! tweetId:', tweetResult.tweetId, 'method:', tweetResult.method)

        // CAS posting→posted
        const result = await db.submission.updateMany({
          where: { id: submissionId, status: 'posting' },
          data: {
            status: 'posted',
            tweetId: tweetResult.tweetId || null,
            postMethod: tweetResult.method ?? null,
            postError: null,
          },
        })

        // Reset circuit breaker on success
        await recordPostSuccess()

        // Warning: tweet posted but status was changed by admin mid-flight
        if (result.count === 0) {
          debug('execute-post', 'Post succeeded but status was changed by another process')
          return await releaseAndReturn({
            success: true,
            ...(tweetResult.tweetId != null && { tweetId: tweetResult.tweetId }),
            method: tweetResult.method as string,
            ...(tweetResult.retriesUsed != null && { retriesUsed: tweetResult.retriesUsed }),
            warning: 'Tweet posted, but submission status was changed by another process.',
          })
        }

        return await releaseAndReturn({
          success: true,
          ...(tweetResult.tweetId != null && { tweetId: tweetResult.tweetId }),
          method: tweetResult.method as string,
          ...(tweetResult.retriesUsed != null && { retriesUsed: tweetResult.retriesUsed }),
        })
      } else {
        // Post failed — check for phantom success before marking as failed
        if (tweetResult.failureKind === 'duplicate') {
          const recovered = await handleDuplicatePosted(submissionId)
          if (recovered) {
            return await releaseAndReturn({
              success: true,
              method: tweetResult.method as string,
              ...(tweetResult.retriesUsed != null && { retriesUsed: tweetResult.retriesUsed }),
            })
          }
        }

        // Normal failure — CAS posting→post_failed
        const errorMsg = tweetResult.error || 'Unknown error'
        debug('execute-post', 'Post failed:', errorMsg)
        await db.submission.updateMany({
          where: { id: submissionId, status: 'posting' },
          data: { status: 'post_failed', postError: errorMsg },
        })

        // Record failure for circuit breaker
        try { await recordPostFailure(tweetResult.failureKind ?? 'transient', rateLimits) } catch { /* best effort */ }

        return await releaseAndReturn({
          success: false,
          error: errorMsg,
          method: tweetResult.method as string,
          ...(tweetResult.retriesUsed != null && { retriesUsed: tweetResult.retriesUsed }),
        })
      }
    } catch (postError) {
      // Exception — CAS posting→post_failed
      const errorMsg = postError instanceof Error ? postError.message : String(postError)
      debug('execute-post', 'Post exception:', errorMsg)
      await db.submission.updateMany({
        where: { id: submissionId, status: 'posting' },
        data: { status: 'post_failed', postError: errorMsg },
      })

      try { await recordPostFailure('transient', rateLimits) } catch { /* best effort */ }

      return await releaseAndReturn({ success: false, error: errorMsg })
    }
  } catch (e) {
    // Safety: release lock on unexpected errors (e.g. updateMany threw
    // between lock acquisition and inner try/finally)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!lockReleased) {
      await releasePostingLock(lockValue).catch(() => {})
      lockReleased = true
    }
    throw e // re-throw so caller's outer catch can return 500
  }
}

/**
 * Wraps a function with an outer try/catch error boundary.
 * Used by Files 2 & 3 where the entire handler body can be cleanly wrapped.
 *
 * Files 1 & 4 keep their existing outer try/catch because they have
 * significant pre-posting setup (auth, validation, candidate selection)
 * that needs its own error handling.
 */
export async function withErrorBoundary(
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await fn()
  } catch (e) {
    debugError('execute-post', 'Unexpected error:', e)
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 },
    )
  }
}

/**
 * Optional per-user post cap check to run under the posting lock.
 * When provided, `createCooldownWindowChecks` will re-check the user's daily
 * post count authoritatively (under lock) to close the race window between
 * the pre-lock check and lock acquisition.
 *
 * Only used by File 1 (POST /api/submissions). File 4 (autopost) has no
 * per-user context — it picks any eligible submission.
 */
export interface PerUserCheck {
  submitterId: string
  username: string
  effectivePostCap: number
  isWhitelisted: boolean
}

/**
 * Creates the cooldown + window-cap under-lock checks used by Files 1 & 4.
 * Both callers run the same logic — only the debug log prefix differs.
 *
 * Returns a callback suitable for `extraUnderLockChecks` in ExecutePostInput.
 * The built-in globalPostDailyCap check is handled separately by
 * executePostAndRecord, so this only covers:
 *   - autoPostCooldown (seconds since last posted submission)
 *   - autoPostWindowCap + autoPostWindowMinutes (sliding window rate)
 *   - perUserCheck (optional, only File 1 — authoritative under-lock user post cap)
 */
export function createCooldownWindowChecks(
  rateLimits: RateLimitSettings,
  logPrefix: string,
  perUserCheck?: PerUserCheck,
): () => Promise<ExecutePostResult | null> {
  return async () => {
    // Re-check auto-post cooldown (authoritative under lock)
    // autoPostCooldown is in SECONDS → multiply by 1000 for ms
    if (rateLimits.autoPostCooldown > 0) {
      const lastPostedAt = await getLastPostedTime()
      if (lastPostedAt) {
        const elapsedMs = Date.now() - lastPostedAt.getTime()
        const cooldownMs = rateLimits.autoPostCooldown * 1000
        if (elapsedMs < cooldownMs) {
          debug(logPrefix, 'Auto-post cooldown active (confirmed under lock), queuing instead')
          return { success: false, underLockAbortReason: 'cooldown_active' }
        }
      }
    }

    // Re-check auto-post window cap (authoritative under lock)
    if (rateLimits.autoPostWindowCap > 0 && rateLimits.autoPostWindowMinutes > 0) {
      const windowStart = new Date(Date.now() - rateLimits.autoPostWindowMinutes * 60 * 1000)
      const windowPostCount = await db.submission.count({
        where: {
          status: 'posted',
          updatedAt: { gte: windowStart },
        },
      })
      if (windowPostCount >= rateLimits.autoPostWindowCap) {
        debug(logPrefix, 'Auto-post window cap reached (confirmed under lock):', windowPostCount, 'queuing instead')
        return { success: false, underLockAbortReason: 'window_cap_reached' }
      }
    }

    // globalPostDailyCap is handled by executePostAndRecord's built-in check

    // Per-user post daily cap — authoritative under-lock re-check.
    // The pre-lock check in submissions/route.ts is a fast-path for user-friendly
    // error messages (includes the count). This under-lock check is the
    // authoritative one that closes the race window.
    if (perUserCheck && !perUserCheck.isWhitelisted && perUserCheck.effectivePostCap > 0) {
      const startOfToday = getStartOfTodayWIB()
      const userPostCount = await db.submission.count({
        where: {
          submitterId: perUserCheck.submitterId,
          status: 'posted',
          updatedAt: { gte: startOfToday },
        },
      })
      if (userPostCount >= perUserCheck.effectivePostCap) {
        debug(logPrefix, 'User post daily cap reached (confirmed under lock):', userPostCount, 'for user', perUserCheck.username)
        return { success: false, underLockAbortReason: 'user_post_cap_reached' }
      }
    }

    return null
  }
}
