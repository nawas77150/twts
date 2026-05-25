// ============================================================
// twitter-post-request.ts — HTTP request construction for X API
//
// Builds headers, resolves transaction IDs, and parses cookies.
// No posting logic — that lives in twitter-post-cookie.ts.
//
// Used by:
//   - twitter-post-cookie.ts (headers, transaction ID, cookie parsing)
//   - settings/route.ts (cookie validation)
// ============================================================

import { BROWSER_UA, SEC_CH_UA } from '@/lib/x-browser-constants'
import { generateTransactionId } from '@/lib/x-transaction-id'
import { generateTransactionIdFromPair } from '@/lib/x-transaction-id-pair'
import { debug } from '@/lib/debug'

// ── Cookie Parsing ─────────────────────────────────────

/**
 * Parse the full cookie string from the browser.
 * Extracts auth_token, ct0, and twid which are required for X API calls.
 *
 * The cookie string looks like:
 *   "auth_token=abc123; ct0=xyz789; twid=...; kdt=..."
 *
 * We store the FULL string because:
 * - X may require additional cookies in the future
 * - ct0 cannot be reliably derived from a live request
 * - One copy-paste from browser gives us everything
 */
export function parseXCookies(cookieString: string): {
  auth_token: string | null
  ct0: string | null
  twid: string | null
  raw: string
} {
  const auth_token = cookieString.match(/auth_token=([^;]+)/)?.[1] || null
  const ct0 = cookieString.match(/ct0=([^;]+)/)?.[1] || null
  const twid = cookieString.match(/twid=([^;]+)/)?.[1] || null
  return { auth_token, ct0, twid, raw: cookieString }
}

// ── Headers ────────────────────────────────────────────

// Base headers for CreateTweet — static portion that never changes.
// Dynamic headers (Authorization, Cookie, X-Csrf-Token, x-client-transaction-id)
// are added by buildCreateTweetHeaders().
const BASE_CREATE_TWEET_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Twitter-Auth-Type': 'OAuth2Session',
  'X-Twitter-Active-User': 'yes',
  'X-Twitter-Client-Language': 'en',
  'User-Agent': BROWSER_UA,
  Referer: 'https://x.com/',
  'sec-ch-ua': SEC_CH_UA,
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Linux"',
  origin: 'https://x.com',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  priority: 'u=1, i',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
}

/** Build complete headers for CreateTweet, merging static + dynamic values */
export function buildCreateTweetHeaders(
  bearerToken: string,
  cookieRaw: string,
  ct0: string,
  transactionId: string | null,
): Record<string, string> {
  return {
    ...BASE_CREATE_TWEET_HEADERS,
    Authorization: `Bearer ${bearerToken}`,
    Cookie: cookieRaw,
    'X-Csrf-Token': ct0,
    ...(transactionId ? { 'x-client-transaction-id': transactionId } : {}),
  }
}

// ── Transaction ID Resolution ──────────────────────────

/**
 * Resolve x-client-transaction-id for a CreateTweet request.
 * Primary: pair-dict approach (0 x.com fetches).
 * Fallback: live SVG + cubic-bezier (3 x.com fetches).
 * Returns null if both fail (non-fatal — request continues without it).
 */
export async function resolveTransactionId(
  apiPath: string,
): Promise<string | null> {
  const pairId = await generateTransactionIdFromPair('POST', apiPath)
  if (pairId) return pairId

  debug('direct', 'Pair-dict failed, falling back to live SVG approach')
  try {
    return await generateTransactionId('POST', apiPath)
  } catch {
    return null // Non-fatal: continue without transaction ID
  }
}
