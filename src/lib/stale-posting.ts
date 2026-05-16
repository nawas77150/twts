// ============================================================
// stale-posting.ts — Auto-recovery for stuck "posting" status
// ============================================================
// When a Vercel serverless function is killed by the timeout (30s)
// during a post to X, the submission is left in "posting" status
// with no cleanup. Every admin action (approve, retry, delete)
// blocks on "posting" status, creating a three-way deadlock.
//
// This utility detects stale "posting" status and auto-recovers
// the submission to "post_failed" so the admin can retry or delete.
//
// Threshold: 2 minutes (4x function timeout, 2x posting lock expiry).
// No legitimate posting can take longer than the 30s function timeout,
// so 2 minutes guarantees the posting process is dead.
// ============================================================

import { db } from '@/lib/db'
import { debug } from '@/lib/debug'

/** Time after which a "posting" status is guaranteed stale.
 *  Safety margins: 4x function timeout (30s), 2x posting lock (60s). */
export const POSTING_STALE_MS = 2 * 60 * 1000 // 2 minutes

export interface StaleCheckResult {
  /** Whether the "posting" status is stale (process likely crashed) */
  isStale: boolean
  /** How long the submission has been in "posting" status (ms) */
  timeInPostingMs: number
  /** Whether this call performed the auto-recovery */
  recovered: boolean
}

/**
 * Check if a submission in "posting" status is stale (the posting process
 * has likely crashed). If stale, auto-recovers to "post_failed" with a
 * warning about possible ghost tweet.
 *
 * IMPORTANT: Does NOT call recordPostFailure() because we don't know
 * if the post actually failed — it may have succeeded (ghost tweet).
 * Recording a failure would incorrectly penalize the circuit breaker.
 *
 * @param submission - The submission object (must have id, status, updatedAt)
 * @returns StaleCheckResult indicating whether the status was stale/recovered
 */
export async function checkStalePosting(
  submission: { id: string; status: string; updatedAt: Date }
): Promise<StaleCheckResult> {
  if (submission.status !== 'posting') {
    return { isStale: false, timeInPostingMs: 0, recovered: false }
  }

  const timeInPostingMs = Date.now() - new Date(submission.updatedAt).getTime()

  if (timeInPostingMs < POSTING_STALE_MS) {
    return { isStale: false, timeInPostingMs, recovered: false }
  }

  // Stale — auto-recover to post_failed so admin can retry or delete.
  // WARNING: The tweet may have been posted to X before the crash.
  // The admin should check the X account before retrying.
  const minutes = Math.round(timeInPostingMs / 60000)
  debug('[stale-posting] Auto-recovering stuck posting, stuck for', minutes, 'minutes, id:', submission.id)

  await db.submission.update({
    where: { id: submission.id },
    data: {
      status: 'post_failed',
      postError: `[Auto-recovered] Posting status stuck for ${minutes} menit. Possible server crash. Check X account before retrying — tweet may have been posted.`,
    },
  })

  return { isStale: true, timeInPostingMs, recovered: true }
}
