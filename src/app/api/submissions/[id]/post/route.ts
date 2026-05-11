import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/submissions/[id]/post - Post submission to X (Twitter)
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

    // Post to X using API v2
    const apiKey = process.env.X_API_KEY
    const apiSecret = process.env.X_API_SECRET
    const accessToken = process.env.X_ACCESS_TOKEN
    const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET

    if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
      return NextResponse.json(
        { error: 'X API credentials belum dikonfigurasi. Tambahkan environment variables.' },
        { status: 500 }
      )
    }

    // Use OAuth 1.0a to post tweet
    const tweetResult = await postTweet(
      submission.message,
      apiKey,
      apiSecret,
      accessToken,
      accessTokenSecret
    )

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
      'https://api.x.com/oauth/request_token',
      'https://api.x.com/oauth/access_token',
      apiKey,
      apiSecret,
      '1.0A',
      null,
      'HMAC-SHA1'
    )

    return new Promise((resolve) => {
      const postData = JSON.stringify({ text })

      oauthClient.post(
        'https://api.x.com/2/tweets',
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
