import { NextRequest, NextResponse } from 'next/server'
import { postTweetViaCookie, getCookieAuthStatus } from '@/lib/twitter-post-cookie'

// GET /api/test-x - Check X auth configuration status
export async function GET(req: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${adminPassword}`) {
    return NextResponse.json({ error: 'Unauthorized - pass admin password as Bearer token' }, { status: 401 })
  }

  // Check OAuth 2.0 (login) credentials — still needed for user authentication
  const oauth2ClientId = process.env.OAUTH2_CLIENT_ID || process.env.TWITTER_CLIENT_ID
  const oauth2ClientSecret = process.env.OAUTH2_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET

  const oauth2Status = {
    configured: !!(oauth2ClientId && oauth2ClientSecret),
    clientId: oauth2ClientId ? `${oauth2ClientId.substring(0, 8)}...` : 'MISSING',
    clientSecret: oauth2ClientSecret ? `${oauth2ClientSecret.substring(0, 4)}****` : 'MISSING',
    note: 'OAuth 2.0 is for user LOGIN only (free).',
  }

  // Check cookie auth (posting)
  const cookieAuthStatus = await getCookieAuthStatus()

  return NextResponse.json({
    oauth2: oauth2Status,
    cookieAuth: cookieAuthStatus,
  })
}

// POST /api/test-x - Test posting a tweet via cookie auth
export async function POST(req: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${adminPassword}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get optional custom text from body
  let testText = 'Tweetfess test! 🚀'
  try {
    const body = await req.json()
    if (body.text) testText = body.text
  } catch {
    // use default text
  }

  const result = await postTweetViaCookie(testText)

  return NextResponse.json({
    success: result.success,
    tweetId: result.tweetId,
    text: testText,
    error: result.error,
    tweetUrl: result.tweetId ? `https://x.com/i/status/${result.tweetId}` : null,
  })
}
