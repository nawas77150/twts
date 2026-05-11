import { NextResponse } from 'next/server'
import {
  generateRandomString,
  generateCodeChallenge,
  buildTwitterAuthUrl,
  getBaseUrl,
} from '@/lib/twitter-auth'

// GET /api/auth/twitter - Start Twitter OAuth 2.0 flow
export async function GET() {
  const clientId = process.env.TWITTER_CLIENT_ID
  const clientSecret = process.env.TWITTER_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'Twitter OAuth belum dikonfigurasi. Tambahkan TWITTER_CLIENT_ID dan TWITTER_CLIENT_SECRET ke .env' },
      { status: 500 }
    )
  }

  // Generate PKCE parameters
  const codeVerifier = generateRandomString()
  const codeChallenge = generateCodeChallenge(codeVerifier)
  const state = generateRandomString(32)

  // Build redirect URI (must match what's configured in Twitter Developer Portal)
  const baseUrl = getBaseUrl()
  const redirectUri = `${baseUrl}/api/auth/twitter/callback`

  // Build the authorization URL
  const authUrl = buildTwitterAuthUrl(clientId, redirectUri, state, codeChallenge)

  // Store code_verifier and state in cookies for the callback
  const response = NextResponse.redirect(authUrl)

  response.cookies.set('twitter_oauth_verifier', codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  })

  response.cookies.set('twitter_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  })

  return response
}
