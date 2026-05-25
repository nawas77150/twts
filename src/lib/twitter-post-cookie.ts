import crypto from 'crypto'
import { db } from '@/lib/db'
import { generateTransactionId, clearTransactionIdCache as clearXactCache } from '@/lib/x-transaction-id'
import { generateTransactionIdFromPair, clearPairCache } from '@/lib/x-transaction-id-pair'
import { postViaCookieApi, postViaTwitterApi, isV2LoginEnabled } from '@/lib/twitter-api-fallback'
import { readSettingsMap } from '@/lib/twitter-api-shared'
import { getCreateTweetSpec, clearCreateTweetSpecCache } from '@/lib/create-tweet-spec'
import { debug } from '@/lib/debug'

// ============================================================
// Cookie-based tweet posting via X's internal GraphQL API
//
// This uses X's internal CreateTweet endpoint — the same one
// the x.com web client uses. Cost: $0. No paid API needed.
//
// How it works:
// 1. Read cookie string from DB → env var → null
// 2. Parse auth_token, ct0, and twid from the cookie string
// 3. Resolve CreateTweet spec (queryId + features) via create-tweet-spec.ts:
//    memory → DB → GitHub → x.com JS → hardcoded fallback (never null)
// 4. Read bearer token from DB (required, no default)
// 5. Generate x-client-transaction-id:
//    - Primary: pair-dict approach (0 x.com fetches, includes WebRTC bytes)
//    - Fallback: live SVG + cubic-bezier approach (3 x.com fetches)
// 6. POST to X GraphQL CreateTweet with Chrome-matching headers
// 7. Parse response with comprehensive error checking
//
// Retry strategy (V6: delay right after failure, before next attempt):
// - Attempt 0: Normal POST
//   - Stale cache → clear caches, retry immediately (no delay)
//   - 226 / empty → wait ~1s (800-1500ms), then retry
// - Attempt 1: POST
//   - 226 / empty → wait ~2s (1500-3000ms), then retry
// - Attempt 2: POST
//   - 226 / empty → wait ~4s (3000-6000ms), then retry
// - After all retries fail → fall back to twitterapi.io
//
// Error detection checks THREE layers:
// - HTTP status (!response.ok)
// - GraphQL errors array (body.errors)
// - Missing data (body.data.create_tweet null or empty tweet_results)
//
// IMPORTANT: Do NOT add `export const runtime = 'edge'` to any
// route file that uses this module — it requires Node.js runtime
// for fetch and Prisma.
//
// Header accuracy verified against:
// - fa0311/TwitterInternalAPIDocument (daily auto-updated Chrome captures)
// - fa0311/latest-user-agent (auto-updated Chrome UA strings)
// - fa0311/x-client-transaction-id-pair-dict (daily pre-computed pairs)
// ============================================================

// CreateTweet spec (queryId + features) is resolved via create-tweet-spec.ts.
// 5-step priority: memory → DB → GitHub placeholder.json → x.com JS → hardcoded.
// Never returns null. Bearer token must be set via Admin → X Settings.

// Chrome 148 on Linux — synced from fa0311/latest-user-agent
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

// Chrome Client Hints — matches the User-Agent above (Chrome 148 format)
const SEC_CH_UA = '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"'

/**
 * Batch-read all X-related settings from DB in one query.
 * Uses the shared readSettingsMap helper to avoid duplicating the
 * findMany→map→for→decryptSetting pattern.
 */
async function getSettings(): Promise<Record<string, string>> {
  return readSettingsMap(['x_cookie_string', 'x_query_id', 'x_bearer_token', 'post_method', 'twitterapi_keys', 'x_placeholder_json'])
}

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

// ── Error Classification ───────────────────────────────

/**
 * Classified error types from X API responses.
 * Used to drive retry logic and circuit breaker filtering.
 *
 * - stale_cache: X rotated queryId → clear caches and retry
 * - transient: Temporary issue (226, empty results) → retry with backoff
 * - auth_failure: Cookie/bearer expired → needs admin intervention
 * - rate_limit: X imposed rate limit → needs admin to wait
 * - stealth_ban: Account shadowbanned → needs admin to check account
 * - terminal: Unrecognized/unrecoverable error → no retry
 */
export type ErrorClass = 'stale_cache' | 'transient' | 'auth_failure' | 'rate_limit' | 'stealth_ban' | 'terminal'

/**
 * Table-driven error classifier. Replaces isStaleCacheError() + is226Error().
 * Adding new error patterns = adding 1 row to ERROR_PATTERNS. Zero CC increase.
 */
const ERROR_PATTERNS: [RegExp, ErrorClass][] = [
  [/code: 48|HTTP 404/, 'stale_cache'],
  [/HTTP 226|code: 226|might be automated/, 'transient'],
  [/HTTP 401|Could not authenticate/, 'auth_failure'],
  [/HTTP 429|code: 88|Rate limit exceeded/, 'rate_limit'],
  // Best-effort — not definitive. code: 64 is a hard suspension (not stealth),
  // code: 353 is poorly documented, and "suspended" may appear in non-ban messages.
  // Misclassifying as stealth_ban is safe: it just skips circuit-breaker retry,
  // which is the conservative (fail-open) failure mode.
  [/code: 353|suspended|code: 64/, 'stealth_ban'],
]

function classifyError(error: string): ErrorClass {
  for (const [pattern, cls] of ERROR_PATTERNS) {
    if (pattern.test(error)) return cls
  }
  return 'terminal'
}

/**
 * Detect empty tweet_results — X silently rejects the tweet.
 * V3: Always resolves on retry.
 * The response body has: {"create_tweet":{"tweet_results":{}}}
 * No error code, no HTTP error — just empty data.
 */
function isEmptyResults(body: unknown): boolean {
  const data = body as { data?: { create_tweet?: { tweet_results?: Record<string, unknown> } } } | null
  if (!data?.data?.create_tweet) return false
  const results = data.data.create_tweet.tweet_results
  // tweet_results exists but is empty object {} or null
  return !results || Object.keys(results).length === 0
}

/** Sleep helper for retry delays */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Shared types & constants (hoisted from postTweetViaCookie) ──

/** Result type for tweet posting operations */
export type TweetResult = {
  success: boolean
  tweetId?: string
  error?: string
  errorClass?: ErrorClass     // classified error type for circuit breaker filtering
  method: 'direct' | 'retry' | 'fallback_cookie' | 'fallback_login'
  retriesUsed?: number
}

/** Maximum direct posting attempts before falling back */
const MAX_DIRECT_ATTEMPTS = 4

/** Retry delay bases (ms) — indexed by failed attempt number */
const RETRY_DELAYS = [1000, 2000, 4000]

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
function buildCreateTweetHeaders(
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

// ── Module-level helpers (extracted from postTweetViaCookie) ──

/**
 * Wait after a failed attempt before trying again.
 * Randomized jitter prevents bot fingerprinting — real humans don't retry
 * at exact intervals. Each retry waits longer than the previous one.
 *   After attempt 0 fails: ~1s  (800-1500ms)
 *   After attempt 1 fails: ~2s  (1500-3000ms)
 *   After attempt 2 fails: ~4s  (3000-6000ms)
 */
async function waitBeforeRetry(failedAttempt: number): Promise<void> {
  const base = RETRY_DELAYS[failedAttempt] ?? 4000
  const jitter = Math.round(base * (0.8 + crypto.randomInt(501) / 1000)) // 80%-130%
  debug('direct', 'Attempt', failedAttempt, 'failed — waiting', jitter, 'ms before retry')
  await sleep(jitter)
  clearXactCache() // Fresh transaction ID for each retry
  clearPairCache() // Also clear pair-dict cache
}

/**
 * Try API fallback — Layer 2 (cookie API) first, then Layer 3 (V2 login) if enabled.
 * Used by both auto-mode (after direct fails) and api-only mode.
 *
 * BUG FIX (from closure extraction): The `text` field is the tweet content
 * to post. The old closure code at L244 called `tryApiFallback(text)` which
 * passed the tweet text as the `directError` parameter — leaking tweet
 * content into error messages. The named-opts interface makes this class
 * of mistake impossible: `text` and `directError` are clearly distinct.
 */
async function tryApiFallback(opts: {
  text: string
  directError?: string
  retriesUsed?: number
}): Promise<TweetResult> {
  const { text, directError, retriesUsed = 0 } = opts
  // Layer 2: Cookie-based API (300 credits)
  debug('direct', 'Trying Layer 2: Cookie API fallback')
  const cookieResult = await postViaCookieApi(text)
  if (cookieResult.success) {
    return {
      success: true,
      tweetId: cookieResult.tweetId,
      method: 'fallback_cookie',
      retriesUsed,
    }
  }

  debug('direct', 'Layer 2 failed:', cookieResult.error?.slice(0, 100))

  // Layer 3: V2 Login API (800 credits) — only if toggle is ON
  const v2Enabled = await isV2LoginEnabled()
  if (v2Enabled) {
    debug('direct', 'Trying Layer 3: V2 Login API fallback')
    const v2Result = await postViaTwitterApi(text)
    if (v2Result.success) {
      return {
        success: true,
        tweetId: v2Result.tweetId,
        method: 'fallback_login',
        retriesUsed,
      }
    }
    // Both layers failed
    const combinedError = directError
      ? `Direct gagal: ${directError.slice(0, 150)}. Cookie API gagal: ${cookieResult.error?.slice(0, 100)}. V2 Login gagal: ${v2Result.error?.slice(0, 100)}`
      : `Cookie API gagal: ${cookieResult.error?.slice(0, 150)}. V2 Login gagal: ${v2Result.error?.slice(0, 100)}`
    return {
      success: false,
      error: combinedError,
      method: v2Result.method,
      retriesUsed,
    }
  }

  // V2 login not enabled — return Layer 2 error
  const combinedError = directError
    ? `Direct gagal: ${directError.slice(0, 150)}. Cookie API juga gagal: ${cookieResult.error || 'Unknown error'}`
    : `Cookie API gagal: ${cookieResult.error || 'Unknown error'}`
  return {
    success: false,
    error: combinedError,
    method: cookieResult.method,
    retriesUsed,
  }
}

/**
 * Fallback or fail — used when direct posting fails in auto mode.
 * In direct mode, just returns the error.
 */
async function fallbackOrFail(opts: {
  text: string
  postMethod: string
  error: string
  errorClass?: ErrorClass
  method: 'direct' | 'retry'
  retriesUsed?: number
}): Promise<TweetResult> {
  const { text, postMethod, error, errorClass, method, retriesUsed = 0 } = opts
  if (postMethod !== 'auto') {
    return { success: false, error, errorClass, method, retriesUsed }
  }
  debug('direct', 'Direct posting failed, trying API fallback:', error.slice(0, 100))
  return tryApiFallback({ text, directError: error, retriesUsed })
}

// ── Main posting function ──

/**
 * Post a tweet to X using cookie-based authentication.
 *
 * Retry strategy (V6: delay right after failure, before next attempt):
 * - Attempt 0: Normal POST
 *   - Stale cache → clear caches, retry immediately (no delay)
 *   - 226 / empty → wait ~1s (800-1500ms), then retry
 * - Attempt 1: POST
 *   - 226 / empty → wait ~2s (1500-3000ms), then retry
 * - Attempt 2: POST
 *   - 226 / empty → wait ~4s (3000-6000ms), then retry
 * - After all retries fail → fall back to twitterapi.io (if post_method = 'auto')
 */
export async function postTweetViaCookie(
  text: string
): Promise<TweetResult> {
  // Input validation — prevent wasting retries on empty tweets
  if (!text || !text.trim()) {
    return { success: false, error: 'Empty tweet text', method: 'direct' }
  }

  // 1. Get all settings in one DB query (includes post_method)
  const settings = await getSettings()
  const postMethod = (settings.post_method === 'direct' || settings.post_method === 'api') ? settings.post_method : 'auto'

  // If API-only mode, skip direct posting entirely
  // Try Layer 2 (cookie API) first, then Layer 3 (V2 login) if enabled
  if (postMethod === 'api') {
    debug('direct', 'Post method is API-only, skipping direct post')
    return tryApiFallback({ text })
  }

  debug('direct', 'Post method:', postMethod)
  debug('direct', 'Settings loaded:', {
    has_cookie: !!settings.x_cookie_string,
    has_bearer: !!settings.x_bearer_token,
    has_query_id: !!settings.x_query_id,
    post_method: settings.post_method,
    has_api_keys: !!settings.twitterapi_keys,
  })

  // 2. Resolve cookie string: DB → env var → null
  const envCookie = process.env.X_COOKIE_STRING?.trim() || null
  const cookieString = settings.x_cookie_string || envCookie || null

  if (!cookieString) {
    return fallbackOrFail({ text, postMethod, error: 'Cookie string not configured. Go to Admin → X Settings to set it up.', method: 'direct' })
  }

  // 3. Parse cookies
  const cookies = parseXCookies(cookieString)
  debug('direct', 'Cookie parsed:', {
    has_auth_token: !!cookies.auth_token,
    has_ct0: !!cookies.ct0,
    has_twid: !!cookies.twid,
    cookie_length: cookies.raw.length,
  })
  if (!cookies.auth_token || !cookies.ct0 || !cookies.twid) {
    const missing = [
      !cookies.auth_token && 'auth_token',
      !cookies.ct0 && 'ct0',
      !cookies.twid && 'twid',
    ].filter(Boolean).join(', ')
    return fallbackOrFail({ text, postMethod, error: `Cookie string is missing ${missing}. Copy the full cookie string from your browser.`, method: 'direct' })
  }

  // 4. Resolve bearer token (required — no default)
  const bearerToken = settings.x_bearer_token || null
  if (!bearerToken) {
    return fallbackOrFail({ text, postMethod, error: 'x_bearer_token not set. Update in Admin → X Settings.', method: 'direct' })
  }

  // 5-7. Resolve queryId + features + make request + parse response
  // Retry loop: up to MAX_DIRECT_ATTEMPTS, delay happens right after each failure
  let lastError = ''

  // Resolve CreateTweet spec ONCE before the loop (re-resolve on stale cache retry)
  let spec = await getCreateTweetSpec(settings)

  for (let attempt = 0; attempt < MAX_DIRECT_ATTEMPTS; attempt++) {
    // On retry for stale cache: clear caches and re-resolve
    if (attempt === 1 && classifyError(lastError) === 'stale_cache') {
      await clearAllCaches()
      spec = await getCreateTweetSpec(settings)
    }

    const queryId = spec.queryId  // always defined — 5-step fallback guarantees non-null

    debug('direct', 'Attempt', attempt, '- queryId:', `${queryId.slice(0, 8)}...`)

    // Make the request
    try {
      const url = `https://x.com/i/api/graphql/${queryId}/CreateTweet`

      const variables = {
        tweet_text: text,
        dark_request: false,
        media: { media_entities: [], possibly_sensitive: false },
        semantic_annotation_ids: [],
      }

      // Generate x-client-transaction-id (X's primary anti-bot header)
      // Primary: pair-dict approach (0 x.com fetches, includes WebRTC SDP bytes)
      // Fallback: live SVG + cubic-bezier (3 x.com fetches, missing WebRTC bytes)
      const apiPath = `/i/api/graphql/${queryId}/CreateTweet`
      let transactionId: string | null = null
      transactionId = await generateTransactionIdFromPair('POST', apiPath)
      if (!transactionId) {
        debug('direct', 'Pair-dict failed, falling back to live SVG approach')
        try {
          transactionId = await generateTransactionId('POST', apiPath)
        } catch {
          // Non-fatal: if both methods fail, continue without transaction ID
        }
      }

      // Build headers — matches Chrome 148 on Linux per fa0311 captures
      const headers = buildCreateTweetHeaders(bearerToken, cookies.raw, cookies.ct0, transactionId)

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          variables,
          queryId,
          features: spec.features,
        }),
        signal: AbortSignal.timeout(15_000),
      })

      debug('direct', 'Attempt', attempt, '- X API response status:', response.status)

      // Layer 1: HTTP status
      if (!response.ok) {
        const errorText = await response.text()
        lastError = `X API returned HTTP ${response.status}: ${errorText.slice(0, 200)}`

        const ec = classifyError(lastError)
        // Stale cache → clear caches and retry (no delay needed)
        if (attempt === 0 && ec === 'stale_cache') {
          await clearAllCaches()
          continue
        }
        // Transient (226, etc.) → wait then retry
        if (attempt < MAX_DIRECT_ATTEMPTS - 1 && ec === 'transient') {
          await waitBeforeRetry(attempt)
          continue
        }

        // auth_failure, rate_limit, stealth_ban, terminal → don't retry, try fallback in auto mode
        return fallbackOrFail({ text, postMethod, error: lastError, errorClass: ec, method: attempt > 0 ? 'retry' : 'direct', retriesUsed: attempt })
      }

      const body = await response.json()
      debug('direct', 'Attempt', attempt, '- Response body keys:', Object.keys(body).join(','))

      // Layer 2: GraphQL errors array
      if (body.errors?.length) {
        const errorMessages = body.errors
          .map((e: { message: string; code?: number }) => `${e.message} (code: ${e.code || 'unknown'})`)
          .join('; ')
        lastError = `X GraphQL error: ${errorMessages}`

        const ec = classifyError(lastError)
        // Stale cache → clear caches and retry (no delay needed)
        if (attempt === 0 && ec === 'stale_cache') {
          await clearAllCaches()
          continue
        }
        // Transient (226, etc.) → wait then retry
        if (attempt < MAX_DIRECT_ATTEMPTS - 1 && ec === 'transient') {
          await waitBeforeRetry(attempt)
          continue
        }

        // auth_failure, rate_limit, stealth_ban, terminal → don't retry, try fallback in auto mode
        return fallbackOrFail({ text, postMethod, error: lastError, errorClass: ec, method: attempt > 0 ? 'retry' : 'direct', retriesUsed: attempt })
      }

      // Layer 3: Missing data / empty tweet_results
      const tweetId = body?.data?.create_tweet?.tweet_results?.result?.rest_id
      if (!tweetId) {
        // Check for empty tweet_results — X silently rejected the tweet
        if (isEmptyResults(body)) {
          lastError = 'Empty tweet_results — X silently rejected the tweet'
          if (attempt < MAX_DIRECT_ATTEMPTS - 1) {
            await waitBeforeRetry(attempt)
            continue
          }
          // Last attempt — transient error
          return fallbackOrFail({ text, postMethod, error: lastError, errorClass: 'transient', method: attempt > 0 ? 'retry' : 'direct', retriesUsed: attempt })
        }

        return fallbackOrFail({ text, postMethod, error: `Tweet was not created. Response: ${JSON.stringify(body).slice(0, 300)}`, errorClass: 'terminal', method: attempt > 0 ? 'retry' : 'direct', retriesUsed: attempt })
      }

      // Success!
      debug('direct', 'Attempt', attempt, '- Tweet posted! tweetId:', tweetId)
      return {
        success: true,
        tweetId,
        method: attempt > 0 ? 'retry' : 'direct',
        retriesUsed: attempt,
      }
    } catch (error) {
      lastError = `Network error: ${error instanceof Error ? error.message : String(error)}`
      // Network errors are transient — wait then retry
      if (attempt < MAX_DIRECT_ATTEMPTS - 1) {
        await waitBeforeRetry(attempt)
        continue
      }

      // All retries exhausted on network errors — try fallback in auto mode
      return fallbackOrFail({ text, postMethod, error: lastError, errorClass: 'transient', method: attempt > 0 ? 'retry' : 'direct', retriesUsed: attempt })
    }
  }

  // All direct retries exhausted — try API fallback (if auto mode)
  if (postMethod === 'auto') {
    debug('direct', 'All retries exhausted, falling back to API')
    return tryApiFallback({ text, directError: lastError, retriesUsed: MAX_DIRECT_ATTEMPTS })
  }

  // Direct mode only — no fallback
  return {
    success: false,
    error: `Post gagal setelah ${MAX_DIRECT_ATTEMPTS} percobaan. Coba lagi dalam 1-2 menit atau ubah ke mode Auto untuk fallback API.`,
    method: 'retry',
    retriesUsed: MAX_DIRECT_ATTEMPTS,
  }
}

/**
 * Check if cookie auth is configured and return status info.
 * Used by the admin dashboard to show connection status.
 * "Configured" means the required values are set: cookie string (must contain auth_token, ct0, twid) and bearer token.
 * queryId is optional (auto-fetched at post time), but tracked in `missing`
 * so admins know it's not stored as a fallback.
 */
export async function getCookieAuthStatus(): Promise<{
  configured: boolean
  source: 'database' | 'env_var' | null
  lastUpdated: Date | null
  missing: string[]
}> {
  const settings = await getSettings()
  const missing: string[] = []

  const hasCookie = !!(settings.x_cookie_string || process.env.X_COOKIE_STRING?.trim())
  const hasBearer = !!settings.x_bearer_token
  const hasQueryId = !!settings.x_query_id

  // Cookie (auth_token + ct0 + twid) and bearer are required; queryId is auto-fetched but tracked
  if (!hasCookie) missing.push('x_cookie_string')
  if (!hasBearer) missing.push('x_bearer_token')
  if (!hasQueryId) missing.push('x_query_id')

  // "Configured" = can post (cookie + bearer present; queryId auto-fetched)
  const configured = hasCookie && hasBearer

  if (configured) {
    // Need updatedAt — targeted query for just the timestamp
    const dbSetting = await db.setting.findUnique({
      where: { key: 'x_cookie_string' },
      select: { updatedAt: true },
    })
    return {
      configured: true,
      source: settings.x_cookie_string ? 'database' : 'env_var',
      lastUpdated: dbSetting?.updatedAt ?? null,
      missing: hasQueryId ? [] : ['x_query_id'],
    }
  }

  return { configured: false, source: null, lastUpdated: null, missing }
}

/**
 * Clear all caches (in-memory + DB + transaction ID + pair-dict).
 * Useful when X updates their frontend and cached data becomes stale.
 * Exposed via Admin → X Settings → "Clear Cache" button.
 * Deleting DB rows forces a fresh GitHub fetch on next post.
 */
export async function clearAllCaches(): Promise<void> {
  clearCreateTweetSpecCache()
  clearXactCache()
  clearPairCache()
  try {
    await db.setting.deleteMany({
      where: { key: { in: ['x_placeholder_json', 'x_query_id'] } }
    })
  } catch { /* non-fatal: DB may be unavailable */ }
}
