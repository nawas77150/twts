import { db } from '@/lib/db'
import { postTweetViaCookie } from '@/lib/twitter-post-cookie'
import { verifyAdmin } from '@/lib/admin-auth'
import { debug } from '@/lib/debug'
import { NextRequest, NextResponse } from 'next/server'

// Vercel serverless function timeout — retry loop can take up to 15s
export const maxDuration = 30

// POST /api/submissions/[id]/post - Post submission to X (manual retry)
// Uses the full retry + fallback flow from postTweetViaCookie
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

  try {
    const { id } = await params

    const submission = await db.submission.findUnique({ where: { id } })
    if (!submission) {
      return NextResponse.json({ error: 'Submission tidak ditemukan' }, { status: 404 })
    }

    if (submission.status === 'posted') {
      return NextResponse.json({ error: 'Submission sudah diposting' }, { status: 400 })
    }

    if (submission.status === 'rejected') {
      return NextResponse.json({ error: 'Submission sudah ditolak' }, { status: 400 })
    }

    // Only pending and post_failed statuses can be retried
    if (submission.status !== 'pending' && submission.status !== 'post_failed') {
      return NextResponse.json({ error: `Status tidak valid untuk retry: ${submission.status}` }, { status: 400 })
    }

    // Post to X using cookie-based auth (with retry + fallback)
    debug('[post route] Posting submission:', id, 'message length:', submission.message.length)
    const tweetResult = await postTweetViaCookie(submission.message)

    if (!tweetResult.success) {
      debug('[post route] Post failed:', tweetResult.error, 'method:', tweetResult.method)
      console.error('X API error:', tweetResult.error)
      return NextResponse.json(
        { error: `Gagal posting ke X: ${tweetResult.error}`, postMethod: tweetResult.method },
        { status: 502 }
      )
    }

    debug('[post route] Post succeeded! tweetId:', tweetResult.tweetId, 'method:', tweetResult.method, 'retries:', tweetResult.retriesUsed)
    // Update submission status with postMethod tracking, clear postError on success
    const updated = await db.submission.update({
      where: { id },
      data: {
        status: 'posted',
        tweetId: tweetResult.tweetId || null,
        postMethod: tweetResult.method,
        postError: null, // Clear error since post succeeded
      },
    })

    return NextResponse.json({
      submission: updated,
      tweetId: tweetResult.tweetId,
      postMethod: tweetResult.method,
      retriesUsed: tweetResult.retriesUsed,
    })
  } catch (error) {
    console.error('Post to X error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
