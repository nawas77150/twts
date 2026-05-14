import { db } from '@/lib/db'
import { getSubmitterFromNextRequest } from '@/lib/twitter-auth'
import { postTweetViaCookie } from '@/lib/twitter-post-cookie'
import { verifyAdmin } from '@/lib/admin-auth'
import { debug } from '@/lib/debug'
import { runContentFilter, checkDuplicate24h, hasAlwaysOnReason, getRejectionMessage, DEFAULT_BLOCKED_WORDS, DEFAULT_NSFW_WORDS, DEFAULT_FILTER_RULES, type FilterRules } from '@/lib/content-filter'
import { runGeminiFilter } from '@/lib/gemini-filter'
import { acquirePostingLock, releasePostingLock } from '@/lib/posting-lock'
import { isCircuitBreakerPaused, recordPostSuccess, recordPostFailure } from '@/lib/circuit-breaker'
import { getFilterSettings, getGeminiApiKey, DEFAULT_RATE_LIMITS, type RateLimitSettings } from '@/app/api/admin/filter-settings/route'
import { NextRequest, NextResponse } from 'next/server'

// Vercel serverless function timeout — auto-post + Gemini can take up to 15s with retries
export const maxDuration = 30

// GET /api/submissions - List submissions (admin only, includes submitter info)
// Supports pagination via ?page=1&limit=50 (defaults: page=1, limit=50)
export async function GET(req: NextRequest) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50))

  const where = status && status !== 'all' ? { status } : {}

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
    // Get submitter from session cookie (Twitter OAuth)
    const submitter = await getSubmitterFromNextRequest(req)

    if (!submitter) {
      return NextResponse.json({ error: 'Silakan login dengan akun X terlebih dahulu' }, { status: 401 })
    }

    const body = await req.json()
    const { message, category } = body

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Pesan wajib diisi' }, { status: 400 })
    }

    const trimmedMessage = message.trim()

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
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const globalCount = await db.submission.count({
        where: { createdAt: { gte: twentyFourHoursAgo } },
      })
      if (globalCount >= filterSettings.rateLimits.globalSubmissionDailyCap) {
        debug('[submit] Global daily cap reached:', globalCount)
        return NextResponse.json({
          error: 'Sistem sedang sibuk',
          message: 'Batas harian sistem tercapai. Coba lagi besok.',
        }, { status: 400 })
      }
    }

    // --- PER-USER RATE LIMITS (bypassed by whitelist) ---
    if (!isWhitelisted) {
      // Check per-user cooldown
      if (filterSettings.rateLimits.submissionCooldown > 0) {
        const lastSubmission = await db.submission.findFirst({
          where: { submitterId: submitter.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        })
        if (lastSubmission) {
          const elapsedMs = Date.now() - lastSubmission.createdAt.getTime()
          const cooldownMs = filterSettings.rateLimits.submissionCooldown * 60 * 1000
          if (elapsedMs < cooldownMs) {
            const waitMinutes = Math.ceil((cooldownMs - elapsedMs) / 60000)
            const waitSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000)
            const waitMsg = waitMinutes > 1 ? `${waitMinutes} menit` : `${waitSeconds} detik`
            debug('[submit] Cooldown: user must wait', waitMsg)
            return NextResponse.json({
              error: 'Tunggu sebentar',
              message: `Tunggu ${waitMsg} sebelum mengirim pesan lagi.`,
            }, { status: 400 })
          }
        }
      }

      // Check daily cap
      if (filterSettings.rateLimits.submissionDailyCap > 0) {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
        const todayCount = await db.submission.count({
          where: {
            submitterId: submitter.id,
            createdAt: { gte: twentyFourHoursAgo },
          },
        })
        if (todayCount >= filterSettings.rateLimits.submissionDailyCap) {
          debug('[submit] Daily cap reached:', todayCount)
          return NextResponse.json({
            error: 'Batas harian tercapai',
            message: `Kamu sudah mengirim ${todayCount} pesan hari ini (maksimal ${filterSettings.rateLimits.submissionDailyCap}). Coba lagi besok.`,
          }, { status: 400 })
        }
      }

      // Check per-user pending cap
      if (filterSettings.rateLimits.userPendingCap > 0) {
        const pendingCount = await db.submission.count({
          where: {
            submitterId: submitter.id,
            status: 'pending',
          },
        })
        if (pendingCount >= filterSettings.rateLimits.userPendingCap) {
          debug('[submit] User pending cap reached:', pendingCount, 'for user', submitter.username)
          return NextResponse.json({
            error: 'Terlalu banyak pesan menunggu',
            message: `Kamu sudah memiliki ${pendingCount} pesan dalam antrean. Tunggu sampai diproses admin sebelum mengirim lagi.`,
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
      const dupCheck = await checkDuplicate24h(trimmedMessage, submitter.id, db)
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

    if (filterResult.passed && filterSettings.geminiEnabled && filterSettings.geminiApiKeySet) {
      try {
        const geminiApiKey = await getGeminiApiKey()
        if (geminiApiKey) {
          debug('[submit] Running Gemini AI filter')
          const geminiResult = await runGeminiFilter(trimmedMessage, geminiApiKey)
          geminiChecked = geminiResult.checked

          if (!geminiResult.passed) {
            // Gemini flagged the submission (or error/timeout — sends to pending)
            geminiPassed = false
            const geminiReason = geminiResult.reason || 'Flagged by AI'
            allFilterReasons.push(`ai:${geminiReason}`)
            if (geminiResult.error) {
              debug('[submit] Gemini error (sending to pending):', geminiResult.error)
            } else {
              debug('[submit] Gemini flagged submission:', geminiReason)
            }
          } else {
            debug('[submit] Gemini passed submission')
          }
        }
      } catch (err) {
        // Gemini threw an exception — send to pending for manual review
        geminiPassed = false
        allFilterReasons.push('ai:gemini_error')
        debug('[submit] Gemini exception (sending to pending):', err)
      }
    }

    // Determine if submission passes all filters
    const passedAllFilters = filterResult.passed && geminiPassed

    // --- AUTO-APPROVE OFF: All submissions go to pending (original behavior) ---
    if (!filterSettings.autoApprove) {
      const submission = await db.submission.create({
        data: {
          message: trimmedMessage,
          category: category?.trim() || null,
          submitterId: submitter.id,
          filterReasons: allFilterReasons.length > 0 ? JSON.stringify(allFilterReasons) : null,
        },
      })

      return NextResponse.json({ submission }, { status: 201 })
    }

    // --- AUTO-APPROVE ON + FILTER FAILED: Goes to pending with reasons ---
    if (!passedAllFilters) {
      debug('[submit] Filter blocked submission:', allFilterReasons)
      const submission = await db.submission.create({
        data: {
          message: trimmedMessage,
          category: category?.trim() || null,
          submitterId: submitter.id,
          filterReasons: allFilterReasons.length > 0 ? JSON.stringify(allFilterReasons) : null,
        },
      })

      return NextResponse.json({
        submission,
        filtered: true,
        filterReasons: allFilterReasons,
      }, { status: 201 })
    }

    // --- AUTO-APPROVE ON + ALL FILTERS PASSED: Auto-post to X ---
    debug('[submit] All filters passed, auto-posting submission', geminiChecked ? '(Gemini verified)' : '')

    // Check circuit breaker: if X is returning errors, pause auto-post
    const circuitBreakerPaused = await isCircuitBreakerPaused(filterSettings.rateLimits)
    if (circuitBreakerPaused) {
      debug('[submit] Circuit breaker active, queuing instead of auto-posting')
      const submission = await db.submission.create({
        data: {
          message: trimmedMessage,
          category: category?.trim() || null,
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
              category: category?.trim() || null,
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
            category: category?.trim() || null,
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
    if (!isWhitelisted && filterSettings.rateLimits.userPostDailyCap > 0) {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const userPostCount = await db.submission.count({
        where: {
          submitterId: submitter.id,
          status: 'posted',
          updatedAt: { gte: twentyFourHoursAgo },
        },
      })
      if (userPostCount >= filterSettings.rateLimits.userPostDailyCap) {
        debug('[submit] User post daily cap reached:', userPostCount, 'for user', submitter.username, 'queuing instead')
        const submission = await db.submission.create({
          data: {
            message: trimmedMessage,
            category: category?.trim() || null,
            submitterId: submitter.id,
            filterReasons: null,
          },
        })
        return NextResponse.json({
          submission,
          autoPosted: false,
          queued: true,
          postCapped: true,
          error: `Batas post harian kamu tercapai (${userPostCount}/${filterSettings.rateLimits.userPostDailyCap}). Pesan masuk antrean dan akan diposting oleh admin setelahnya.`,
        }, { status: 201 })
      }
    }

    // Create as pending first, then attempt to post
    const submission = await db.submission.create({
      data: {
        message: trimmedMessage,
        category: category?.trim() || null,
        submitterId: submitter.id,
        filterReasons: null,
      },
    })

    // Acquire distributed lock — only one post to X at a time
    const lockValue = await acquirePostingLock()
    if (!lockValue) {
      debug('[submit] Posting lock busy, queuing submission')
      return NextResponse.json({
        submission,
        autoPosted: false,
        queued: true,
        error: 'Pesanmu sudah masuk antrean dan akan diposting oleh admin setelahnya.',
      }, { status: 201 })
    }

    // Attempt to post to X
    try {
      const tweetResult = await postTweetViaCookie(trimmedMessage)

      if (tweetResult.success) {
        debug('[submit] Auto-post succeeded! tweetId:', tweetResult.tweetId, 'method:', tweetResult.method)
        const updated = await db.submission.update({
          where: { id: submission.id },
          data: {
            status: 'posted',
            tweetId: tweetResult.tweetId || null,
            postMethod: tweetResult.method,
          },
        })

        // Reset circuit breaker on success
        await recordPostSuccess()

        return NextResponse.json({
          submission: updated,
          autoPosted: true,
          tweetId: tweetResult.tweetId,
          postMethod: tweetResult.method,
        }, { status: 201 })
      } else {
        // Post failed — mark as post_failed so admin can see the error and retry
        const errorMsg = tweetResult.error || 'Unknown error'
        debug('[submit] Auto-post failed, marking as post_failed:', errorMsg)
        await db.submission.update({
          where: { id: submission.id },
          data: { status: 'post_failed', postError: errorMsg },
        })

        // Record failure for circuit breaker
        await recordPostFailure(filterSettings.rateLimits)

        return NextResponse.json({
          autoPosted: false,
          queued: true,
          error: 'Pesanmu sudah masuk antrean dan akan diposting oleh admin setelahnya.',
        }, { status: 201 })
      }
    } catch (postError) {
      // Post threw exception — mark as post_failed so admin can see the error and retry
      const errorMsg = postError instanceof Error ? postError.message : String(postError)
      debug('[submit] Auto-post exception, marking as post_failed:', errorMsg)
      await db.submission.update({
        where: { id: submission.id },
        data: { status: 'post_failed', postError: errorMsg },
      })

      // Record failure for circuit breaker
      await recordPostFailure(filterSettings.rateLimits)

      return NextResponse.json({
        autoPosted: false,
        queued: true,
        error: 'Pesanmu sudah masuk antrean dan akan diposting oleh admin setelahnya.',
      }, { status: 201 })
    } finally {
      await releasePostingLock(lockValue)
    }
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
