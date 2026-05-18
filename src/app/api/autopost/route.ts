import { db } from '@/lib/db'
import { postTweetViaCookie } from '@/lib/twitter-post-cookie'
import { acquirePostingLock, releasePostingLock } from '@/lib/posting-lock'
import { isCircuitBreakerPaused, recordPostSuccess, recordPostFailure, getCircuitBreakerStatus } from '@/lib/circuit-breaker'
import { getFilterSettings } from '@/lib/filter-settings'
import { getEffectiveLimit } from '@/lib/limit-resolver'
import { decodeHtmlEntities } from '@/lib/content-filter'
import { getStartOfTodayWIB } from '@/lib/constants'
import { debug } from '@/lib/debug'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

// GET /api/autopost — Cron endpoint for auto-posting queued submissions.
// Called by external cron service (cron-job.org) every minute.
// Processes exactly 1 submission per hit.
// Requires CRON_SECRET env var for authentication.
export async function GET(req: NextRequest) {
  let lockValue: string | null = null

  try {
    // ── Authentication ──────────────────────────────────────
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      console.error('[autopost] CRON_SECRET env var not set')
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
    }

    const authHeader = req.headers.get('authorization')
    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ── Load filter settings ────────────────────────────────
    let filterSettings: Awaited<ReturnType<typeof getFilterSettings>>
    try {
      filterSettings = await getFilterSettings()
    } catch {
      debug('[autopost] Failed to load filter settings')
      return NextResponse.json(
        { processed: false, reason: 'settings_load_failed' },
        { status: 500 }
      )
    }

    // ── Gate: auto-approve must be ON ───────────────────────
    if (!filterSettings.autoApprove) {
      return NextResponse.json({ processed: false, reason: 'auto_approve_off' })
    }

    // ── Gate: circuit breaker ───────────────────────────────
    // MUST call isCircuitBreakerPaused() first — it auto-resets
    // expired state (3 conditional SQL UPDATEs). Only call
    // getCircuitBreakerStatus() when actually paused for metadata.
    const isPaused = await isCircuitBreakerPaused(filterSettings.rateLimits)
    if (isPaused) {
      const cbStatus = await getCircuitBreakerStatus(filterSettings.rateLimits)
      return NextResponse.json({
        processed: false,
        reason: 'circuit_breaker_paused',
        pausedUntil: cbStatus.pausedUntil,
        remainingMinutes: cbStatus.remainingMinutes,
      })
    }

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
      return NextResponse.json({ processed: false, reason: 'no_eligible_submissions' })
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
          debug('[autopost] Skipping — user post cap reached:', submitterUsername, userPostCount, '/', effectivePostCap)
          continue
        }
      }

      selectedSubmission = candidate
      break
    }

    if (!selectedSubmission) {
      return NextResponse.json({ processed: false, reason: 'all_candidates_capped' })
    }

    const submission = selectedSubmission

    // ── Acquire posting lock ────────────────────────────────
    lockValue = await acquirePostingLock()
    if (!lockValue) {
      debug('[autopost] Posting lock busy')
      return NextResponse.json({ processed: false, reason: 'posting_lock_busy' })
    }

    // ── Re-check cooldown under lock (authoritative) ────────
    // autoPostCooldown is in SECONDS → multiply by 1000 for ms
    if (filterSettings.rateLimits.autoPostCooldown > 0) {
      const lastPosted = await db.submission.findFirst({
        where: { status: 'posted' },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      })
      if (lastPosted) {
        const elapsedMs = Date.now() - lastPosted.updatedAt.getTime()
        const cooldownMs = filterSettings.rateLimits.autoPostCooldown * 1000
        if (elapsedMs < cooldownMs) {
          debug('[autopost] Cooldown active under lock, releasing')
          await releasePostingLock(lockValue)
          lockValue = null
          return NextResponse.json({ processed: false, reason: 'cooldown_active' })
        }
      }
    }

    // ── Re-check window cap under lock (authoritative) ──────
    if (filterSettings.rateLimits.autoPostWindowCap > 0 && filterSettings.rateLimits.autoPostWindowMinutes > 0) {
      const windowStart = new Date(Date.now() - filterSettings.rateLimits.autoPostWindowMinutes * 60 * 1000)
      const windowPostCount = await db.submission.count({
        where: { status: 'posted', updatedAt: { gte: windowStart } },
      })
      if (windowPostCount >= filterSettings.rateLimits.autoPostWindowCap) {
        debug('[autopost] Window cap reached under lock, releasing')
        await releasePostingLock(lockValue)
        lockValue = null
        return NextResponse.json({ processed: false, reason: 'window_cap_reached' })
      }
    }

    // ── Mark as "posting" (prevent double-post) ─────────────
    const marked = await db.submission.updateMany({
      where: {
        id: submission.id,
        status: { in: ['pending', 'post_failed'] },
      },
      data: { status: 'posting' },
    })
    if (marked.count === 0) {
      debug('[autopost] Status changed before posting, aborting')
      await releasePostingLock(lockValue)
      lockValue = null
      return NextResponse.json({ processed: false, reason: 'status_changed' })
    }

    // ── Post to X ──────────────────────────────────────────
    // postTweetViaCookie handles all retries + fallback internally
    try {
      const tweetResult = await postTweetViaCookie(
        decodeHtmlEntities(submission.message)
      )

      if (tweetResult.success) {
        debug('[autopost] Post succeeded! tweetId:', tweetResult.tweetId, 'method:', tweetResult.method)

        await db.submission.updateMany({
          where: { id: submission.id, status: 'posting' },
          data: {
            status: 'posted',
            tweetId: tweetResult.tweetId || null,
            postMethod: tweetResult.method,
            postError: null,
          },
        })

        await recordPostSuccess()

        return NextResponse.json({
          processed: true,
          submissionId: submission.id,
          tweetId: tweetResult.tweetId,
          postMethod: tweetResult.method,
        })
      } else {
        const errorMsg = tweetResult.error || 'Unknown error'
        debug('[autopost] Post failed:', errorMsg)

        await db.submission.updateMany({
          where: { id: submission.id, status: 'posting' },
          data: { status: 'post_failed', postError: errorMsg },
        })

        try { await recordPostFailure(filterSettings.rateLimits) } catch { /* best effort */ }

        return NextResponse.json({
          processed: false,
          reason: 'post_failed',
          submissionId: submission.id,
          error: errorMsg,
        })
      }
    } catch (postError) {
      const errorMsg = postError instanceof Error ? postError.message : String(postError)
      debug('[autopost] Post exception:', errorMsg)

      await db.submission.updateMany({
        where: { id: submission.id, status: 'posting' },
        data: { status: 'post_failed', postError: errorMsg },
      })

      try { await recordPostFailure(filterSettings.rateLimits) } catch { /* best effort */ }

      return NextResponse.json({
        processed: false,
        reason: 'post_failed',
        submissionId: submission.id,
        error: errorMsg,
      })
    } finally {
      if (lockValue) {
        await releasePostingLock(lockValue)
        lockValue = null
      }
    }
  } catch (e) {
    // Safety: release lock if acquired but not yet released by inner finally
    if (lockValue) {
      await releasePostingLock(lockValue).catch(() => {})
    }
    console.error('[autopost] Unexpected error:', e)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
