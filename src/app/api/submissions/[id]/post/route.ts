import { db } from '@/lib/db'
import { executePostAndRecord, withErrorBoundary } from '@/lib/execute-post'
import { verifyAdmin, getAdminTokenFromRequest } from '@/lib/admin-auth'
import { debug } from '@/lib/debug'
import { decodeHtmlEntities } from '@/lib/content-filter'
import { getFilterSettings } from '@/lib/filter-settings'
import { fetchSubmissionForPosting, handlePostEarlyReturns } from '../_lib'
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

    // Load filter settings before executePostAndRecord (which acquires the posting lock internally)
    const filterSettings = await getFilterSettings()

    // Delegated: lock → CAS → post → record → release
    const postResult = await executePostAndRecord({
      submissionId: id,
      message: decodeHtmlEntities(submission.message),
      rateLimits: filterSettings.rateLimits,
      casStatuses: ['pending', 'post_failed', 'censored'],
    })

    // Map result to HTTP response
    const earlyReturn = handlePostEarlyReturns(postResult, '[post route]')
    if (earlyReturn) return earlyReturn

    if (postResult.success) {
      debug('[post route] Post succeeded! tweetId:', postResult.tweetId, 'method:', postResult.method, 'retries:', postResult.retriesUsed)
      if (postResult.warning) {
        return NextResponse.json({
          autoPosted: true,
          tweetId: postResult.tweetId,
          postMethod: postResult.method,
          warning: postResult.warning,
        })
      }
      const updated = await db.submission.findUnique({ where: { id } })
      return NextResponse.json({
        submission: updated,
        tweetId: postResult.tweetId,
        postMethod: postResult.method,
        retriesUsed: postResult.retriesUsed,
      })
    } else {
      debug('[post route] Post failed:', postResult.error, 'method:', postResult.method)
      return NextResponse.json(
        { error: `Gagal posting ke X: ${postResult.error}`, postMethod: postResult.method },
        { status: 502 },
      )
    }
  })
}
