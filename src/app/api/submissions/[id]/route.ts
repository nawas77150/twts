import { db } from '@/lib/db'
import { postTweetViaOAuth1 } from '@/lib/twitter-post'
import { NextRequest, NextResponse } from 'next/server'

// PATCH /api/submissions/[id] - Approve (auto-post) or reject
export async function PATCH(
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
    const body = await req.json()
    const { status } = body

    if (!['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'Status tidak valid' }, { status: 400 })
    }

    const submission = await db.submission.findUnique({ where: { id } })
    if (!submission) {
      return NextResponse.json({ error: 'Submission tidak ditemukan' }, { status: 404 })
    }

    if (submission.status !== 'pending') {
      return NextResponse.json(
        { error: `Submission sudah ${submission.status}` },
        { status: 400 }
      )
    }

    // If approving, auto-post to X
    if (status === 'approved') {
      // Post to your autobase X account using OAuth 1.0a
      const tweetResult = await postTweetViaOAuth1(submission.message)

      if (tweetResult.success) {
        const updated = await db.submission.update({
          where: { id },
          data: {
            status: 'posted',
            tweetId: tweetResult.tweetId || null,
          },
        })
        return NextResponse.json({
          submission: updated,
          autoPosted: true,
          tweetId: tweetResult.tweetId,
        })
      } else {
        // Failed to post — still approve but mark as approved (not posted)
        // Admin can manually retry posting later
        const updated = await db.submission.update({
          where: { id },
          data: { status: 'approved' },
        })
        return NextResponse.json({
          submission: updated,
          autoPosted: false,
          error: `Disetujui, tapi gagal posting ke X: ${tweetResult.error}`,
        })
      }
    }

    // Reject
    const updated = await db.submission.update({
      where: { id },
      data: { status: 'rejected' },
    })

    return NextResponse.json({ submission: updated })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}

// DELETE /api/submissions/[id] - Delete a submission
export async function DELETE(
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

    await db.submission.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
