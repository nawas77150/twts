import { db } from '@/lib/db'
import { getSubmitterFromNextRequest } from '@/lib/twitter-auth'
import { postTweetViaCookie } from '@/lib/twitter-post-cookie'
import { verifyAdmin, getAdminTokenFromRequest } from '@/lib/admin-auth'
import { getStartOfTodayWIB } from '@/lib/constants'
import { debug } from '@/lib/debug'
import { runContentFilter, checkDuplicate24h, normalizeText, sanitizeInput, decodeHtmlEntities, hasAlwaysOnReason, getRejectionMessage, DEFAULT_BLOCKED_WORDS, DEFAULT_NSFW_WORDS, DEFAULT_FILTER_RULES, type FilterRules } from '@/lib/content-filter'
import { runGeminiFilter } from '@/lib/gemini-filter'
import { acquirePostingLock, releasePostingLock } from '@/lib/posting-lock'
import { isCircuitBreakerPaused, recordPostSuccess, recordPostFailure } from '@/lib/circuit-breaker'
import { getFilterSettings, getGeminiApiKey, getGeminiModel, DEFAULT_RATE_LIMITS, type RateLimitSettings } from '@/lib/filter-settings'
import { getEffectiveLimit } from '@/lib/limit-resolver'
import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'

// Determine censored reason from filter reasons
function getCensoredReason(reasons: string[]): 'ai' | 'filter' | 'both' {
  const hasAi = reasons.some(r => r.startsWith('ai:'))
  const hasFilter = reasons.some(r => !r.startsWith('ai:'))
  if (hasAi && hasFilter) return 'both'
  return hasAi ? 'ai' : 'filter'
}

// Log a rate limit hit (fire-and-forget, never blocks the response)
function logLimitHit(username: string, limitType: string) {
  db.limitHit.create({ data: { username, limitType } }).catch(() => {
    // Swallow — logging must never break the submission flow
  })
}

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
  // Declare lockValue outside try so outer catch can release it on error
  // (e.g. if updateMany throws between lock acquisition and inner try/finally)
  let lockValue: string | null = null

  try {
    // Get submitter from session cookie (Twitter OAuth)
    const submitter = await getSubmitterFromNextRequest(req)

    if (!submitter) {
      return NextResponse.json({ error: 'Silakan login dengan akun X terlebih dahulu' }, { status: 401 })
    }

    // Anon users (profile fetch failed) cannot submit — they need to re-login
    if (submitter.username?.startsWith('anon_')) {
      return NextResponse.json({
        error: 'Profil X belum dimuat',
        message: 'Coba login ulang untuk mengirim pesan.',
      }, { status: 403 })
    }

    const body = await req.json()
    const { message, category } = body

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Pesan wajib diisi' }, { status: 400 })
    }

    // Validate category length to prevent abuse (must match frontend maxLength)
    if (category && typeof category === 'string' && category.trim().length > 30) {
      return NextResponse.json({ error: 'Kategori maksimal 30 karakter' }, { status: 400 })
    }

    const trimmedMessage = sanitizeInput(message.trim())
    const sanitizedCategory = category && typeof category === 'string' ? sanitizeInput(category.trim()) : null

    if (trimmedMessage.length === 0) {
      return NextResponse.json({ error: 'Pesan tidak boleh kosong' }, { status: 400 })
    }

    if (trimmedMessage.length > 280) {
      return NextResponse.json(
        { error: `Pesan terlalu panjang (${trimmedMessage.length}/280 karakter)` },
        { status: 400 }
      )
    }

    // --- LOAD FILTER & RATE LIMIT SETTINGS ---
    let filterSettings: {
      autoApprove: boolean
      blockedWords: string[]
      nsfwWords: string[]
      filterRules: FilterRules
      geminiEnabled: boolean
      geminiApiKeySet: boolean
      rateLimits: RateLimitSettings
      whitelistUsernames: string[]
      blockedUsernames: string[]
    }

    try {
      filterSettings = await getFilterSettings()
    } catch {
      // If filter settings can't be loaded, fall back to defaults with auto-approve OFF
      debug('[submit] Failed to load filter settings, using defaults with auto-approve OFF')
      filterSettings = {
        autoApprove: false,
        blockedWords: DEFAULT_BLOCKED_WORDS,
        nsfwWords: DEFAULT_NSFW_WORDS,
        filterRules: DEFAULT_FILTER_RULES,
        geminiEnabled: false,
        geminiApiKeySet: false,
        rateLimits: { ...DEFAULT_RATE_LIMITS },
        whitelistUsernames: [],
        blockedUsernames: [],
      }
    }

    // --- RATE LIMITING ---
    // Check if user is blocked (cannot submit at all)
    const isBlocked = submitter.username
      ? filterSettings.blockedUsernames.includes(submitter.username.toLowerCase())
      : false

    if (isBlocked) {
      debug('[submit] User is blocked:', submitter.username)
      return NextResponse.json({
        error: 'Akun diblokir',
        message: 'Akun kamu tidak diperbolehkan mengirim pesan.',
      }, { status: 403 })
    }

    // Check if this user is whitelisted (bypasses rate limits)
    const isWhitelisted = submitter.username
      ? filterSettings.whitelistUsernames.includes(submitter.username.toLowerCase())
      : false

    // --- GLOBAL RATE LIMITS (apply to everyone including whitelisted) ---
    // Check global submission daily cap
    if (filterSettings.rateLimits.globalSubmissionDailyCap > 0) {
      const startOfToday = getStartOfTodayWIB()
      const globalCount = await db.submission.count({
        where: { createdAt: { gte: startOfToday } },
      })
      if (globalCount >= filterSettings.rateLimits.globalSubmissionDailyCap) {
        debug('[submit] Global daily cap reached:', globalCount)
        logLimitHit(submitter.username, 'global_cap')
        return NextResponse.json({
          error: 'Sistem sedang sibuk',
          message: 'Batas harian sistem tercapai. Coba lagi besok.',
        }, { status: 400 })
      }
    }

    // --- PER-USER RATE LIMITS (bypassed by whitelist) ---
    // Resolve effective limits: custom overrides → global defaults
    const effectiveCooldown = getEffectiveLimit('submissionCooldown', submitter.customLimits, filterSettings.rateLimits.submissionCooldown)
    const effectiveDailyCap = getEffectiveLimit('submissionDailyCap', submitter.customLimits, filterSettings.rateLimits.submissionDailyCap)
    const effectivePendingCap = getEffectiveLimit('userPendingCap', submitter.customLimits, filterSettings.rateLimits.userPendingCap)
    const effectivePostCap = getEffectiveLimit('userPostDailyCap', submitter.customLimits, filterSettings.rateLimits.userPostDailyCap)

    if (!isWhitelisted) {
      // Check per-user cooldown
      if (effectiveCooldown > 0) {
        const lastSubmission = await db.submission.findFirst({
          where: { submitterId: submitter.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        })
        if (lastSubmission) {
          const elapsedMs = Date.now() - lastSubmission.createdAt.getTime()
          const cooldownMs = effectiveCooldown * 60 * 1000
          if (elapsedMs < cooldownMs) {
            const waitMinutes = Math.ceil((cooldownMs - elapsedMs) / 60000)
            const waitSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000)
            const waitMsg = waitMinutes > 1 ? `${waitMinutes} menit` : `${waitSeconds} detik`
            debug('[submit] Cooldown: user must wait', waitMsg)
            logLimitHit(submitter.username, 'cooldown')
            return NextResponse.json({
              error: 'Tunggu sebentar',
              message: `Tunggu ${waitMsg} sebelum mengirim pesan lagi.`,
            }, { status: 400 })
          }
        }
      }

      // Check daily cap
      if (effectiveDailyCap > 0) {
        const startOfToday = getStartOfTodayWIB()
        const todayCount = await db.submission.count({
          where: {
            submitterId: submitter.id,
            createdAt: { gte: startOfToday },
          },
        })
        if (todayCount >= effectiveDailyCap) {
          debug('[submit] Daily cap reached:', todayCount)
          logLimitHit(submitter.username, 'daily_cap')
          return NextResponse.json({
            error: 'Batas harian tercapai',
            message: `Kamu sudah mengirim ${todayCount} pesan hari ini (maksimal ${effectiveDailyCap}). Coba lagi besok.`,
          }, { status: 400 })
        }
      }

      // Check per-user pending cap (daily — resets 00:00 WIB)
      if (effectivePendingCap > 0) {
        const startOfToday = getStartOfTodayWIB()
        const pendingCount = await db.submission.count({
          where: {
            submitterId: submitter.id,
            status: 'pending',
            createdAt: { gte: startOfToday },
          },
        })
        if (pendingCount >= effectivePendingCap) {
          debug('[submit] User pending cap reached:', pendingCount, 'for user', submitter.username)
          logLimitHit(submitter.username, 'pending_cap')
          return NextResponse.json({
            error: 'Terlalu banyak pesan menunggu',
            message: `Kamu sudah mengirim ${pendingCount} pesan menunggu hari ini (maksimal ${effectivePendingCap}). Coba lagi besok.`,
          }, { status: 400 })
        }
      }
    } else {
      debug('[submit] User whitelisted, skipping rate limits:', submitter.username)
    }

    // --- Step 1: Rule-based content filter ---
    const filterResult = runContentFilter(
      trimmedMessage,
      filterSettings.blockedWords,
      filterSettings.filterRules,
      filterSettings.nsfwWords,
    )

    // Check for duplicates (24h) if rule is enabled
    if (filterSettings.filterRules.duplicate24h) {
      const dupCheck = await checkDuplicate24h(trimmedMessage, db, submitter.id)
      if (dupCheck.isDuplicate && dupCheck.reason) {
        filterResult.passed = false
        filterResult.reasons.push(dupCheck.reason)
        if (filterResult.severity === 'none') filterResult.severity = 'medium'
      }
    }

    // --- REJECT always-on rule failures outright (no DB record, no pending) ---
    // These are spam/low-quality submissions with zero chance of admin approval
    if (hasAlwaysOnReason(filterResult.reasons)) {
      const rejectionMsg = getRejectionMessage(filterResult.reasons)
      debug('[submit] Rejected (always-on rule):', filterResult.reasons)
      return NextResponse.json({
        error: 'Pesan ditolak',
        message: rejectionMsg,
        reasons: filterResult.reasons,
      }, { status: 400 })
    }

    // Collect all filter reasons (from both rule-based and Gemini)
    const allFilterReasons: string[] = filterResult.passed ? [] : [...filterResult.reasons]

    // --- Step 2: Gemini AI filter (optional, only if rule-based passed) ---
    let geminiChecked = false
    let geminiPassed = true
    let geminiError = false // Track if Gemini errored (for informational filterReasons)

    if (filterResult.passed && filterSettings.geminiEnabled && filterSettings.geminiApiKeySet) {
      try {
        const geminiApiKey = await getGeminiApiKey()
        if (geminiApiKey) {
          debug('[submit] Running Gemini AI filter')
          const geminiModel = await getGeminiModel()
          const geminiResult = await runGeminiFilter(trimmedMessage, geminiApiKey, geminiModel)
          geminiChecked = geminiResult.checked

          if (!geminiResult.passed) {
            if (geminiResult.error) {
              // Gemini error/timeout — skip it, don't block the submission
              debug('[submit] Gemini error (skipping):', geminiResult.error)
              geminiError = true
            } else {
              // Gemini genuinely flagged the submission
              geminiPassed = false
              const geminiReason = geminiResult.reason || 'Flagged by AI'
              allFilterReasons.push(`ai:${geminiReason}`)
              debug('[submit] Gemini flagged submission:', geminiReason)
            }
          } else {
            debug('[submit] Gemini passed submission')
          }
        }
      } catch (err) {
        // Gemini threw an exception — skip it, don't block the submission
        debug('[submit] Gemini exception (skipping):', err)
        geminiError = true
      }
    }

    // Determine if submission passes all filters
    const passedAllFilters = filterResult.passed && geminiPassed

    // Determine submission status based on filter results
    // censored = has actual censor reasons (not just informational ai:skipped_error)
    const hasCensorReasons = allFilterReasons.length > 0
    const submissionStatus: 'pending' | 'censored' = hasCensorReasons ? 'censored' : 'pending'

    // Build filterReasons JSON — include ai:skipped_error if Gemini errored
    const allFilterReasonsWithInfo = [...allFilterReasons]
    if (geminiError) allFilterReasonsWithInfo.push('ai:skipped_error')
    const filterReasonsJson = allFilterReasonsWithInfo.length > 0 ? JSON.stringify(allFilterReasonsWithInfo) : null

    // --- AUTO-APPROVE OFF: Submissions go to pending or censored ---
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

    // --- AUTO-APPROVE ON + FILTER FAILED: Goes to censored with reasons ---
    if (!passedAllFilters) {
      debug('[submit] Filter blocked submission:', allFilterReasons)
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

    // --- AUTO-APPROVE ON + ALL FILTERS PASSED: Auto-post to X ---
    debug('[submit] All filters passed, auto-posting submission', geminiChecked ? '(Gemini verified)' : '')

    // Check circuit breaker: if X is returning errors, reject the submission
    // outright so rate limits are not consumed. User can retry when it recovers.
    const circuitBreakerPaused = await isCircuitBreakerPaused(filterSettings.rateLimits)
    if (circuitBreakerPaused) {
      debug('[submit] Circuit breaker active, rejecting submission')
      return NextResponse.json({
        error: 'Sistem sedang sibuk',
        message: 'Auto-post sedang dijeda karena gangguan pada X. Coba lagi dalam beberapa menit.',
      }, { status: 400 })
    }

    // Check auto-post cooldown: has this account posted a tweet recently?
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
          debug('[submit] Auto-post cooldown active, queuing instead')
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
            error: 'Pesanmu sudah masuk antrean dan akan diposting oleh admin setelahnya.',
          }, { status: 201 })
        }
      }
    }

    // Check auto-post window cap: too many posts in the time window?
    if (filterSettings.rateLimits.autoPostWindowCap > 0 && filterSettings.rateLimits.autoPostWindowMinutes > 0) {
      const windowStart = new Date(Date.now() - filterSettings.rateLimits.autoPostWindowMinutes * 60 * 1000)
      const windowPostCount = await db.submission.count({
        where: {
          status: 'posted',
          updatedAt: { gte: windowStart },
        },
      })
      if (windowPostCount >= filterSettings.rateLimits.autoPostWindowCap) {
        debug('[submit] Auto-post window cap reached:', windowPostCount, 'in last', filterSettings.rateLimits.autoPostWindowMinutes, 'min, queuing instead')
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
          error: 'Pesanmu sudah masuk antrean dan akan diposting oleh admin setelahnya.',
        }, { status: 201 })
      }
    }

    // Check per-user post daily cap: has this user already had too many posts today?
    // Whitelisted users bypass this limit
    // Uses createdAt (submission time) with calendar day WIB boundary for consistency
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
        debug('[submit] User post daily cap reached:', userPostCount, 'for user', submitter.username, 'queuing instead')
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

    // Acquire distributed lock — only one post to X at a time
    lockValue = await acquirePostingLock()
    if (!lockValue) {
      debug('[submit] Posting lock busy, queuing submission')
      return NextResponse.json({
        submission,
        autoPosted: false,
        queued: true,
        error: 'Pesanmu sudah masuk antrean dan akan diposting oleh admin setelahnya.',
      }, { status: 201 })
    }

    // Re-check cooldown and window cap under lock (authoritative — no race).
    // The early checks above are fast-path optimizations that may be stale
    // if another process posted between the check and lock acquisition.
    // Under the lock, no other process can change the "posted" count.

    // Re-check auto-post cooldown (authoritative under lock)
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
          debug('[submit] Auto-post cooldown active (confirmed under lock), queuing instead')
          await releasePostingLock(lockValue)
          lockValue = null
          return NextResponse.json({
            submission,
            autoPosted: false,
            queued: true,
            error: 'Pesanmu sudah masuk antrean dan akan diposting oleh admin setelahnya.',
          }, { status: 201 })
        }
      }
    }

    // Re-check auto-post window cap (authoritative under lock)
    if (filterSettings.rateLimits.autoPostWindowCap > 0 && filterSettings.rateLimits.autoPostWindowMinutes > 0) {
      const windowStart = new Date(Date.now() - filterSettings.rateLimits.autoPostWindowMinutes * 60 * 1000)
      const windowPostCount = await db.submission.count({
        where: {
          status: 'posted',
          updatedAt: { gte: windowStart },
        },
      })
      if (windowPostCount >= filterSettings.rateLimits.autoPostWindowCap) {
        debug('[submit] Auto-post window cap reached (confirmed under lock):', windowPostCount, 'queuing instead')
        await releasePostingLock(lockValue)
        lockValue = null
        return NextResponse.json({
          submission,
          autoPosted: false,
          queued: true,
          error: 'Pesanmu sudah masuk antrean dan akan diposting oleh admin setelahnya.',
        }, { status: 201 })
      }
    }

    // Mark as "posting" before calling X API — prevents double-post race condition.
    // If another process checks this submission's status while we're mid-post,
    // it will see "posting" instead of "pending" and won't attempt a duplicate post.
    const marked = await db.submission.updateMany({
      where: { id: submission.id, status: 'pending' },
      data: { status: 'posting' },
    })
    if (marked.count === 0) {
      // Status was changed by another process (e.g. admin rejected it) — abort
      // Return 409 Conflict so the client knows to refresh and check submission history
      debug('[submit] Submission status changed before posting, aborting')
      await releasePostingLock(lockValue)
      return NextResponse.json({
        submission,
        autoPosted: false,
        error: 'Status pesan berubah sebelum diproses. Cek riwayat submission-mu.',
      }, { status: 409 })
    }

    // Attempt to post to X
    try {
      const tweetResult = await postTweetViaCookie(decodeHtmlEntities(trimmedMessage))

      if (tweetResult.success) {
        debug('[submit] Auto-post succeeded! tweetId:', tweetResult.tweetId, 'method:', tweetResult.method)
        // Only update if still "posting" — don't overwrite admin rejection/deletion
        const result = await db.submission.updateMany({
          where: { id: submission.id, status: 'posting' },
          data: {
            status: 'posted',
            tweetId: tweetResult.tweetId || null,
            postMethod: tweetResult.method,
            postError: null,
          },
        })

        // Reset circuit breaker on success
        await recordPostSuccess()

        if (result.count === 0) {
          debug('[submit] Auto-post succeeded but submission status was changed by admin — not overwriting')
          return NextResponse.json({
            autoPosted: true,
            tweetId: tweetResult.tweetId,
            postMethod: tweetResult.method,
            warning: 'Tweet posted, but admin changed submission status before post completed.',
          }, { status: 201 })
        }

        const updated = await db.submission.findUnique({ where: { id: submission.id } })

        return NextResponse.json({
          submission: updated,
          autoPosted: true,
          tweetId: tweetResult.tweetId,
          postMethod: tweetResult.method,
        }, { status: 201 })
      } else {
        // Post failed — mark as post_failed so admin can see the error and retry
        // Only update if still "posting" — don't overwrite admin rejection/deletion
        const errorMsg = tweetResult.error || 'Unknown error'
        debug('[submit] Auto-post failed, marking as post_failed:', errorMsg)
        await db.submission.updateMany({
          where: { id: submission.id, status: 'posting' },
          data: { status: 'post_failed', postError: errorMsg },
        })
        const failedSubmission = await db.submission.findUnique({ where: { id: submission.id } })

        // Record failure for circuit breaker
        try { await recordPostFailure(filterSettings.rateLimits) } catch { /* best effort */ }

        return NextResponse.json({
          submission: failedSubmission,
          autoPosted: false,
          postFailed: true,
          error: 'Gagal auto-post. Pesanmu masuk antrean untuk review admin.',
        }, { status: 201 })
      }
    } catch (postError) {
      // Post threw exception — mark as post_failed so admin can see the error and retry
      // Only update if still "posting" — don't overwrite admin rejection/deletion
      const errorMsg = postError instanceof Error ? postError.message : String(postError)
      debug('[submit] Auto-post exception, marking as post_failed:', errorMsg)
      await db.submission.updateMany({
        where: { id: submission.id, status: 'posting' },
        data: { status: 'post_failed', postError: errorMsg },
      })
      const failedSubmission = await db.submission.findUnique({ where: { id: submission.id } })

      // Record failure for circuit breaker
      try { await recordPostFailure(filterSettings.rateLimits) } catch { /* best effort */ }

      return NextResponse.json({
        submission: failedSubmission,
        autoPosted: false,
        postFailed: true,
        error: 'Gagal auto-post. Pesanmu masuk antrean untuk review admin.',
      }, { status: 201 })
    } finally {
      await releasePostingLock(lockValue!)
      lockValue = null // Mark as released so outer catch doesn't double-release
    }
  } catch (e) {
    // Release lock if it was acquired but not yet released by inner finally
    // (e.g. updateMany threw between lock acquisition and inner try/finally)
    if (lockValue) {
      await releasePostingLock(lockValue).catch(() => {})
    }
    console.error('[submit] Unexpected error:', e)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
