import { db } from '@/lib/db'
import { getSubmitterFromNextRequest } from '@/lib/twitter-auth'
import { getFilterSettings } from '@/lib/filter-settings'
import { resolveEffectiveLimits, hasCustomLimits } from '@/lib/limit-resolver'
import { getStartOfTodayWIB } from '@/lib/constants'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/submissions/mine - Get current user's submissions + limits
export async function GET(req: NextRequest) {
  try {
    const submitter = await getSubmitterFromNextRequest(req)

    if (!submitter) {
      return NextResponse.json({ error: 'Silakan login dengan akun X terlebih dahulu' }, { status: 401 })
    }

    // Anon users (profile fetch failed) cannot access submissions
    if (submitter.username?.startsWith('anon_')) {
      return NextResponse.json({
        error: 'Profil X belum dimuat',
        message: 'Coba login ulang.',
      }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 100)

    const submissions = await db.submission.findMany({
      where: { submitterId: submitter.id },
      select: {
        id: true,
        message: true,
        status: true,
        tweetId: true,
        category: true,
        filterReasons: true,
        postError: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    // Accurate stats from separate GROUP BY (not from the limited submissions array)
    const statusCounts = await db.submission.groupBy({
      by: ['status'],
      where: { submitterId: submitter.id },
      _count: { status: true },
    })
    const stats: Record<string, number> = { total: 0, pending: 0, censored: 0, posted: 0, rejected: 0, postFailed: 0 }
    for (const row of statusCounts) {
      stats.total += row._count.status
      if (row.status === 'pending' || row.status === 'posting') stats.pending += row._count.status
      else if (row.status === 'censored') stats.censored += row._count.status
      else if (row.status === 'posted') stats.posted = row._count.status
      else if (row.status === 'rejected') stats.rejected = row._count.status
      else if (row.status === 'post_failed') stats.postFailed = row._count.status
    }

    // --- Limits data ---
    let limitsData: Record<string, unknown> | null = null
    try {
      const filterSettings = await getFilterSettings()
      const effectiveLimits = resolveEffectiveLimits(submitter.customLimits, filterSettings.rateLimits)
      const isCustom = hasCustomLimits(submitter.customLimits)

      const startOfToday = getStartOfTodayWIB()

      const [dailySubmissionCount, pendingCount, dailyPostCount, lastSubmission] = await Promise.all([
        db.submission.count({
          where: {
            submitterId: submitter.id,
            createdAt: { gte: startOfToday },
          },
        }),
        db.submission.count({
          where: {
            submitterId: submitter.id,
            status: 'pending',
            createdAt: { gte: startOfToday },
          },
        }),
        // Daily posts — uses createdAt with calendar day WIB boundary for consistency
        db.submission.count({
          where: {
            submitterId: submitter.id,
            status: 'posted',
            createdAt: { gte: startOfToday },
          },
        }),
        db.submission.findFirst({
          where: { submitterId: submitter.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ])

      const cooldownMs = effectiveLimits.submissionCooldown * 60 * 1000
      const cooldownSeconds = lastSubmission
        ? Math.max(0, Math.ceil((new Date(lastSubmission.createdAt).getTime() + cooldownMs - Date.now()) / 1000))
        : 0

      limitsData = {
        dailyCap: effectiveLimits.submissionDailyCap,
        dailyUsed: dailySubmissionCount,
        pendingCap: effectiveLimits.userPendingCap,
        pendingUsed: pendingCount,
        postCap: effectiveLimits.userPostDailyCap,
        postUsed: dailyPostCount,
        cooldownSeconds,
        isCustom,
        autoApprove: filterSettings.autoApprove,
      }
    } catch {
      // If limits computation fails, return null — don't block the main response
    }

    // Sanitize filterReasons — strip sensitive values after colon so users never see
    // the actual blocked/NSFW word. E.g. "blocked_word:kontol" → "blocked_word",
    // "nsfw_word:xxx" → "nsfw_word". The UI's getFilterReasonLabel() handles
    // bare keys with generic labels; "jualan:WTS" is kept (marketplace tags aren't sensitive).
    const sanitizedSubmissions = submissions.map((s) => ({
      ...s,
      filterReasons: s.filterReasons
        ? (() => {
            try {
              return JSON.stringify(
                (JSON.parse(s.filterReasons) as string[]).map((r: string) =>
                  r.startsWith('blocked_word:') ? 'blocked_word'
                  : r.startsWith('nsfw_word:') ? 'nsfw_word'
                  : r,
                ),
              )
            } catch {
              return s.filterReasons
            }
          })()
        : s.filterReasons,
    }))

    return NextResponse.json({
      submissions: sanitizedSubmissions,
      stats,
      limits: limitsData,
    })
  } catch (error) {
    console.error('[submissions/mine] Error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
