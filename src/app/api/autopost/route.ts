import { db } from '@/lib/db'
import { executePostAndRecord, createCooldownWindowChecks } from '@/lib/execute-post'
import { isCircuitBreakerPaused, getCircuitBreakerStatus } from '@/lib/circuit-breaker'
import { getFilterSettings } from '@/lib/filter-settings'
import { getEffectiveLimit } from '@/lib/limit-resolver'
import { decodeHtmlEntities } from '@/lib/content-filter'
import { appendHashtags } from '@/lib/append-hashtags'
import { getStartOfTodayWIB } from '@/lib/constants'
import { debug } from '@/lib/debug'
import { recoverStalePostings } from '@/lib/stale-posting'
import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

/** Timing-safe string comparison to prevent timing side-channel attacks. */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

/** Wrap response with Cache-Control: no-store on every response.
 *  Prevents caching intermediaries (CDNs, proxies) from serving stale
 *  cron results, which could mask actual posting failures. */
function cronJson(body: unknown, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  headers.set('Cache-Control', 'no-store')
  return new NextResponse(JSON.stringify(body), { ...init, headers })
}

// GET /api/autopost — Cron endpoint for auto-posting queued submissions.
// Called by external cron service (cron-job.org) every minute.
// Processes exactly 1 submission per hit.
// Requires CRON_SECRET env var for authentication.
export async function GET(req: NextRequest) {
  try {
    // ── Authentication ──────────────────────────────────────
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      console.error('[autopost] CRON_SECRET env var not set')
      return cronJson({ error: 'CRON_SECRET not configured' }, { status: 500 })
    }

    const authHeader = req.headers.get('authorization')
    if (!authHeader || !timingSafeEqual(authHeader, `Bearer ${cronSecret}`)) {
      return cronJson({ error: 'Unauthorized' }, { status: 401 })
    }

    // ── Load filter settings ────────────────────────────────
    let filterSettings: Awaited<ReturnType<typeof getFilterSettings>>
    try {
      filterSettings = await getFilterSettings()
    } catch {
      debug('autopost', 'Failed to load filter settings')
      return cronJson(
        { processed: false, reason: 'settings_load_failed' },
        { status: 500 }
      )
    }

    // ── Opportunistic cleanup: old LimitHit records ──────────
    // Delete records older than 7 days (fire-and-forget, never blocks)
    void db.limitHit.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    }).catch(() => {})

    // ── Gate: auto-approve must be ON ───────────────────────
    if (!filterSettings.autoApprove) {
      return cronJson(
        { processed: false, reason: 'auto_approve_off' }
      )
    }

    // ── Gate: circuit breaker ───────────────────────────────
    // MUST call isCircuitBreakerPaused() first — it auto-resets
    // expired state (3 conditional SQL UPDATEs). Only call
    // getCircuitBreakerStatus() when actually paused for metadata.
    const isPaused = await isCircuitBreakerPaused(filterSettings.rateLimits)
    if (isPaused) {
      const cbStatus = await getCircuitBreakerStatus(filterSettings.rateLimits)
      return cronJson({
        processed: false,
        reason: 'circuit_breaker_paused',
        pausedUntil: cbStatus.pausedUntil,
        remainingMinutes: cbStatus.remainingMinutes,
      })
    }

    // ── Recover stale "posting" submissions ──────────────
    // Submissions stuck in "posting" status (Vercel timeout killed the
    // function before cleanup) are invisible to the pending/post_failed
    // query below. Recover them so they become eligible again.
    void recoverStalePostings().catch(() => {})

    // ── Find up to 5 candidate submissions (FIFO) ──────────
    // If the first candidate is per-user-capped, we skip and try
    // the next one. Blocked users are already excluded —
    // block/route.ts auto-rejects their submissions.
    const candidates = await db.submission.findMany({
      where: {
        status: { in: ['pending', 'post_failed'] },
      },
      include: {
        submitter: {
          select: { id: true, username: true, customLimits: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 5,
    })

    if (candidates.length === 0) {
      return cronJson({ processed: false, reason: 'no_eligible_submissions' })
    }

    // ── Iterate candidates — find first valid one ───────────
    // Sequential cap queries are fine for a once-per-minute cron;
    // early break means average case is 1 query.
    let selectedSubmission: (typeof candidates)[0] | null = null

    for (const candidate of candidates) {
      const submitterUsername = candidate.submitter.username || ''

      const isWhitelisted = filterSettings.whitelistUsernames.includes(submitterUsername)

      const effectivePostCap = getEffectiveLimit(
        'userPostDailyCap',
        candidate.submitter.customLimits,
        filterSettings.rateLimits.userPostDailyCap
      )

      if (!isWhitelisted && effectivePostCap > 0) {
        const startOfToday = getStartOfTodayWIB()
        const userPostCount = await db.submission.count({
          where: {
            submitterId: candidate.submitter.id,
            status: 'posted',
            createdAt: { gte: startOfToday },
          },
        })
        if (userPostCount >= effectivePostCap) {
          debug('autopost', 'Skipping — user post cap reached:', submitterUsername, userPostCount, '/', effectivePostCap)
          continue
        }
      }

      selectedSubmission = candidate
      break
    }

    if (!selectedSubmission) {
      return cronJson({ processed: false, reason: 'all_candidates_capped' })
    }

    const submission = selectedSubmission

    // ── Delegated: lock → under-lock checks → CAS → post → record → release ──
    const postResult = await executePostAndRecord({
      submissionId: submission.id,
      message: appendHashtags(decodeHtmlEntities(submission.message), filterSettings.postHashtags),
      rateLimits: filterSettings.rateLimits,
      casStatuses: ['pending', 'post_failed'],
      extraUnderLockChecks: createCooldownWindowChecks(filterSettings.rateLimits, 'autopost'),
    })

    // Map result — File 4 returns 200 with processed:false for soft failures
    if (postResult.lockBusy) {
      debug('autopost', 'Posting lock busy')
      return cronJson({ processed: false, reason: 'posting_lock_busy' })
    }
    if (postResult.underLockAbortReason) {
      return cronJson({ processed: false, reason: postResult.underLockAbortReason })
    }
    if (postResult.casAborted) {
      debug('autopost', 'Status changed before posting, aborting')
      return cronJson({ processed: false, reason: 'status_changed' })
    }
    if (postResult.success) {
      debug('autopost', 'Post succeeded! tweetId:', postResult.tweetId, 'method:', postResult.method)
      // ★ BUG FIX: warning path now handled (was missing in original)
      if (postResult.warning) {
        return cronJson({
          processed: true,
          submissionId: submission.id,
          tweetId: postResult.tweetId,
          postMethod: postResult.method,
          warning: postResult.warning,
        })
      }
      return cronJson({
        processed: true,
        submissionId: submission.id,
        tweetId: postResult.tweetId,
        postMethod: postResult.method,
      })
    } else {
      const errorMsg = postResult.error || 'Unknown error'
      debug('autopost', 'Post failed:', errorMsg)
      return cronJson({
        processed: false,
        reason: 'post_failed',
        submissionId: submission.id,
        error: errorMsg,
      })
    }
  } catch (e) {
    console.error('[autopost] Unexpected error:', e)
    return cronJson({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
