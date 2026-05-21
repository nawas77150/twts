// ============================================================
// Shared helpers for PATCH/POST /api/submissions/[id]
//
// Extracts duplicated validation + post-result-mapping logic
// from route.ts and post/route.ts to eliminate 6 clones
// (87 duplicated lines) and reduce per-file complexity.
// ============================================================

import { db } from '@/lib/db'
import { executePostAndRecord, type ExecutePostResult } from '@/lib/execute-post'
import { getFilterSettings } from '@/lib/filter-settings'
import { checkStalePosting } from '@/lib/stale-posting'
import { debug } from '@/lib/debug'
import type { Submission } from '@prisma/client'
import { NextResponse } from 'next/server'

// --- Helper 0: Fetch submission or 404 ---

/**
 * Fetch a submission by ID, returning 404 if not found.
 * Shared by fetchSubmissionForPosting (PATCH/POST) and DELETE.
 */
export async function findSubmissionOr404(
  id: string,
): Promise<{ submission: Submission } | NextResponse> {
  const submission = await db.submission.findUnique({ where: { id } })
  if (!submission) {
    return NextResponse.json({ error: 'Submission tidak ditemukan' }, { status: 404 })
  }
  return { submission }
}

// --- Helper 1: Submission status validation ---

/**
 * Fetch a submission and validate it's in a postable status.
 * Shared by PATCH (approve) and POST (manual retry).
 *
 * Validation order: findUnique → 404, posted → 400,
 * posting → stale check → 409 or re-fetch, rejected → 400,
 * invalid status → 400.
 *
 * @param id - Submission ID from the URL params
 * @param invalidStatusLabel - Error label for invalid status
 *   ('Status tidak valid' for approve, 'Status tidak valid untuk retry' for post)
 * @returns The validated submission, or a NextResponse error
 */
export async function fetchSubmissionForPosting(
  id: string,
  invalidStatusLabel: string,
): Promise<{ submission: Submission } | NextResponse> {
  const found = await findSubmissionOr404(id)
  if (found instanceof NextResponse) return found
  let { submission } = found

  if (submission.status === 'posted') {
    return NextResponse.json(
      { error: 'Submission sudah diposting' },
      { status: 400 },
    )
  }

  if (submission.status === 'posting') {
    const stale = await checkStalePosting(submission)
    if (!stale.isStale) {
      return NextResponse.json(
        { error: 'Submission sedang diproses (posting ke X). Coba lagi dalam beberapa menit.' },
        { status: 409 },
      )
    }
    // Stale posting auto-recovered — re-fetch with updated status and fall through.
    const refreshed = await findSubmissionOr404(id)
    if (refreshed instanceof NextResponse) return refreshed
    submission = refreshed.submission
  }

  if (submission.status === 'rejected') {
    return NextResponse.json(
      { error: 'Submission sudah ditolak' },
      { status: 400 },
    )
  }

  if (submission.status !== 'pending' && submission.status !== 'post_failed' && submission.status !== 'censored') {
    return NextResponse.json(
      { error: `${invalidStatusLabel}: ${submission.status}` },
      { status: 400 },
    )
  }

  return { submission }
}

// --- Helper 2: Post result early returns ---

/**
 * Handle the three early-return conditions from executePostAndRecord:
 * lockBusy, globalPostDailyCapReached, casAborted.
 *
 * Both route.ts and post/route.ts have identical response shapes
 * for these three conditions — only the debug log prefix differs.
 *
 * @returns A NextResponse error, or null if no early return needed
 */
export function handlePostEarlyReturns(
  postResult: ExecutePostResult,
  logLabel: string,
): NextResponse | null {
  if (postResult.lockBusy) {
    debug(logLabel, 'Posting lock busy')
    return NextResponse.json(
      { error: 'Sedang ada posting lain yang berjalan. Coba lagi dalam beberapa detik.' },
      { status: 409 },
    )
  }
  if (postResult.underLockAbortReason === 'global_post_daily_cap_reached') {
    debug(logLabel, 'Global post daily cap reached:', postResult.error)
    return NextResponse.json(
      { error: `Batas post harian global tercapai (${postResult.error}). Naikkan batas di Rate Limit settings.` },
      { status: 400 },
    )
  }
  if (postResult.casAborted) {
    debug(logLabel, 'Submission status changed before posting, aborting')
    return NextResponse.json(
      { error: 'Submission sedang diproses oleh proses lain.' },
      { status: 409 },
    )
  }
  return null
}

// --- Helper 3: Execute post with settings + early returns ---

/**
 * Execute posting for a submission: load filter settings, run executePostAndRecord,
 * and handle early-return conditions (lockBusy, dailyCap, casAborted).
 * Shared by PATCH (approve) and POST (manual retry).
 *
 * @param id - Submission ID
 * @param message - Decoded submission message
 * @param logLabel - Debug label ('approve' or 'retry')
 * @returns ExecutePostResult on success, or NextResponse for early-return conditions
 */
export async function executePostForSubmission(
  id: string,
  message: string,
  logLabel: string,
): Promise<{ postResult: ExecutePostResult } | NextResponse> {
  const filterSettings = await getFilterSettings()

  const postResult = await executePostAndRecord({
    submissionId: id,
    message,
    rateLimits: filterSettings.rateLimits,
    casStatuses: ['pending', 'post_failed', 'censored'],
  })

  const earlyReturn = handlePostEarlyReturns(postResult, logLabel)
  if (earlyReturn) return earlyReturn

  return { postResult }
}

// --- Helper 4: Post-success warning check + fetch updated submission ---

/**
 * Check for post-result warning (early return) or fetch the updated submission.
 * Shared by PATCH (approve) and POST (manual retry) success paths.
 *
 * @returns NextResponse if warning needs to be returned, otherwise the updated submission
 */
export async function getUpdatedSubmissionOrWarning(
  id: string,
  postResult: ExecutePostResult,
): Promise<{ updated: Submission | null } | NextResponse> {
  if (postResult.warning) {
    return buildPostWarningResponse(postResult)
  }
  const updated = await db.submission.findUnique({ where: { id } })
  return { updated }
}

// --- Helper 5: Warning response builder ---

/**
 * Build the warning response when post succeeds but with a warning.
 * Identical shape for both approve and retry routes.
 */
export function buildPostWarningResponse(postResult: ExecutePostResult): NextResponse {
  return NextResponse.json({
    autoPosted: true,
    tweetId: postResult.tweetId,
    postMethod: postResult.method,
    warning: postResult.warning,
  })
}

// --- Helper 5: Error hint lookup ---

const HINT_PATTERNS: Array<{ patterns: string[]; hint: string }> = [
  { patterns: ['code: 344', 'daily limit'], hint: 'Batas harian tweet tercapai. Coba lagi besok.' },
  { patterns: ['code: 32', 'Could not authenticate'], hint: 'Cookie expired. Perbarui cookie di X Settings lalu klik "Post to X".' },
  { patterns: ['code: 88', 'Rate limit'], hint: 'Rate limit tercapai. Tunggu beberapa menit lalu coba lagi.' },
  { patterns: ['226', 'automated'], hint: 'X mendeteksi otomatisasi (226). Semua retry gagal. Coba lagi dalam 1-2 menit.' },
  { patterns: ['Empty tweet_results', 'silently rejected'], hint: 'Tweet ditolak X (empty results). Semua retry gagal. Coba lagi dalam 1-2 menit.' },
  { patterns: ['Fallback API', 'fallback'], hint: 'Direct post gagal, fallback API juga gagal. Periksa API keys dan cookie.' },
]

/**
 * Get a context-aware hint for a post-to-X failure error message.
 * Used only by the approve (PATCH) route, which provides richer
 * error feedback than the manual retry (POST) route.
 */
export function getPostErrorHint(errorMsg: string): string {
  const match = HINT_PATTERNS.find(({ patterns }) =>
    patterns.some(p => errorMsg.includes(p)),
  )
  return match?.hint ?? 'Cek X Settings lalu klik "Post to X" untuk retry.'
}

// --- Helper 4: Method description ---

// Map (not Record) avoids the "Generic Object Injection Sink" SAST warning:
// plain objects have a prototype chain (__proto__, constructor) that SAST
// flags on dynamic-key access. Map.get() has no prototype chain.
const METHOD_LABELS = new Map<string, string>([
  ['direct', 'Pesan otomatis diposting ke X.'],
  ['fallback_cookie', 'Pesan diposting via Cookie API (twitterapi.io).'],
  ['fallback_login', 'Pesan diposting via V2 Login API (twitterapi.io).'],
])

/**
 * Build a human-readable description for the posting method used.
 * The 'retry' method includes the retry count; others are static labels.
 * Used only by the approve (PATCH) route.
 *
 * Callers should pass `postResult.method ?? ''` and `postResult.retriesUsed ?? 0`
 * so the ?? fallbacks happen at the call site (keeps this function's CC low).
 */
export function getMethodDescription(
  method: string,
  retriesUsed: number,
): string {
  if (method === 'retry') {
    return `Pesan diposting setelah retry (${retriesUsed}x).`
  }
  return METHOD_LABELS.get(method) ?? ''
}
