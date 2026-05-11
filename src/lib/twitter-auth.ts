import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

// Twitter OAuth 2.0 with PKCE implementation

const TWITTER_AUTH_URL = 'https://x.com/i/oauth2/authorize'
const TWITTER_TOKEN_URL = 'https://api.x.com/2/oauth2/token'
const TWITTER_USER_URL = 'https://api.x.com/2/users/me'

// Get the base URL for OAuth callbacks
// IMPORTANT: Must match the Callback URI registered in X Developer Portal exactly!
export function getBaseUrl(): string {
  // NEXTAUTH_URL should always be set to the production URL (e.g. https://tweetfess.vercel.app)
  // This takes priority over VERCEL_URL because VERCEL_URL can be a preview deployment URL
  // which won't match the callback URI registered in X Developer Portal
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL
  }
  // Fall back to VERCEL_URL only if NEXTAUTH_URL is not set
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
}

// Generate a random string for PKCE code_verifier and state
export function generateRandomString(length = 64): string {
  return crypto.randomBytes(length).toString('base64url').slice(0, length)
}

// Generate PKCE code_challenge from code_verifier
export function generateCodeChallenge(codeVerifier: string): string {
  return crypto.createHash('sha256').update(codeVerifier).digest('base64url')
}

// Build the Twitter OAuth 2.0 authorize URL
export function buildTwitterAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'tweet.read users.read offline.access',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  return `${TWITTER_AUTH_URL}?${params.toString()}`
}

// Exchange authorization code for access token
export async function exchangeCodeForToken(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
  codeVerifier: string
): Promise<{ access_token: string; token_type: string; refresh_token?: string } | null> {
  // X OAuth 2.0 supports two auth methods for the token endpoint:
  // 1. "client_secret_basic" — Use HTTP Basic Auth header (client_id:client_secret)
  //    Do NOT include client_id in the request body when using this method.
  // 2. "client_secret_post" — Include client_id and client_secret in the request body
  //    No Authorization header needed.
  //
  // We use method 1 (Basic Auth) which is the default for X confidential clients.
  // IMPORTANT: Including client_id in the body WITH Basic auth causes X to reject the request!

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    // NOTE: client_id is NOT included here because we're using Basic auth.
    // X's token endpoint will identify the client from the Authorization header.
  })

  console.log('Exchanging code for token, redirect_uri:', redirectUri)

  try {
    const res = await fetch(TWITTER_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: params.toString(),
    })

    if (!res.ok) {
      const errorText = await res.text()
      console.error('Token exchange failed:', res.status, errorText)

      // If Basic auth failed, try fallback with client_id in body (some X app configs need this)
      if (res.status === 400 || res.status === 401) {
        console.log('Trying fallback: client_secret_post method...')
        const fallbackParams = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
          client_id: clientId,
          client_secret: clientSecret,
        })

        const fallbackRes = await fetch(TWITTER_TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: fallbackParams.toString(),
        })

        if (fallbackRes.ok) {
          const data = await fallbackRes.json()
          console.log('Token exchange successful (fallback method), scopes:', data.scope)
          return data
        } else {
          const fallbackErrorText = await fallbackRes.text()
          console.error('Token exchange fallback also failed:', fallbackRes.status, fallbackErrorText)
        }
      }

      return null
    }

    const data = await res.json()
    console.log('Token exchange successful, scopes:', data.scope)
    return data
  } catch (error) {
    console.error('Token exchange error:', error)
    return null
  }
}

// Fetch Twitter user info using OAuth 2.0 access token
export async function fetchTwitterUser(accessToken: string): Promise<{
  id: string
  name: string
  username: string
  profile_image_url?: string
} | null> {
  try {
    const res = await fetch(TWITTER_USER_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!res.ok) {
      console.error('Fetch user failed:', res.status)
      return null
    }

    const data = await res.json()
    return data?.data || null
  } catch (error) {
    console.error('Fetch user error:', error)
    return null
  }
}

// Create or update a submitter from Twitter user data
export async function upsertSubmitterFromTwitter(twitterUser: {
  id: string
  name: string
  username: string
  profile_image_url?: string
}) {
  const { id: twitterId, name: displayName, username, profile_image_url } = twitterUser

  // Try to find existing submitter by twitterId
  const existing = await db.submitter.findUnique({ where: { twitterId } })

  if (existing) {
    // Update existing
    return db.submitter.update({
      where: { twitterId },
      data: {
        username,
        displayName: displayName || null,
        profileImage: profile_image_url || null,
      },
    })
  }

  // Check if username is taken
  const usernameTaken = await db.submitter.findUnique({ where: { username } })
  const finalUsername = usernameTaken ? `${username}_${Date.now()}` : username

  return db.submitter.create({
    data: {
      twitterId,
      username: finalUsername,
      displayName: displayName || null,
      profileImage: profile_image_url || null,
    },
  })
}

// === Session Cookie ===
// Simple signed cookie approach: encode submitterId + expiry, sign with HMAC

const SESSION_COOKIE_NAME = 'menfess_session'
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000 // 30 days

function getSessionSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET || process.env.SESSION_SECRET || 'menfess-default-secret-change-me'
  return secret
}

export interface SessionData {
  submitterId: string
  exp: number // expiry timestamp
}

// Create a signed session token
export function createSessionToken(submitterId: string): string {
  const data: SessionData = {
    submitterId,
    exp: Date.now() + SESSION_MAX_AGE,
  }
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  const signature = crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

// Verify and decode a session token
export function verifySessionToken(token: string): SessionData | null {
  try {
    const [payload, signature] = token.split('.')
    if (!payload || !signature) return null

    // Verify signature
    const expectedSignature = crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url')
    if (signature !== expectedSignature) return null

    const data: SessionData = JSON.parse(Buffer.from(payload, 'base64url').toString())

    // Check expiry
    if (data.exp < Date.now()) return null

    return data
  } catch {
    return null
  }
}

// Get submitter from NextRequest cookies (recommended for API routes)
export async function getSubmitterFromNextRequest(request: NextRequest): Promise<{
  id: string
  username: string
  displayName: string | null
  profileImage: string | null
  twitterId: string | null
} | null> {
  const tokenCookie = request.cookies.get(SESSION_COOKIE_NAME)
  const token = tokenCookie?.value
  if (!token) return null

  const session = verifySessionToken(token)
  if (!session) return null

  const submitter = await db.submitter.findUnique({
    where: { id: session.submitterId },
    select: { id: true, username: true, displayName: true, profileImage: true, twitterId: true },
  })

  return submitter
}

// Get submitter from generic Request (fallback, uses manual cookie parsing)
export async function getSubmitterFromRequest(request: Request): Promise<{
  id: string
  username: string
  displayName: string | null
  profileImage: string | null
  twitterId: string | null
} | null> {
  // Try NextRequest cookies API first
  if ('cookies' in request && typeof (request as any).cookies?.get === 'function') {
    const tokenCookie = (request as any).cookies.get(SESSION_COOKIE_NAME)
    const token = tokenCookie?.value
    if (token) {
      const session = verifySessionToken(token)
      if (session) {
        const submitter = await db.submitter.findUnique({
          where: { id: session.submitterId },
          select: { id: true, username: true, displayName: true, profileImage: true, twitterId: true },
        })
        if (submitter) return submitter
      }
    }
  }

  // Fallback: manual cookie parsing
  const cookieHeader = request.headers.get('cookie') || ''
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, ...v] = c.trim().split('=')
      return [k, v.join('=')]
    })
  )

  const token = cookies[SESSION_COOKIE_NAME]
  if (!token) return null

  const session = verifySessionToken(token)
  if (!session) return null

  const submitter = await db.submitter.findUnique({
    where: { id: session.submitterId },
    select: { id: true, username: true, displayName: true, profileImage: true, twitterId: true },
  })

  return submitter
}

export { SESSION_COOKIE_NAME }
