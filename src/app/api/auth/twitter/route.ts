import { NextResponse } from 'next/server'
import {
  generateRandomString,
  generateCodeChallenge,
  buildTwitterAuthUrl,
  getBaseUrl,
  getOAuth2Credentials,
} from '@/lib/twitter-auth'

// GET /api/auth/twitter - Start Twitter OAuth 2.0 flow
export async function GET() {
  const creds = getOAuth2Credentials()

  if (!creds) {
    return NextResponse.json(
      { error: 'Twitter OAuth belum dikonfigurasi. Tambahkan OAUTH2_CLIENT_ID dan OAUTH2_CLIENT_SECRET ke env vars.' },
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
  const authUrl = buildTwitterAuthUrl(creds.clientId, redirectUri, state, codeChallenge)

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
