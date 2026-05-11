import { NextRequest, NextResponse } from 'next/server'
import {
  exchangeCodeForToken,
  fetchTwitterUser,
  upsertSubmitterFromTwitter,
  createSessionToken,
  getBaseUrl,
} from '@/lib/twitter-auth'

// GET /api/auth/twitter/callback - Handle Twitter OAuth 2.0 callback
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const baseUrl = getBaseUrl()

  // User denied access
  if (error) {
    return NextResponse.redirect(new URL('/?auth=denied', baseUrl))
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/?auth=error', baseUrl))
  }

  // Verify state matches (CSRF protection)
  const storedState = req.cookies.get('twitter_oauth_state')?.value
  if (state !== storedState) {
    return NextResponse.redirect(new URL('/?auth=error', baseUrl))
  }

  // Get code verifier from cookie
  const codeVerifier = req.cookies.get('twitter_oauth_verifier')?.value
  if (!codeVerifier) {
    return NextResponse.redirect(new URL('/?auth=error', baseUrl))
  }

  const clientId = process.env.TWITTER_CLIENT_ID!
  const clientSecret = process.env.TWITTER_CLIENT_SECRET!
  const redirectUri = `${baseUrl}/api/auth/twitter/callback`

  // Exchange code for access token
  const tokenData = await exchangeCodeForToken(
    clientId,
    clientSecret,
    code,
    redirectUri,
    codeVerifier
  )

  if (!tokenData?.access_token) {
    console.error('Failed to exchange code for token')
    return NextResponse.redirect(new URL('/?auth=error', baseUrl))
  }

  // Fetch Twitter user info
  const twitterUser = await fetchTwitterUser(tokenData.access_token)

  if (!twitterUser) {
    console.error('Failed to fetch Twitter user')
    return NextResponse.redirect(new URL('/?auth=error', baseUrl))
  }

  // Create or update submitter in DB
  try {
    const submitter = await upsertSubmitterFromTwitter(twitterUser)

    // Create session token
    const sessionToken = createSessionToken(submitter.id)

    // Set session cookie and redirect to home
    const response = NextResponse.redirect(new URL('/?auth=success', baseUrl))

    response.cookies.set('menfess_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    })

    // Clear OAuth temporary cookies
    response.cookies.set('twitter_oauth_verifier', '', { maxAge: 0, path: '/' })
    response.cookies.set('twitter_oauth_state', '', { maxAge: 0, path: '/' })

    return response
  } catch (error) {
    console.error('Error creating submitter:', error)
    return NextResponse.redirect(new URL('/?auth=error', baseUrl))
  }
}
