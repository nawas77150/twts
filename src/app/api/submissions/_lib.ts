import { db } from '@/lib/db'
import { getSubmitterFromNextRequest } from '@/lib/twitter-auth'
import { getStartOfTodayWIB } from '@/lib/constants'
import { debug } from '@/lib/debug'
import { runContentFilter, checkDuplicate24h, normalizeText, sanitizeInput, hasAlwaysOnReason, getRejectionMessage } from '@/lib/content-filter'
import { runGeminiFilter } from '@/lib/gemini-filter'
import { getFilterSettings } from '@/lib/filter-settings'
import { getEffectiveLimit } from '@/lib/limit-resolver'
import { NextRequest, NextResponse } from 'next/server'

// Determine censored reason from filter reasons
export function getCensoredReason(reasons: string[]): 'ai' | 'filter' | 'both' {
  const hasAi = reasons.some(r => r.startsWith('ai:'))
  const hasFilter = reasons.some(r => !r.startsWith('ai:'))
  if (hasAi && hasFilter) return 'both'
  return hasAi ? 'ai' : 'filter'
}

// Log a rate limit hit (fire-and-forget, never blocks the response)
export function logLimitHit(username: string, limitType: string) {
  db.limitHit.create({ data: { username, limitType } }).catch(() => {
    // Swallow — logging must never break the submission flow
  })
}

// --- Submission Pipeline Types ---

export interface ValidatedInput {
  submitter: NonNullable<Awaited<ReturnType<typeof getSubmitterFromNextRequest>>>
  trimmedMessage: string
  sanitizedCategory: string | null
}

export interface RateLimitContext {
  isWhitelisted: boolean
  effectivePostCap: number
}

export interface FilterPipelineResult {
  allFilterReasons: string[]
  passedAllFilters: boolean
  hasCensorReasons: boolean
  submissionStatus: 'pending' | 'censored'
  filterReasonsJson: string | null
  geminiError: boolean
}

// --- Submission Pipeline Helpers ---

export async function validateSubmission(req: NextRequest): Promise<ValidatedInput | NextResponse> {
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

  return { submitter, trimmedMessage, sanitizedCategory }
}

export async function checkSubmissionRateLimits(
  submitter: { id: string; username: string; customLimits: unknown },
  filterSettings: Awaited<ReturnType<typeof getFilterSettings>>,
): Promise<RateLimitContext | NextResponse> {
  // Check if user is blocked (cannot submit at all)
  const isBlocked = filterSettings.blockedUsernames.includes(submitter.username.toLowerCase())

  if (isBlocked) {
    debug('[submit] User is blocked:', submitter.username)
    return NextResponse.json({
      error: 'Akun diblokir',
      message: 'Akun kamu tidak diperbolehkan mengirim pesan.',
    }, { status: 403 })
  }

  // Check if this user is whitelisted (bypasses rate limits)
  const isWhitelisted = filterSettings.whitelistUsernames.includes(submitter.username.toLowerCase())

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

  return { isWhitelisted, effectivePostCap }
}

export async function runFilterPipeline(
  trimmedMessage: string,
  filterSettings: Awaited<ReturnType<typeof getFilterSettings>>,
  submitterId: string,
): Promise<NextResponse | FilterPipelineResult> {
  // --- Step 1: Rule-based content filter ---
  const filterResult = runContentFilter(
    trimmedMessage,
    filterSettings.blockedWords,
    filterSettings.filterRules,
    filterSettings.nsfwWords,
  )

  // Check for duplicates (24h) if rule is enabled
  if (filterSettings.filterRules.duplicate24h) {
    const dupCheck = await checkDuplicate24h(trimmedMessage, db, submitterId)
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
  let geminiPassed = true
  let geminiError = false // Track if Gemini errored (for informational filterReasons)

  if (filterResult.passed && filterSettings.geminiEnabled && filterSettings.geminiApiKeySet) {
    try {
      const geminiApiKey = filterSettings.geminiApiKey  // Already loaded — no extra DB call
      if (geminiApiKey) {
        debug('[submit] Running Gemini AI filter')
        const geminiResult = await runGeminiFilter(trimmedMessage, geminiApiKey, filterSettings.geminiModel)

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

  return {
    allFilterReasons,
    passedAllFilters,
    hasCensorReasons,
    submissionStatus,
    filterReasonsJson,
    geminiError,
  }
}

export async function createQueuedSubmission(
  trimmedMessage: string,
  sanitizedCategory: string | null,
  submitterId: string,
): Promise<NextResponse> {
  const submission = await db.submission.create({
    data: {
      message: trimmedMessage,
      normalizedMessage: normalizeText(trimmedMessage),
      category: sanitizedCategory,
      submitterId,
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
