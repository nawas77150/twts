import { db } from '@/lib/db'
import { postTweetViaCookie } from '@/lib/twitter-post-cookie'
import { verifyAdmin, getAdminTokenFromRequest } from '@/lib/admin-auth'
import { debug } from '@/lib/debug'
import { decodeHtmlEntities } from '@/lib/content-filter'
import { acquirePostingLock, releasePostingLock } from '@/lib/posting-lock'
import { recordPostSuccess, recordPostFailure } from '@/lib/circuit-breaker'
import { getFilterSettings } from '@/lib/filter-settings'
import { checkStalePosting } from '@/lib/stale-posting'
import { NextRequest, NextResponse } from 'next/server'

// Vercel serverless function timeout — retry loop can take up to 15s
export const maxDuration = 30

// POST /api/submissions/[id]/post - Post submission to X (manual retry)
// Uses the full retry + fallback flow from postTweetViaCookie
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = verifyAdmin(getAdminTokenFromRequest(req))
  if (!auth.authorized) return auth.response

  // Declare lockValue outside try so outer catch can release it on error
  // (e.g. if updateMany throws between lock acquisition and inner try/finally)
  let lockValue: string | null = null

  try {
    const { id } = await params

    let submission = await db.submission.findUnique({ where: { id } })
    if (!submission) {
      return NextResponse.json({ error: 'Submission tidak ditemukan' }, { status: 404 })
    }

    if (submission.status === 'posted') {
      return NextResponse.json({ error: 'Submission sudah diposting' }, { status: 400 })
    }

    if (submission.status === 'posting') {
      const stale = await checkStalePosting(submission)
      if (!stale.isStale) {
        return NextResponse.json(
          { error: 'Submission sedang diproses (posting ke X). Coba lagi dalam beberapa menit.' },
          { status: 409 }
        )
      }
      // Stale posting auto-recovered — re-fetch with updated status and fall through.
      // The submission is now post_failed, so the pending/post_failed check will pass.
      const refreshed = await db.submission.findUnique({ where: { id } })
      if (!refreshed) {
        return NextResponse.json({ error: 'Submission tidak ditemukan' }, { status: 404 })
      }
      submission = refreshed
    }

    if (submission.status === 'rejected') {
      return NextResponse.json({ error: 'Submission sudah ditolak' }, { status: 400 })
    }

    // Only pending, censored, and post_failed statuses can be retried
    if (submission.status !== 'pending' && submission.status !== 'post_failed' && submission.status !== 'censored') {
      return NextResponse.json({ error: `Status tidak valid untuk retry: ${submission.status}` }, { status: 400 })
    }

    // Acquire distributed lock — only one post to X at a time
    lockValue = await acquirePostingLock()
    if (!lockValue) {
      debug('[post route] Posting lock busy')
      return NextResponse.json(
        { error: 'Sedang ada posting lain yang berjalan. Coba lagi dalam beberapa detik.' },
        { status: 409 }
      )
    }

    // Mark as "posting" before calling X API — prevents double-post race condition
    const marked = await db.submission.updateMany({
      where: { id, status: { in: ['pending', 'post_failed', 'censored'] } },
      data: { status: 'posting' },
    })
    if (marked.count === 0) {
      debug('[post route] Submission status changed before posting, aborting')
      await releasePostingLock(lockValue)
      return NextResponse.json(
        { error: 'Submission sedang diproses oleh proses lain.' },
        { status: 409 }
      )
    }

    // Post to X using cookie-based auth (with retry + fallback)
    try {
      debug('[post route] Posting submission:', id, 'message length:', submission.message.length)
      const tweetResult = await postTweetViaCookie(decodeHtmlEntities(submission.message))

      if (!tweetResult.success) {
        debug('[post route] Post failed:', tweetResult.error, 'method:', tweetResult.method)
        console.error('X API error:', tweetResult.error)

        // Persist the latest error — only update if still "posting"
        await db.submission.updateMany({
          where: { id, status: 'posting' },
          data: { status: 'post_failed', postError: tweetResult.error || 'Unknown error' },
        })

        // Record failure for circuit breaker
        try {
          const settings = await getFilterSettings()
          await recordPostFailure(settings.rateLimits)
        } catch { /* best effort */ }

        return NextResponse.json(
          { error: `Gagal posting ke X: ${tweetResult.error}`, postMethod: tweetResult.method },
          { status: 502 }
        )
      }

      debug('[post route] Post succeeded! tweetId:', tweetResult.tweetId, 'method:', tweetResult.method, 'retries:', tweetResult.retriesUsed)
      // Update submission status — only if still "posting" (prevents double-write)
      const result = await db.submission.updateMany({
        where: { id, status: 'posting' },
        data: {
          status: 'posted',
          tweetId: tweetResult.tweetId || null,
          postMethod: tweetResult.method,
          postError: null, // Clear error since post succeeded
        },
      })

      // Reset circuit breaker on success
      await recordPostSuccess()

      if (result.count === 0) {
        debug('[post route] Post succeeded but status was changed by another process')
        return NextResponse.json({
          autoPosted: true,
          tweetId: tweetResult.tweetId,
          postMethod: tweetResult.method,
          warning: 'Tweet posted, but submission status was changed by another process.',
        })
      }

      const updated = await db.submission.findUnique({ where: { id } })

      return NextResponse.json({
        submission: updated,
        tweetId: tweetResult.tweetId,
        postMethod: tweetResult.method,
        retriesUsed: tweetResult.retriesUsed,
      })
    } catch (postError) {
      // postTweetViaCookie threw — mark as post_failed
      const errorMsg = postError instanceof Error ? postError.message : String(postError)
      debug('[post route] Post exception, marking as post_failed:', errorMsg)
      await db.submission.updateMany({
        where: { id, status: 'posting' },
        data: { status: 'post_failed', postError: errorMsg },
      })
      try {
        const settings = await getFilterSettings()
        await recordPostFailure(settings.rateLimits)
      } catch { /* best effort */ }
      return NextResponse.json(
        { error: `Gagal posting ke X: ${errorMsg}` },
        { status: 502 }
      )
    } finally {
      await releasePostingLock(lockValue!)
      lockValue = null // Mark as released so outer catch doesn't double-release
    }
  } catch (error) {
    // Release lock if it was acquired but not yet released by inner finally
    // (e.g. updateMany threw between lock acquisition and inner try/finally)
    if (lockValue) {
      await releasePostingLock(lockValue).catch(() => {})
    }
    console.error('Post to X error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
