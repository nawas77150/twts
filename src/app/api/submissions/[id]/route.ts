import { db } from '@/lib/db'
import { postTweetViaCookie } from '@/lib/twitter-post-cookie'
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

    // If approving, auto-post to X via cookie auth
    if (status === 'approved') {
      const tweetResult = await postTweetViaCookie(submission.message)

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
        // Cookie failed — mark as approved but NOT posted
        const updated = await db.submission.update({
          where: { id },
          data: { status: 'approved' },
        })

        // Context-aware hint based on error type
        const errorMsg = tweetResult.error || ''
        let hint = ''
        if (errorMsg.includes('code: 344') || errorMsg.includes('daily limit')) {
          hint = 'Batas harian tweet tercapai. Coba lagi besok.'
        } else if (errorMsg.includes('code: 32') || errorMsg.includes('Could not authenticate')) {
          hint = 'Cookie expired. Perbarui cookie di X Settings lalu klik "Post to X".'
        } else if (errorMsg.includes('code: 88') || errorMsg.includes('Rate limit')) {
          hint = 'Rate limit tercapai. Tunggu beberapa menit lalu coba lagi.'
        } else {
          hint = 'Cek X Settings lalu klik "Post to X" untuk retry.'
        }

        return NextResponse.json({
          submission: updated,
          autoPosted: false,
          error: `Disetujui, tapi gagal posting ke X: ${errorMsg}. ${hint}`,
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
