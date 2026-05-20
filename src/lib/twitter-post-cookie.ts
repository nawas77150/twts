import crypto from 'crypto'
import { db } from '@/lib/db'
import { upsertSetting } from '@/lib/db-helpers'
import { generateTransactionId, fetchXcomHtml, clearTransactionIdCache as clearXactCache } from '@/lib/x-transaction-id'
import { generateTransactionIdFromPair, clearPairCache } from '@/lib/x-transaction-id-pair'
import { postViaCookieApi, postViaTwitterApi, isV2LoginEnabled } from '@/lib/twitter-api-fallback'
import { readSettingsMap } from '@/lib/twitter-api-shared'
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
// 3. Resolve queryId: in-memory cache → DB → live fetch → DB fallback
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

// No hardcoded defaults for queryId or bearer token.
// queryId is auto-fetched from X's live JS bundle (with in-memory + DB cache).
// bearer token must be set via Admin → X Settings. Stale defaults cause
// silent 404s that are hard to debug. Explicit configuration = clear errors.

// Chrome 148 on Linux — synced from fa0311/latest-user-agent
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

// Chrome Client Hints — matches the User-Agent above (Chrome 148 format)
const SEC_CH_UA = '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"'

// --- Query ID Cache ---
// In-memory cache avoids re-fetching X's homepage + JS bundle on every post.
// On Vercel cold starts this resets, but the DB upsert (below) serves as the
// persistent fallback. The in-memory cache only helps during warm instances
// (burst posting), while the DB is the effective cache for cold starts.
let cachedQueryId: string | null = null
let cachedQueryIdTime: number = 0
const QUERY_ID_CACHE_TTL = 4 * 60 * 60 * 1000 // 4 hours — matches x-transaction-id.ts

/**
 * Auto-fetch the current CreateTweet queryId from X's live JS bundle.
 * Steps:
 *   1. Check in-memory cache (warm instance optimization)
 *   2. Fetch x.com HTML → extract main bundle filename (e.g. main.05927b2a.js)
 *   3. Fetch that bundle → extract queryId from CreateTweet operation definition
 *
 * If X changes their bundle structure, this silently returns null and
 * postTweetViaCookie falls back to the DB-stored value.
 *
 * Cache strategy: in-memory (4h TTL) + DB upsert (persistent across cold starts).
 * This minimizes requests to X's servers — fetching the homepage + JS bundle
 * before every tweet is a bot fingerprint pattern that real browsers don't exhibit.
 */
async function fetchLiveQueryId(): Promise<string | null> {
  // Check in-memory cache first (only helps during warm instances)
  const now = Date.now()
  if (cachedQueryId && now - cachedQueryIdTime < QUERY_ID_CACHE_TTL) {
    return cachedQueryId
  }

  try {
    // Step 1: get current bundle name from x.com homepage (shared cache)
    const html = await fetchXcomHtml()

    const bundle = html.match(/main\.[a-z0-9]+\.js/)?.[0]
    if (!bundle) return null

    // Step 2: extract queryId from the bundle JS
    const js = await fetch(
      `https://abs.twimg.com/responsive-web/client-web/${bundle}`,
      { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(10_000) }
    ).then((r) => r.text())

    // Match pattern like: {queryId:"FtGeaqS11k1UG-kGv_YUVg",operationName:"CreateTweet"}
    const match = js.match(
      /([A-Za-z0-9_-]{15,35})",operationName:"CreateTweet"/
    )

    const result = match?.[1] ?? null

    // Update in-memory cache
    if (result) {
      cachedQueryId = result
      cachedQueryIdTime = now
    }

    return result
  } catch {
    return null
  }
}

/**
 * Batch-read all X-related settings from DB in one query.
 * Uses the shared readSettingsMap helper to avoid duplicating the
 * findMany→map→for→decryptSetting pattern.
 */
async function getSettings(): Promise<Record<string, string>> {
  return readSettingsMap(['x_cookie_string', 'x_query_id', 'x_bearer_token', 'post_method', 'twitterapi_keys'])
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

/**
 * Detect errors likely caused by stale cached data.
 * When X updates their frontend, cached queryIds and transaction ID
 * configs become stale, causing 404s or code 48/344 errors.
 * Auto-clearing cache and retrying once avoids manual intervention.
 */
function isStaleCacheError(error: string): boolean {
  return (
    error.includes('code: 48') ||   // Endpoint retired — stale queryId
    error.includes('HTTP 404')       // Not found — stale queryId in URL
  )
}

/**
 * Detect Error 226 — X's transient anti-automation check.
 * V2: Always resolves on retry with 2-3s delay.
 * V4: Only affects CreateTweet, not reads.
 * V5: Clean residential proxies help reduce frequency.
 */
function is226Error(error: string): boolean {
  return (
    error.includes('HTTP 226') ||
    error.includes('code: 226') ||
    error.includes('This request looks like it might be automated')
  )
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
  method: 'direct' | 'retry' | 'fallback_cookie' | 'fallback_login'
  retriesUsed?: number
}

/** Maximum direct posting attempts before falling back */
const MAX_DIRECT_ATTEMPTS = 4

/** Retry delay bases (ms) — indexed by failed attempt number */
const RETRY_DELAYS = [1000, 2000, 4000]

// Feature switches — synced from fa0311/TwitterInternalAPIDocument
// develop branch (auto-updated daily). Last synced: 2025-07
const CREATE_TWEET_FEATURES = {
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: false,
  rweb_cashtags_composer_attachment_enabled: false,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  rweb_conversational_replies_downvote_enabled: false,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  responsive_web_enhance_cards_enabled: false,
  post_ctas_fetch_enabled: false,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  articles_preview_enabled: true,
  rweb_cashtags_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
}

// Field toggles — required by X's CreateTweet endpoint since 2025.
// Source: fa0311/TwitterInternalAPIDocument
const CREATE_TWEET_FIELD_TOGGLES = {
  withArticleRichContentState: true,
  withArticlePlainText: true,
  withArticleSummaryText: true,
  withArticleVoiceOver: true,
  withGrokAnalyze: true,
  withDisallowedReplyControls: true,
  withPayments: true,
  withAuxiliaryUserLabels: true,
}

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
  method: 'direct' | 'retry'
  retriesUsed?: number
}): Promise<TweetResult> {
  const { text, postMethod, error, method, retriesUsed = 0 } = opts
  if (postMethod !== 'auto') {
    return { success: false, error, method, retriesUsed }
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

  // 5-7. Resolve queryId + make request + parse response
  // Retry loop: up to MAX_DIRECT_ATTEMPTS, delay happens right after each failure
  let lastError = ''

  for (let attempt = 0; attempt < MAX_DIRECT_ATTEMPTS; attempt++) {
    // On retry for stale cache: clear caches immediately (no delay needed)
    if (attempt === 1 && isStaleCacheError(lastError)) {
      clearAllCaches()
    }

    // Resolve queryId: in-memory cache → live fetch → DB fallback
    let queryId = await fetchLiveQueryId()

    debug('direct', 'Attempt', attempt, '- queryId:', queryId ? `${queryId.slice(0, 8)}...` : '(null, will try DB)')

    if (queryId && queryId !== settings.x_query_id) {
      try {
        await upsertSetting('x_query_id', queryId)
      } catch {
        // Non-fatal: cache update failed, but we can still use the queryId for this request
      }
    }

    queryId = queryId || settings.x_query_id || null
    if (!queryId) {
      return fallbackOrFail({ text, postMethod, error: 'x_query_id not set and live fetch failed. Check network or set manually in Admin → X Settings.', method: 'direct' })
    }

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
          features: CREATE_TWEET_FEATURES,
          fieldToggles: CREATE_TWEET_FIELD_TOGGLES,
        }),
        signal: AbortSignal.timeout(15_000),
      })

      debug('direct', 'Attempt', attempt, '- X API response status:', response.status)

      // Layer 1: HTTP status
      if (!response.ok) {
        const errorText = await response.text()
        lastError = `X API returned HTTP ${response.status}: ${errorText.slice(0, 200)}`

        // Stale cache → clear caches and retry (no delay needed)
        if (attempt === 0 && isStaleCacheError(lastError)) {
          clearAllCaches()
          continue
        }
        // 226 → wait then retry
        if (attempt < MAX_DIRECT_ATTEMPTS - 1 && is226Error(lastError)) {
          await waitBeforeRetry(attempt)
          continue
        }

        // Other HTTP errors — don't retry (auth, rate limit, etc.), try fallback in auto mode
        return fallbackOrFail({ text, postMethod, error: lastError, method: attempt > 0 ? 'retry' : 'direct', retriesUsed: attempt })
      }

      const body = await response.json()
      debug('direct', 'Attempt', attempt, '- Response body keys:', Object.keys(body).join(','))

      // Layer 2: GraphQL errors array
      if (body.errors?.length) {
        const errorMessages = body.errors
          .map((e: { message: string; code?: number }) => `${e.message} (code: ${e.code || 'unknown'})`)
          .join('; ')
        lastError = `X GraphQL error: ${errorMessages}`

        // Stale cache → clear caches and retry (no delay needed)
        if (attempt === 0 && isStaleCacheError(lastError)) {
          clearAllCaches()
          continue
        }
        // 226 in GraphQL errors → wait then retry
        if (attempt < MAX_DIRECT_ATTEMPTS - 1 && is226Error(lastError)) {
          await waitBeforeRetry(attempt)
          continue
        }

        // Non-retryable GraphQL error — try fallback in auto mode
        return fallbackOrFail({ text, postMethod, error: lastError, method: attempt > 0 ? 'retry' : 'direct', retriesUsed: attempt })
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
        }

        return fallbackOrFail({ text, postMethod, error: `Tweet was not created. Response: ${JSON.stringify(body).slice(0, 300)}`, method: attempt > 0 ? 'retry' : 'direct', retriesUsed: attempt })
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
      return fallbackOrFail({ text, postMethod, error: lastError, method: attempt > 0 ? 'retry' : 'direct', retriesUsed: attempt })
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
 * Clear all in-memory caches (queryId + transaction ID + HTML).
 * Useful when X updates their frontend and cached data becomes stale.
 * Exposed via Admin → X Settings → "Clear Cache" button.
 */
export function clearAllCaches(): void {
  cachedQueryId = null
  cachedQueryIdTime = 0
  clearXactCache()
  clearPairCache()
}
