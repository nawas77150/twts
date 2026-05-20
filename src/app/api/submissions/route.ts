import { db } from '@/lib/db'
import { verifyAdmin, getAdminTokenFromRequest } from '@/lib/admin-auth'
import { executePostAndRecord, createCooldownWindowChecks } from '@/lib/execute-post'
import type { PerUserCheck } from '@/lib/execute-post'
import { isCircuitBreakerPaused } from '@/lib/circuit-breaker'
import { debug } from '@/lib/debug'
import { normalizeText, decodeHtmlEntities, DEFAULT_BLOCKED_WORDS, DEFAULT_NSFW_WORDS, DEFAULT_FILTER_RULES } from '@/lib/content-filter'
import { getFilterSettings, DEFAULT_RATE_LIMITS, DEFAULT_GEMINI_MODEL } from '@/lib/filter-settings'
import { getStartOfTodayWIB } from '@/lib/constants'
import { getCensoredReason, validateSubmission, runFilterPipeline, createQueuedSubmission } from './_lib'
import { logLimitHit, checkSubmissionRateLimits } from './_rate-limits'
import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'

// Vercel serverless function timeout — auto-post + Gemini can take up to 15s with retries
export const maxDuration = 30

// GET /api/submissions - List submissions (admin only, includes submitter info)
// Supports pagination via ?page=1&limit=50 (defaults: page=1, limit=50)
// Supports search via ?search=query (searches message, username, displayName)
export async function GET(req: NextRequest) {
  const auth = verifyAdmin(getAdminTokenFromRequest(req))
  if (!auth.authorized) return auth.response

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const search = searchParams.get('search')?.trim() || ''
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50))

  const where: Prisma.SubmissionWhereInput = status && status !== 'all' ? { status } : {}

  // Server-side search: case-insensitive search across message, username, displayName
  if (search) {
    where.OR = [
      { message: { contains: search, mode: 'insensitive' } },
      { submitter: { username: { contains: search, mode: 'insensitive' } } },
      { submitter: { displayName: { contains: search, mode: 'insensitive' } } },
    ]
  }

  const [submissions, total] = await Promise.all([
    db.submission.findMany({
      where,
      include: {
        submitter: {
          select: { id: true, username: true, displayName: true, profileImage: true, twitterId: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: (page - 1) * limit,
    }),
    db.submission.count({ where }),
  ])

  return NextResponse.json({
    submissions,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  })
}

// POST /api/submissions - Create new submission (requires Twitter login)
// When auto-approve is ON and both filters pass, submission is auto-posted to X
export async function POST(req: NextRequest) {
  try {
    // 1. Validate submission
    const validation = await validateSubmission(req)
    if (validation instanceof NextResponse) return validation
    const { submitter, trimmedMessage, sanitizedCategory } = validation

    // 2. Load filter settings
    let filterSettings: Awaited<ReturnType<typeof getFilterSettings>>
    try {
      filterSettings = await getFilterSettings()
    } catch {
      // If filter settings can't be loaded, fall back to defaults with auto-approve OFF
      debug('submit', 'Failed to load filter settings, using defaults with auto-approve OFF')
      filterSettings = {
        autoApprove: false,
        blockedWords: DEFAULT_BLOCKED_WORDS,
        nsfwWords: DEFAULT_NSFW_WORDS,
        filterRules: { ...DEFAULT_FILTER_RULES },
        geminiEnabled: false,
        geminiApiKeySet: false,
        geminiApiKey: null,
        geminiModel: DEFAULT_GEMINI_MODEL,
        rateLimits: { ...DEFAULT_RATE_LIMITS },
        whitelistUsernames: [],
        blockedUsernames: [],
      }
    }

    // 3. Check rate limits
    const rateLimitResult = await checkSubmissionRateLimits(submitter, filterSettings)
    if (rateLimitResult instanceof NextResponse) return rateLimitResult
    const { isWhitelisted, effectivePostCap } = rateLimitResult

    // 4. Run filter pipeline
    const pipelineResult = await runFilterPipeline(trimmedMessage, filterSettings, submitter.id)
    if (pipelineResult instanceof NextResponse) return pipelineResult
    const { allFilterReasons, passedAllFilters, hasCensorReasons, submissionStatus, filterReasonsJson, geminiError } = pipelineResult

    // 5. Auto-approve OFF
    if (!filterSettings.autoApprove) {
      const submission = await db.submission.create({
        data: {
          message: trimmedMessage,
          normalizedMessage: normalizeText(trimmedMessage),
          category: sanitizedCategory,
          submitterId: submitter.id,
          status: submissionStatus,
          filterReasons: filterReasonsJson,
        },
      })

      if (hasCensorReasons) {
        return NextResponse.json({
          submission,
          censored: true,
          censoredReason: getCensoredReason(allFilterReasons),
        }, { status: 201 })
      }

      return NextResponse.json({ submission }, { status: 201 })
    }

    // 6. Auto-approve ON + filter failed
    if (!passedAllFilters) {
      debug('submit', 'Filter blocked submission:', allFilterReasons)
      const submission = await db.submission.create({
        data: {
          message: trimmedMessage,
          normalizedMessage: normalizeText(trimmedMessage),
          category: sanitizedCategory,
          submitterId: submitter.id,
          status: 'censored',
          filterReasons: filterReasonsJson,
        },
      })

      return NextResponse.json({
        submission,
        censored: true,
        censoredReason: getCensoredReason(allFilterReasons),
        filterReasons: allFilterReasons,
      }, { status: 201 })
    }

    // 7. Auto-approve ON + all filters passed
    debug('submit', 'All filters passed, auto-posting submission')

    // Circuit breaker check
    const circuitBreakerPaused = await isCircuitBreakerPaused(filterSettings.rateLimits)
    if (circuitBreakerPaused) {
      debug('submit', 'Circuit breaker active, rejecting submission')
      return NextResponse.json({
        error: 'Sistem sedang sibuk',
        message: 'Auto-post sedang dijeda karena gangguan pada X. Coba lagi dalam beberapa menit.',
      }, { status: 400 })
    }

    // Auto-post cooldown — uses createQueuedSubmission
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
          debug('submit', 'Auto-post cooldown active, queuing instead')
          return createQueuedSubmission(trimmedMessage, sanitizedCategory, submitter.id)
        }
      }
    }

    // Auto-post window cap — uses createQueuedSubmission
    if (filterSettings.rateLimits.autoPostWindowCap > 0 && filterSettings.rateLimits.autoPostWindowMinutes > 0) {
      const windowStart = new Date(Date.now() - filterSettings.rateLimits.autoPostWindowMinutes * 60 * 1000)
      const windowPostCount = await db.submission.count({
        where: { status: 'posted', updatedAt: { gte: windowStart } },
      })
      if (windowPostCount >= filterSettings.rateLimits.autoPostWindowCap) {
        debug('submit', 'Auto-post window cap reached:', windowPostCount, 'in last', filterSettings.rateLimits.autoPostWindowMinutes, 'min, queuing instead')
        return createQueuedSubmission(trimmedMessage, sanitizedCategory, submitter.id)
      }
    }

    // Global post daily cap — uses createQueuedSubmission
    if (filterSettings.rateLimits.globalPostDailyCap > 0) {
      const startOfToday = getStartOfTodayWIB()
      const globalPostCount = await db.submission.count({
        where: { status: 'posted', createdAt: { gte: startOfToday } },
      })
      if (globalPostCount >= filterSettings.rateLimits.globalPostDailyCap) {
        debug('submit', 'Global post daily cap reached:', globalPostCount, 'queuing instead')
        return createQueuedSubmission(trimmedMessage, sanitizedCategory, submitter.id)
      }
    }

    // Per-user post daily cap — STAYS INLINE (has postCapped, logLimitHit, dynamic error)
    if (!isWhitelisted && effectivePostCap > 0) {
      const startOfToday = getStartOfTodayWIB()
      const userPostCount = await db.submission.count({
        where: {
          submitterId: submitter.id,
          status: 'posted',
          createdAt: { gte: startOfToday },
        },
      })
      if (userPostCount >= effectivePostCap) {
        debug('submit', 'User post daily cap reached:', userPostCount, 'for user', submitter.username, 'queuing instead')
        logLimitHit(submitter.username, 'post_cap')
        const submission = await db.submission.create({
          data: {
            message: trimmedMessage,
            normalizedMessage: normalizeText(trimmedMessage),
            category: sanitizedCategory,
            submitterId: submitter.id,
            filterReasons: null,
          },
        })
        return NextResponse.json({
          submission,
          autoPosted: false,
          queued: true,
          postCapped: true,
          error: `Batas post harian kamu tercapai (${userPostCount}/${effectivePostCap}). Pesan masuk antrean dan akan diposting oleh admin setelahnya.`,
        }, { status: 201 })
      }
    }

    // Create as pending first, then attempt to post
    const autoPostFilterReasons = geminiError ? JSON.stringify(['ai:skipped_error']) : null
    const submission = await db.submission.create({
      data: {
        message: trimmedMessage,
        normalizedMessage: normalizeText(trimmedMessage),
        category: sanitizedCategory,
        submitterId: submitter.id,
        filterReasons: autoPostFilterReasons,
      },
    })

    // Delegated: lock → under-lock checks → CAS → post → record → release
    // Pass per-user post cap info so the authoritative check runs under lock,
    // closing the race window between the pre-lock check and lock acquisition.
    const perUserCheck: PerUserCheck = {
      submitterId: submitter.id,
      username: submitter.username,
      effectivePostCap,
      isWhitelisted,
    }
    const postResult = await executePostAndRecord({
      submissionId: submission.id,
      message: decodeHtmlEntities(trimmedMessage),
      rateLimits: filterSettings.rateLimits,
      casStatuses: ['pending'],
      extraUnderLockChecks: createCooldownWindowChecks(filterSettings.rateLimits, 'submit', perUserCheck),
    })

    // Map result to HTTP response (File 1 returns soft 201 for lock-busy / cap-exceeded)
    if (postResult.lockBusy) {
      debug('submit', 'Posting lock busy, queuing submission')
      return NextResponse.json({
        submission,
        autoPosted: false,
        queued: true,
        error: 'Pesanmu sudah masuk antrean dan akan diposting oleh admin setelahnya.',
      }, { status: 201 })
    }

    if (postResult.underLockAbortReason) {
      // File 1 treats ALL under-lock aborts as "queued" (soft 201)
      // This includes cooldown_active, window_cap_reached, global_post_daily_cap_reached
      debug('submit', 'Under-lock abort, queuing submission:', postResult.underLockAbortReason)
      return NextResponse.json({
        submission,
        autoPosted: false,
        queued: true,
        error: 'Pesanmu sudah masuk antrean dan akan diposting oleh admin setelahnya.',
      }, { status: 201 })
    }

    if (postResult.casAborted) {
      debug('submit', 'Submission status changed before posting, aborting')
      return NextResponse.json({
        submission,
        autoPosted: false,
        error: 'Status pesan berubah sebelum diproses. Cek riwayat submission-mu.',
      }, { status: 409 })
    }

    if (postResult.success) {
      debug('submit', 'Auto-post succeeded! tweetId:', postResult.tweetId, 'method:', postResult.method)
      if (postResult.warning) {
        return NextResponse.json({
          autoPosted: true,
          tweetId: postResult.tweetId,
          postMethod: postResult.method,
          warning: postResult.warning,
        }, { status: 201 })
      }
      const updated = await db.submission.findUnique({ where: { id: submission.id } })
      return NextResponse.json({
        submission: updated,
        autoPosted: true,
        tweetId: postResult.tweetId,
        postMethod: postResult.method,
      }, { status: 201 })
    } else {
      const failedSubmission = await db.submission.findUnique({ where: { id: submission.id } })
      return NextResponse.json({
        submission: failedSubmission,
        autoPosted: false,
        postFailed: true,
        error: 'Gagal auto-post. Pesanmu masuk antrean untuk review admin.',
      }, { status: 201 })
    }
  } catch (e) {
    console.error('[submit] Unexpected error:', e)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
