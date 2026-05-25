import { db } from '@/lib/db'
import { withErrorBoundary } from '@/lib/execute-post'
import { withAdmin } from '@/lib/admin-auth'
import { debug } from '@/lib/debug'
import { decodeHtmlEntities } from '@/lib/content-filter'
import { fetchSubmissionForPosting, executePostForSubmission, getUpdatedSubmissionOrWarning, getPostErrorHint } from '../_lib'
import { NextResponse } from 'next/server'

// Vercel serverless function timeout — retry loop can take up to 15s
export const maxDuration = 30

// POST /api/submissions/[id]/post - Post submission to X (manual retry)
// Uses the full retry + fallback flow from postTweetViaCookie
export const POST = withAdmin<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  return withErrorBoundary(async () => {
    const { id } = await params

    const validationResult = await fetchSubmissionForPosting(id, 'Status tidak valid untuk retry')
    if (validationResult instanceof NextResponse) return validationResult
    const { submission } = validationResult

    // Delegated: load settings → lock → CAS → post → record → release → handle early returns
    const postAttempt = await executePostForSubmission(id, decodeHtmlEntities(submission.message), 'retry')
    if (postAttempt instanceof NextResponse) return postAttempt
    const { postResult } = postAttempt

    if (postResult.success) {
      debug('retry', 'Post succeeded! tweetId:', postResult.tweetId, 'method:', postResult.method, 'retries:', postResult.retriesUsed)

      const result = await getUpdatedSubmissionOrWarning(id, postResult)
      if (result instanceof NextResponse) return result

      return NextResponse.json({
        submission: result.updated,
        tweetId: postResult.tweetId,
        postMethod: postResult.method,
        retriesUsed: postResult.retriesUsed,
      })
    } else {
      debug('retry', 'Post failed:', postResult.error, 'method:', postResult.method)
      const errorMsg = postResult.error || ''
      const hint = getPostErrorHint(errorMsg)

      const updated = await db.submission.findUnique({ where: { id } })
      if (!updated) {
        return NextResponse.json({
          error: `Gagal posting ke X: ${errorMsg}. ${hint} Submission tidak ditemukan — mungkin sudah dihapus.`,
          postMethod: postResult.method,
        }, { status: 404 })
      }
      return NextResponse.json({
        submission: updated,
        autoPosted: false,
        error: `Gagal posting ke X: ${errorMsg}. ${hint}`,
        postMethod: postResult.method,
      })
    }
  })
})
