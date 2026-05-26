import crypto from 'crypto'
import { db } from '@/lib/db'
import { clearTransactionIdCache as clearXactCache } from '@/lib/x-transaction-id'
import { clearPairCache } from '@/lib/x-transaction-id-pair'
import { postViaCookieApi, postViaTwitterApi, isV2LoginEnabled } from '@/lib/twitter-api-fallback'
import { readSettingsMap, X_DIRECT_SETTINGS_KEYS } from '@/lib/twitter-api-shared'
import { getCreateTweetSpec, clearCreateTweetSpecCache } from '@/lib/create-tweet-spec'
import { debug } from '@/lib/debug'

// From new split files
import {
  type ErrorClass,
  type TweetResult,
  classifyError,
  parseDirectPostResponse,
  shouldRetry,
  MAX_DIRECT_ATTEMPTS,
} from '@/lib/twitter-post-error'
import {
  parseXCookies,
  buildCreateTweetHeaders,
  resolveTransactionId,
} from '@/lib/twitter-post-request'

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

/**
 * Batch-read all X-related settings from DB in one query.
 * Uses the shared readSettingsMap helper to avoid duplicating the
 * findMany→map→for→decryptSetting pattern.
 */
async function getSettings(): Promise<Record<string, string>> {
  return readSettingsMap(X_DIRECT_SETTINGS_KEYS)
}

/** Sleep helper for retry delays */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Shared constants (hoisted from postTweetViaCookie) ──

/** Retry delay bases (ms) — indexed by failed attempt number */
const RETRY_DELAYS = [1000, 2000, 4000]

// ── Module-level helpers ──

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
  directErrorClass?: ErrorClass
  retriesUsed?: number
}): Promise<TweetResult> {
  const { text, directError, directErrorClass, retriesUsed = 0 } = opts
  // Layer 2: Cookie-based API (300 credits)
  debug('direct', 'Trying Layer 2: Cookie API fallback')
  const cookieResult = await postViaCookieApi(text)
  if (cookieResult.success) {
    return {
      success: true,
      ...(cookieResult.tweetId != null && { tweetId: cookieResult.tweetId }),
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
        ...(v2Result.tweetId != null && { tweetId: v2Result.tweetId }),
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
      ...(directErrorClass != null && { errorClass: directErrorClass }),
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
    ...(directErrorClass != null && { errorClass: directErrorClass }),
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
    return { success: false, error, ...(errorClass != null && { errorClass }), method, retriesUsed }
  }
  debug('direct', 'Direct posting failed, trying API fallback:', error.slice(0, 100))
  return tryApiFallback({ text, directError: error, ...(errorClass != null && { directErrorClass: errorClass }), retriesUsed })
}

// ── Main posting function ──

/** Map attempt number to method label — eliminates 5 repeated ternaries */
function methodLabel(attempt: number): 'direct' | 'retry' {
  return attempt > 0 ? 'retry' : 'direct'
}

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
  // Input validation — prevent wasting retries on empty tweets.
  // Uses 'auth_failure' (not 'terminal') so the circuit breaker skips it — empty tweets
  // are an application-level guard, not an X API failure. Tripping the breaker on app
  // bugs would pause ALL auto-posting, which is disproportionate.
  if (!text || !text.trim()) {
    return { success: false, error: 'Empty tweet text', method: 'direct', errorClass: 'auth_failure' }
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
    return fallbackOrFail({ text, postMethod, error: 'Cookie string not configured. Go to Admin → X Settings to set it up.', errorClass: 'auth_failure', method: 'direct' })
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
    return fallbackOrFail({ text, postMethod, error: `Cookie string is missing ${missing}. Copy the full cookie string from your browser.`, errorClass: 'auth_failure', method: 'direct' })
  }

  // 4. Resolve bearer token (required — no default)
  const bearerToken = settings.x_bearer_token || null
  if (!bearerToken) {
    return fallbackOrFail({ text, postMethod, error: 'x_bearer_token not set. Update in Admin → X Settings.', errorClass: 'auth_failure', method: 'direct' })
  }

  // 5-7. Resolve queryId + features + make request + parse response
  // Retry loop: up to MAX_DIRECT_ATTEMPTS, delay happens right after each failure
  let lastError = ''
  let lastErrorClass: ErrorClass | undefined

  // Resolve CreateTweet spec ONCE before the loop (re-resolve on stale cache retry)
  let spec = await getCreateTweetSpec(settings)

  for (let attempt = 0; attempt < MAX_DIRECT_ATTEMPTS; attempt++) {
    // On retry for stale cache: clear caches and re-resolve
    if (attempt === 1 && classifyError(lastError) === 'stale_cache') {
      await clearAllCaches()
      delete settings['x_placeholder_json'] // Force step-2 miss so getCreateTweetSpec falls through to GitHub fetch
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
      const apiPath = `/i/api/graphql/${queryId}/CreateTweet`
      const transactionId = await resolveTransactionId(apiPath)

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

      // ── HTTP error ──
      if (!response.ok) {
        const errorText = await response.text()
        lastError = `X API returned HTTP ${response.status}: ${errorText.slice(0, 200)}`

        const ec = classifyError(lastError)
        lastErrorClass = ec
        const decision = shouldRetry(attempt, ec)
        if (decision === 'clear_and_continue') {
          await clearAllCaches()
          delete settings['x_placeholder_json'] // Force step-2 miss so getCreateTweetSpec falls through to GitHub fetch
          spec = await getCreateTweetSpec(settings)
          continue
        }
        if (decision === 'continue') {
          await waitBeforeRetry(attempt)
          continue
        }
        return fallbackOrFail({ text, postMethod, error: lastError, errorClass: ec, method: methodLabel(attempt), retriesUsed: attempt })
      }

      // ── Success or classified error ──
      const body = await response.json()
      debug('direct', 'Attempt', attempt, '- Response body keys:', Object.keys(body).join(','))

      const outcome = parseDirectPostResponse(body)

      if (outcome.kind === 'success') {
        debug('direct', 'Attempt', attempt, '- Tweet posted! tweetId:', outcome.tweetId)
        return { success: true, tweetId: outcome.tweetId, method: methodLabel(attempt), retriesUsed: attempt }
      }

      if (outcome.kind === 'empty_results') {
        lastError = 'Empty tweet_results — X silently rejected the tweet'
        lastErrorClass = 'transient'
        if (attempt < MAX_DIRECT_ATTEMPTS - 1) {
          await waitBeforeRetry(attempt)
          continue
        }
        return fallbackOrFail({ text, postMethod, error: lastError, errorClass: 'transient', method: methodLabel(attempt), retriesUsed: attempt })
      }

      if (outcome.kind === 'graphql_error') {
        lastError = outcome.error
        lastErrorClass = outcome.errorClass
        const decision = shouldRetry(attempt, outcome.errorClass)
        if (decision === 'clear_and_continue') {
          await clearAllCaches()
          delete settings['x_placeholder_json'] // Force step-2 miss so getCreateTweetSpec falls through to GitHub fetch
          spec = await getCreateTweetSpec(settings)
          continue
        }
        if (decision === 'continue') {
          await waitBeforeRetry(attempt)
          continue
        }
        return fallbackOrFail({ text, postMethod, error: lastError, errorClass: outcome.errorClass, method: methodLabel(attempt), retriesUsed: attempt })
      }

      // unknown_failure
      lastError = `Tweet was not created. Response: ${JSON.stringify(outcome.body).slice(0, 300)}`
      lastErrorClass = 'terminal'
      return fallbackOrFail({ text, postMethod, error: lastError, errorClass: 'terminal', method: methodLabel(attempt), retriesUsed: attempt })
    } catch (error) {
      lastError = `Network error: ${error instanceof Error ? error.message : String(error)}`
      lastErrorClass = 'transient'
      // Network errors are transient — wait then retry
      if (attempt < MAX_DIRECT_ATTEMPTS - 1) {
        await waitBeforeRetry(attempt)
        continue
      }

      // All retries exhausted on network errors — try fallback in auto mode
      return fallbackOrFail({ text, postMethod, error: lastError, errorClass: 'transient', method: methodLabel(attempt), retriesUsed: attempt })
    }
  }

  // All direct retries exhausted — try API fallback (if auto mode)
  if (postMethod === 'auto') {
    debug('direct', 'All retries exhausted, falling back to API')
    return tryApiFallback({ text, directError: lastError, ...(lastErrorClass != null && { directErrorClass: lastErrorClass }), retriesUsed: MAX_DIRECT_ATTEMPTS })
  }

  // Direct mode only — no fallback
  return {
    success: false,
    error: `Post gagal setelah ${MAX_DIRECT_ATTEMPTS} percobaan. Coba lagi dalam 1-2 menit atau ubah ke mode Auto untuk fallback API.`,
    ...(lastErrorClass != null && { errorClass: lastErrorClass }),
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
