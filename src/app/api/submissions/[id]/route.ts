import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

// POST tweet to X via OAuth 1.0a
async function postTweet(
  text: string,
  apiKey: string,
  apiSecret: string,
  accessToken: string,
  accessTokenSecret: string
): Promise<{ success: boolean; tweetId?: string; error?: string }> {
  try {
    const oauth = await import('oauth')

    const oauthClient = new oauth.OAuth(
      'https://api.twitter.com/oauth/request_token',
      'https://api.twitter.com/oauth/access_token',
      apiKey,
      apiSecret,
      '1.0A',
      null,
      'HMAC-SHA1'
    )

    return new Promise((resolve) => {
      const postData = JSON.stringify({ text })

      oauthClient.post(
        'https://api.twitter.com/2/tweets',
        accessToken,
        accessTokenSecret,
        postData,
        'application/json',
        (err, _data) => {
          if (err) {
            console.error('Twitter API error:', err)
            resolve({ success: false, error: String(err.data || err) })
            return
          }

          try {
            const result = JSON.parse(_data as string)
            const tweetId = result?.data?.id
            resolve({ success: true, tweetId })
          } catch {
            resolve({ success: false, error: 'Failed to parse response' })
          }
        }
      )
    })
  } catch (error) {
    console.error('OAuth error:', error)
    return { success: false, error: 'OAuth library error' }
  }
}

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
      const apiKey = process.env.X_API_KEY
      const apiSecret = process.env.X_API_SECRET
      const accessToken = process.env.X_ACCESS_TOKEN
      const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET

      if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
        // No X credentials — just approve without posting
        const updated = await db.submission.update({
          where: { id },
          data: { status: 'approved' },
        })
        return NextResponse.json({
          submission: updated,
          warning: 'Disetujui tapi X API credentials belum dikonfigurasi. Tweet tidak dikirim.',
        })
      }

      // Post to X
      const tweetResult = await postTweet(
        submission.message,
        apiKey,
        apiSecret,
        accessToken,
        accessTokenSecret
      )

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
