import { db } from '@/lib/db'
import { postTweetViaCookie } from '@/lib/twitter-post-cookie'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/submissions/[id]/post - Post submission to X via cookie auth (manual retry)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authHeader = req.headers.get('authorization')
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'

  if (authHeader !== `Bearer ${adminPassword}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

    // Post to your autobase X account using cookie-based auth
    const tweetResult = await postTweetViaCookie(submission.message)

    if (!tweetResult.success) {
      // Log the actual X error for debugging (visible in Vercel runtime logs)
      console.error('X API error:', tweetResult.error)
      return NextResponse.json(
        { error: `Gagal posting ke X: ${tweetResult.error}` },
        { status: 502 }  // 502 = upstream (X API) rejected, not our server error
      )
    }

    // Update submission status
    const updated = await db.submission.update({
      where: { id },
      data: {
        status: 'posted',
        tweetId: tweetResult.tweetId || null,
      },
    })

    return NextResponse.json({ submission: updated, tweetId: tweetResult.tweetId })
  } catch (error) {
    console.error('Post to X error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
