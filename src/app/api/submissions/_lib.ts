// ============================================================
// Submission pipeline helpers
//
// validateSubmission  — auth + input validation
// runFilterPipeline  — rule-based + Gemini AI filtering
// createQueuedSubmission — queue a submission for admin review
// getCensoredReason  — classify censor reason (ai/filter/both)
//
// Rate limit checks moved to _rate-limits.ts
// Gemini submission check moved to lib/gemini-filter.ts
// ============================================================

import { db } from '@/lib/db'
import { getSubmitterFromNextRequest } from '@/lib/twitter-auth'
import { debug } from '@/lib/debug'
import { runContentFilter, checkDuplicate24h, normalizeText, sanitizeInput, hasAlwaysOnReason, getRejectionMessage } from '@/lib/content-filter'
import { runGeminiSubmissionCheck } from '@/lib/gemini-filter'
import { getFilterSettings } from '@/lib/filter-settings'
import { getEffectiveMaxLength } from '@/lib/append-hashtags'
import { type NextRequest, NextResponse } from 'next/server'

// Determine censored reason from filter reasons
export function getCensoredReason(reasons: string[]): 'ai' | 'filter' | 'both' {
  const hasAi = reasons.some(r => r.startsWith('ai:'))
  const hasFilter = reasons.some(r => !r.startsWith('ai:'))
  if (hasAi && hasFilter) return 'both'
  return hasAi ? 'ai' : 'filter'
}

// --- Submission Pipeline Types ---

export interface ValidatedInput {
  submitter: NonNullable<Awaited<ReturnType<typeof getSubmitterFromNextRequest>>>
  trimmedMessage: string
  sanitizedCategory: string | null
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
  if (submitter.username.startsWith('anon_')) {
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

  let postHashtags = ''
  try {
    postHashtags = (await getFilterSettings()).postHashtags
  } catch {
    // If settings can't be loaded, use default (no hashtags → 280 limit)
  }
  const effectiveMax = getEffectiveMaxLength(postHashtags)

  if (trimmedMessage.length > effectiveMax) {
    const hashtagNote = postHashtags ? ` (${postHashtags.length + 1} karakter untuk ${postHashtags})` : ''
    return NextResponse.json(
      { error: `Pesan terlalu panjang (${trimmedMessage.length}/${effectiveMax} karakter${hashtagNote})` },
      { status: 400 }
    )
  }

  return { submitter, trimmedMessage, sanitizedCategory }
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
    debug('submit', 'Rejected (always-on rule):', filterResult.reasons)
    return NextResponse.json({
      error: 'Pesan ditolak',
      message: rejectionMsg,
      reasons: filterResult.reasons,
    }, { status: 400 })
  }

  // Collect all filter reasons (from both rule-based and Gemini)
  const allFilterReasons: string[] = filterResult.passed ? [] : [...filterResult.reasons]

  // --- Step 2: Gemini AI filter (optional, only if rule-based passed) ---
  const { geminiPassed, geminiError } = await runGeminiSubmissionCheck(
    trimmedMessage,
    filterResult.passed,
    filterSettings,
    allFilterReasons,
  )

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
