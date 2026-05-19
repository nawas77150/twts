import { db } from '@/lib/db'
import { withErrorBoundary } from '@/lib/execute-post'
import { verifyAdmin, getAdminTokenFromRequest } from '@/lib/admin-auth'
import { debug } from '@/lib/debug'
import { decodeHtmlEntities } from '@/lib/content-filter'
import { fetchSubmissionForPosting, executePostForSubmission, buildPostWarningResponse } from '../_lib'
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
      if (postResult.warning) {
        return buildPostWarningResponse(postResult)
      }
      const updated = await db.submission.findUnique({ where: { id } })
      return NextResponse.json({
        submission: updated,
        tweetId: postResult.tweetId,
        postMethod: postResult.method,
        retriesUsed: postResult.retriesUsed,
      })
    } else {
      debug('retry', 'Post failed:', postResult.error, 'method:', postResult.method)
      return NextResponse.json(
        { error: `Gagal posting ke X: ${postResult.error}`, postMethod: postResult.method },
        { status: 502 },
      )
    }
  })
}
