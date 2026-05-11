import { NextRequest, NextResponse } from 'next/server'
import { postTweetViaOAuth1 } from '@/lib/twitter-post'

// GET /api/test-x - Check X API credentials status
export async function GET(req: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${adminPassword}`) {
    return NextResponse.json({ error: 'Unauthorized - pass admin password as Bearer token' }, { status: 401 })
  }

  // Check OAuth 2.0 (login) credentials
  const oauth2ClientId = process.env.OAUTH2_CLIENT_ID || process.env.TWITTER_CLIENT_ID
  const oauth2ClientSecret = process.env.OAUTH2_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET

  // Check OAuth 1.0a (posting) credentials
  const apiKey = process.env.X_API_KEY
  const apiSecret = process.env.X_API_SECRET
  const accessToken = process.env.X_ACCESS_TOKEN
  const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET

  const oauth2Status = {
    configured: !!(oauth2ClientId && oauth2ClientSecret),
    clientId: oauth2ClientId ? `${oauth2ClientId.substring(0, 8)}...` : 'MISSING',
    clientSecret: oauth2ClientSecret ? `${oauth2ClientSecret.substring(0, 4)}****` : 'MISSING',
    scope: 'users.read offline.access',
    note: 'OAuth 2.0 is for user LOGIN only. Tweets are posted via OAuth 1.0a.',
  }

  const oauth1Status = {
    configured: !!(apiKey && apiSecret && accessToken && accessTokenSecret),
    apiKey: apiKey ? `${apiKey.substring(0, 4)}****` : 'MISSING',
    apiSecret: apiSecret ? '****' : 'MISSING',
    accessToken: accessToken ? `${accessToken.substring(0, 4)}****` : 'MISSING',
    accessTokenSecret: accessTokenSecret ? '****' : 'MISSING',
  }

  // Try to verify OAuth 1.0a credentials by calling /2/users/me
  let whoami = null
  if (oauth1Status.configured) {
    try {
      const oauth = await import('oauth')
      const oauthClient = new oauth.OAuth(
        'https://api.x.com/oauth/request_token',
        'https://api.x.com/oauth/access_token',
        apiKey!,
        apiSecret!,
        '1.0A',
        null,
        'HMAC-SHA1'
      )

      whoami = await new Promise((resolve) => {
        oauthClient.get(
          'https://api.x.com/2/users/me',
          accessToken!,
          accessTokenSecret!,
          (err, data) => {
            if (err) {
              resolve({ error: String(err.data || err) })
            } else {
              try {
                resolve(JSON.parse(data as string))
              } catch {
                resolve({ error: 'Parse error' })
              }
            }
          }
        )
      })
    } catch (error) {
      whoami = { error: String(error) }
    }
  }

  return NextResponse.json({
    oauth2: oauth2Status,
    oauth1: oauth1Status,
    whoami,
  })
}

// POST /api/test-x - Test posting a tweet
export async function POST(req: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${adminPassword}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get optional custom text from body
  let testText = 'Tweetfess test! 🚀 #xapi'
  try {
    const body = await req.json()
    if (body.text) testText = body.text
  } catch {
    // use default text
  }

  const result = await postTweetViaOAuth1(testText)

  return NextResponse.json({
    success: result.success,
    tweetId: result.tweetId,
    text: testText,
    error: result.error,
    tweetUrl: result.tweetId ? `https://x.com/i/status/${result.tweetId}` : null,
  })
}
