import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { encrypt } from '@/lib/encrypt'

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
// For X confidential clients (WebApp type), the token endpoint requires:
// - Authorization: Basic base64(client_id:client_secret) header
// - Body: grant_type, code, redirect_uri, code_verifier (PKCE)
// - Do NOT include client_id in the body when using Basic auth
export async function exchangeCodeForToken(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
  codeVerifier: string
): Promise<{ access_token: string; token_type: string; refresh_token?: string } | null> {
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

    const data = await res.json()
    return data
  } catch (error) {
    console.error('Token exchange error:', error)
    return null
  }
}

// Get OAuth2 credentials from environment variables
// X Developer Portal uses OAUTH2_CLIENT_ID / OAUTH2_CLIENT_SECRET
// We also support the older TWITTER_CLIENT_ID / TWITTER_CLIENT_SECRET names
export function getOAuth2Credentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.OAUTH2_CLIENT_ID || process.env.TWITTER_CLIENT_ID
  const clientSecret = process.env.OAUTH2_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return null
  }

  return { clientId, clientSecret }
}

// Fetch Twitter user info using OAuth 2.0 access token
// Requires scope: tweet.read users.read (X API /2/users/me needs tweet.read context)
// IMPORTANT: Do NOT use App Bearer Token as fallback — /2/users/me with app token
// returns the APP OWNER's profile, NOT the logged-in user!
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

    // Read body ONCE as text to avoid "body already consumed" TypeError
    const body = await res.text()

    if (res.ok) {
      try {
        const data = JSON.parse(body)
        if (data?.data) return data.data
      } catch {
        // JSON parse error — fall through to error logging
      }
    }

    console.error('Fetch user failed:', res.status, body.slice(0, 200))
    return null
  } catch (error) {
    console.error('Fetch user error:', error)
    return null
  }
}

// Build encrypted token fields for Prisma data objects.
// Extracted because the same spread pattern appears 5 times in upsertSubmitterFromTwitter.
function buildTokenFields(tokens?: { accessToken?: string; refreshToken?: string }) {
  return {
    ...(tokens?.accessToken && { oauth2AccessToken: encrypt(tokens.accessToken) }),
    ...(tokens?.refreshToken && { oauth2RefreshToken: encrypt(tokens.refreshToken) }),
  }
}

// Create or update a submitter from Twitter user data
// Uses upsert to avoid TOCTOU race when two concurrent OAuth callbacks
// for the same user both find null from findUnique and both attempt create.
export async function upsertSubmitterFromTwitter(twitterUser: {
  id: string
  name: string
  username: string
  profile_image_url?: string
}, tokens?: { accessToken?: string; refreshToken?: string }) {
  const { id: twitterId, name: displayName, username, profile_image_url } = twitterUser

  // Use upsert to avoid race condition: two concurrent callbacks for the same
  // twitterId both find null, both try create → second gets unique constraint violation.
  // upsert makes this atomic.
  try {
    // First, check if there's a placeholder record (admin-created) with this username
    // but a pending twitterId. If so, claim it by updating the twitterId.
    // Both DB and input are lowercase — exact match is sufficient.
    const placeholder = await db.submitter.findFirst({
      where: {
        username: username.toLowerCase(),
        twitterId: { startsWith: 'pending:' },
      },
    })
    if (placeholder) {
      return db.submitter.update({
        where: { id: placeholder.id },
        data: {
          username: username.toLowerCase(),
          twitterId,
          displayName: displayName || placeholder.displayName,
          profileImage: profile_image_url || placeholder.profileImage,
          ...buildTokenFields(tokens),
        },
      })
    }

    return await db.submitter.upsert({
      where: { twitterId },
      update: {
        username: username.toLowerCase(),
        displayName: displayName || null,
        profileImage: profile_image_url || null,
        ...buildTokenFields(tokens),
      },
      create: {
        twitterId,
        username: username.toLowerCase(),
        displayName: displayName || null,
        profileImage: profile_image_url || null,
        ...buildTokenFields(tokens),
      },
    })
  } catch (error: unknown) {
    // Handle rare case: username unique constraint violation on create
    // (another user has the same username). Retry with a suffixed username.
    const isUniqueError = error instanceof Error && error.message.includes('Unique constraint')
    if (isUniqueError) {
      const suffixedUsername = `${username}_${Date.now()}`
      return db.submitter.upsert({
        where: { twitterId },
        update: {
          username: username.toLowerCase(),
          displayName: displayName || null,
          profileImage: profile_image_url || null,
          ...buildTokenFields(tokens),
        },
        create: {
          twitterId,
          username: suffixedUsername.toLowerCase(),
          displayName: displayName || null,
          profileImage: profile_image_url || null,
          ...buildTokenFields(tokens),
        },
      })
    }
    throw error
  }
}

// === Session Cookie ===
// Simple signed cookie approach: encode submitterId + expiry, sign with HMAC

const SESSION_COOKIE_NAME = 'menfess_session'
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000 // 30 days

function getSessionSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET || process.env.SESSION_SECRET
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET or SESSION_SECRET env var is not set. Configure it in Vercel → Settings → Environment Variables. Generate one with: openssl rand -hex 32')
  }
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

    // Verify signature using timing-safe comparison to prevent timing side-channel attacks
    const expectedSignature = crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url')
    const sigBuf = Buffer.from(signature)
    const expectedBuf = Buffer.from(expectedSignature)
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null

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
  customLimits: unknown
} | null> {
  const tokenCookie = request.cookies.get(SESSION_COOKIE_NAME)
  const token = tokenCookie?.value
  if (!token) return null

  const session = verifySessionToken(token)
  if (!session) return null

  const submitter = await db.submitter.findUnique({
    where: { id: session.submitterId },
    select: { id: true, username: true, displayName: true, profileImage: true, twitterId: true, customLimits: true },
  })

  return submitter
}


export { SESSION_COOKIE_NAME }
