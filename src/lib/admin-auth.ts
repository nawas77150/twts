import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Admin authentication helper.
 *
 * SECURITY: ADMIN_PASSWORD env var is REQUIRED in production.
 * There is no fallback — if unset, admin routes return 500 with
 * a clear error message instead of silently accepting 'admin123'.
 *
 * The admin password is NEVER exposed to the client. Instead, on
 * login, we derive an HMAC token from the password + an expiry
 * timestamp and return that. Subsequent requests authenticate with
 * this derived token, which cannot be reversed back to the raw
 * password. The embedded expiry ensures stolen or old tokens
 * become useless after the TTL elapses.
 */

// Domain label for HMAC derivation — decoupled from NEXTAUTH_SECRET
// so admin token rotation is independent of user session signing.
const ADMIN_TOKEN_LABEL = 'tweetfess:admin:v1'

/** Token lifetime in seconds — 7 days */
export const ADMIN_TOKEN_TTL = 7 * 24 * 60 * 60

/**
 * Extract admin token from request — cookie first, Authorization header second.
 * Cookie is HttpOnly (browser requests), Authorization is for API/curl usage.
 */
export function getAdminTokenFromRequest(req: NextRequest): string | null {
  // 1. Cookie first (browser requests — HttpOnly, secure)
  const cookieToken = req.cookies.get('admin_token')?.value
  if (cookieToken) return cookieToken

  // 2. Authorization header second (API/curl — Bearer token fallback)
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7)

  return null
}

/**
 * Derive an HMAC from the admin password + expiry timestamp.
 * The expiry is included in the HMAC input so the token cannot
 * be replayed with a different (or missing) expiry — changing
 * the expiry produces a completely different HMAC.
 */
function deriveAdminToken(password: string, expiresAt: number): string {
  return crypto
    .createHmac('sha256', password)
    .update(`${ADMIN_TOKEN_LABEL}:${expiresAt}`)
    .digest('hex')
}

/**
 * Generate an admin token with embedded expiry.
 *
 * Format: <hmac_hex>.<expiresAt_hex>
 *
 * The hex-encoded expiry is appended after a dot separator so
 * verifyAdmin() can extract it without parsing the HMAC itself.
 */
export function generateAdminToken(password: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ADMIN_TOKEN_TTL
  const hmac = deriveAdminToken(password, expiresAt)
  return `${hmac}.${expiresAt.toString(16)}`
}

/**
 * Verify an admin token against the admin password.
 * Accepts either a raw token (from cookie) or a Bearer header string.
 * Returns { authorized: true } if valid and not expired,
 * or a NextResponse error if not.
 *
 * Compares the submitted HMAC against the expected HMAC using
 * crypto.timingSafeEqual to prevent timing side-channel attacks.
 * Also checks that the embedded expiry timestamp has not passed.
 */
export function verifyAdmin(token: string | null):
  | { authorized: true }
  | { authorized: false; response: NextResponse } {
  const password = process.env.ADMIN_PASSWORD
  if (!password) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: 'ADMIN_PASSWORD env var is not set. Configure it in Vercel → Settings → Environment Variables.' },
        { status: 500 }
      ),
    }
  }

  if (!token) {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  // Extract token from "Bearer <token>" header (cookie tokens are already raw)
  const submitted = token.startsWith('Bearer ')
    ? token.slice(7)
    : token

  // Parse token format: <hmac_hex>.<expiresAt_hex>
  const dotIndex = submitted.lastIndexOf('.')
  if (dotIndex === -1) {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const submittedHmac = submitted.slice(0, dotIndex)
  const expiresAtHex = submitted.slice(dotIndex + 1)

  const expiresAt = parseInt(expiresAtHex, 16)
  if (isNaN(expiresAt)) {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  // Check expiry
  const now = Math.floor(Date.now() / 1000)
  if (now > expiresAt) {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'Session expired' }, { status: 401 }),
    }
  }

  // Derive the expected HMAC for this expiry timestamp
  const expectedHmac = deriveAdminToken(password, expiresAt)

  // Timing-safe comparison to prevent leaking token via response time
  const submittedBuf = Buffer.from(submittedHmac)
  const expectedBuf = Buffer.from(expectedHmac)
  const isMatch = submittedBuf.length === expectedBuf.length
    && crypto.timingSafeEqual(submittedBuf, expectedBuf)

  if (!isMatch) {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  return { authorized: true }
}

/**
 * Route handler wrapper that enforces admin authentication.
 * Eliminates the duplicated auth boilerplate in every admin route handler.
 * Supports dynamic route handlers that receive a context argument.
 *
 * Usage:
 *   export const GET = withAdmin(async (req) => { ... })
 *   export const POST = withAdmin(async (req) => { ... })
 *   export const DELETE = withAdmin(async (req, ctx) => { ... })
 */
export function withAdmin<C = unknown>(
  handler: (req: NextRequest, ctx: C) => Promise<NextResponse>
): (req: NextRequest, ctx: C) => Promise<NextResponse> {
  return async (req, ctx) => {
    const auth = verifyAdmin(getAdminTokenFromRequest(req))
    if (!auth.authorized) return auth.response
    return handler(req, ctx)
  }
}
