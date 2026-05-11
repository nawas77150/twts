import { db } from '@/lib/db'
import { postTweetViaOAuth1 } from '@/lib/twitter-post'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/submissions/[id]/post - Post submission to X (manual retry)
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

    // Post to your autobase X account using OAuth 1.0a
    const tweetResult = await postTweetViaOAuth1(submission.message)

    if (!tweetResult.success) {
      return NextResponse.json(
        { error: `Gagal posting ke X: ${tweetResult.error}` },
        { status: 500 }
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
