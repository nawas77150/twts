import crypto from 'crypto'
import { db } from '@/lib/db'

// Twitter OAuth 2.0 with PKCE implementation

const TWITTER_AUTH_URL = 'https://twitter.com/i/oauth2/authorize'
const TWITTER_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token'
const TWITTER_USER_URL = 'https://api.twitter.com/2/users/me'

// Get the base URL for OAuth callbacks
export function getBaseUrl(): string {
  // Vercel sets VERCEL_URL automatically
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
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
    scope: 'tweet.read users.read',
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
): Promise<{ access_token: string; token_type: string } | null> {
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  })

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
      return null
    }

    return await res.json()
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

// Get submitter from request cookies
export async function getSubmitterFromRequest(request: Request): Promise<{
  id: string
  username: string
  displayName: string | null
  profileImage: string | null
  twitterId: string | null
} | null> {
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
