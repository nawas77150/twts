import { db } from '@/lib/db'
import { withErrorBoundary } from '@/lib/execute-post'
import { withAdmin } from '@/lib/admin-auth'
import { debug } from '@/lib/debug'
import { decodeHtmlEntities } from '@/lib/content-filter'
import { checkStalePosting } from '@/lib/stale-posting'
import { findSubmissionOr404, fetchSubmissionForPosting, executePostForSubmission, getUpdatedSubmissionOrWarning, getMethodDescription, getPostErrorHint } from './_lib'
import { NextResponse } from 'next/server'

// Vercel serverless function timeout — approve+post can take up to 15s with retries
export const maxDuration = 30

// PATCH /api/submissions/[id] - Approve (auto-post) or reject
export const PATCH = withAdmin<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  return withErrorBoundary(async () => {
    const { id } = await params
    const body = await req.json()
    const { status } = body

    if (!['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'Status tidak valid' }, { status: 400 })
    }

    const validationResult = await fetchSubmissionForPosting(id, 'Status tidak valid')
    if (validationResult instanceof NextResponse) return validationResult
    const { submission } = validationResult

    // If approving, auto-post to X via cookie auth (with retry + fallback)
    if (status === 'approved') {
      // Delegated: load settings → lock → CAS → post → record → release → handle early returns
      const postAttempt = await executePostForSubmission(id, decodeHtmlEntities(submission.message), 'approve')
      if (postAttempt instanceof NextResponse) return postAttempt
      const { postResult } = postAttempt

      if (postResult.success) {
        debug('approve', 'Post succeeded! tweetId:', postResult.tweetId, 'method:', postResult.method)

        const description = getMethodDescription(postResult.method ?? '', postResult.retriesUsed ?? 0)

        const result = await getUpdatedSubmissionOrWarning(id, postResult)
        if (result instanceof NextResponse) return result

        return NextResponse.json({
          submission: result.updated,
          autoPosted: true,
          tweetId: postResult.tweetId,
          postMethod: postResult.method,
          description,
        })
      } else {
        debug('approve', 'Post failed:', postResult.error, 'method:', postResult.method)
        const errorMsg = postResult.error || ''
        const hint = getPostErrorHint(errorMsg)

        const updated = await db.submission.findUnique({ where: { id } })
        return NextResponse.json({
          submission: updated,
          autoPosted: false,
          error: `Disetujui, tapi gagal posting ke X: ${errorMsg}. ${hint}`,
          postMethod: postResult.method,
        })
      }
    }

    // Reject — conditional update prevents overwriting if status changed
    // between our fetch and this write (e.g. another admin approved it).
    const rejectResult = await db.submission.updateMany({
      where: { id, status: { in: ['pending', 'post_failed', 'censored'] } },
      data: { status: 'rejected' },
    })
    if (rejectResult.count === 0) {
      return NextResponse.json({ error: 'Status berubah — coba refresh halaman.' }, { status: 409 })
    }
    const updated = await db.submission.findUnique({ where: { id } })

    return NextResponse.json({ submission: updated })
  })
})

// DELETE /api/submissions/[id] - Delete a submission
export const DELETE = withAdmin<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  try {
    const { id } = await params

    const found = await findSubmissionOr404(id)
    if (found instanceof NextResponse) return found
    const { submission } = found

    // Prevent deleting a submission that is currently being posted to X
    // (would orphan the tweet — it posts but we lose the record)
    // However, if the posting is stale (>2 min), auto-recover so the admin can delete.
    if (submission.status === 'posting') {
      const stale = await checkStalePosting(submission)
      if (!stale.isStale) {
        return NextResponse.json({ error: 'Tidak bisa menghapus pesan yang sedang diposting. Coba lagi dalam beberapa menit.' }, { status: 409 })
      }
      // Stale posting auto-recovered — fall through to delete below.
      // WARNING: The tweet may have been posted to X before the crash.
      // Deleting the DB record means we lose track of it — but the admin
      // is explicitly choosing to delete, so this is acceptable.
    }

    // Conditional delete — only succeeds if status is not 'posting'.
    // Prevents the race where checkStalePosting recovers an old 'posting',
    // but another process has since set a fresh 'posting' (e.g. admin approved).
    const deleted = await db.submission.deleteMany({
      where: { id, status: { not: 'posting' } },
    })
    if (deleted.count === 0) {
      return NextResponse.json({ error: 'Tidak bisa menghapus pesan yang sedang diposting. Coba lagi dalam beberapa menit.' }, { status: 409 })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[submissions] Delete error:', e)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
})
