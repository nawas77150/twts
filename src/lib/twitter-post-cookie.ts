import { db } from '@/lib/db'
import { generateTransactionId, fetchXcomHtml, clearTransactionIdCache as clearXactCache } from '@/lib/x-transaction-id'

// ============================================================
// Cookie-based tweet posting via X's internal GraphQL API
//
// This uses X's internal CreateTweet endpoint — the same one
// the x.com web client uses. Cost: $0. No paid API needed.
//
// How it works:
// 1. Read cookie string from DB → env var → null
// 2. Parse auth_token and ct0 from the cookie string
// 3. Resolve queryId: in-memory cache → DB → live fetch → DB fallback
// 4. Read bearer token from DB (required, no default)
// 5. POST to X GraphQL CreateTweet with Chrome-matching headers
// 6. Parse response with comprehensive error checking
//
// Error detection checks THREE layers:
// - HTTP status (!response.ok)
// - GraphQL errors array (body.errors)
// - Missing data (body.data.create_tweet null)
//
// IMPORTANT: Do NOT add `export const runtime = 'edge'` to any
// route file that uses this module — it requires Node.js runtime
// for fetch and Prisma.
//
// Header accuracy verified against:
// - X's live JS bundle (main.05927b2a.js)
// - TwitterInternalAPIDocument (daily auto-updated Chrome captures)
// - emusks reverse-engineering project (npm)
// ============================================================

// No hardcoded defaults for queryId or bearer token.
// queryId is auto-fetched from X's live JS bundle (with in-memory + DB cache).
// bearer token must be set via Admin → X Settings. Stale defaults cause
// silent 404s that are hard to debug. Explicit configuration = clear errors.

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'

// Chrome Client Hints — matches the User-Agent above (Chrome 144 format)
const SEC_CH_UA = '"Chromium";v="144", "Not;A=Brand";v="24", "Google Chrome";v="144"'

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
      { headers: { 'User-Agent': BROWSER_UA } }
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
 * Empty values are filtered out so they don't shadow env vars or defaults.
 */
async function getSettings(): Promise<Record<string, string>> {
  const settings = await db.setting.findMany({
    where: {
      key: { in: ['x_cookie_string', 'x_query_id', 'x_bearer_token'] },
      value: { not: '' },
    },
  })
  const map: Record<string, string> = {}
  for (const s of settings) {
    if (s.value) map[s.key] = s.value
  }
  return map
}

/**
 * Parse the full cookie string from the browser.
 * Extracts auth_token and ct0 which are required for X API calls.
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
  raw: string
} {
  const auth_token = cookieString.match(/auth_token=([^;]+)/)?.[1] || null
  const ct0 = cookieString.match(/ct0=([^;]+)/)?.[1] || null
  return { auth_token, ct0, raw: cookieString }
}

/**
 * Post a tweet to X using cookie-based authentication.
 */
export async function postTweetViaCookie(
  text: string
): Promise<{ success: boolean; tweetId?: string; error?: string; method: 'cookie' }> {
  // 1. Get all settings in one DB query
  const settings = await getSettings()

  // 2. Resolve cookie string: DB → env var → null
  const envCookie = process.env.X_COOKIE_STRING?.trim() || null
  const cookieString = settings.x_cookie_string || envCookie || null

  if (!cookieString) {
    return {
      success: false,
      error: 'Cookie string not configured. Go to Admin → X Settings to set it up.',
      method: 'cookie',
    }
  }

  // 3. Parse cookies
  const cookies = parseXCookies(cookieString)
  if (!cookies.auth_token || !cookies.ct0) {
    return {
      success: false,
      error:
        'Cookie string is missing auth_token or ct0. Copy the full cookie string from your browser.',
      method: 'cookie',
    }
  }

  // 4. Resolve queryId: in-memory cache → live fetch → DB fallback
  let queryId = await fetchLiveQueryId()

  if (queryId && queryId !== settings.x_query_id) {
    // Auto-update DB with fresh value so cold starts can skip the live fetch
    await db.setting.upsert({
      where: { key: 'x_query_id' },
      update: { value: queryId },
      create: { key: 'x_query_id', value: queryId },
    })
  }

  // Fall back to DB if live fetch failed
  queryId = queryId || settings.x_query_id || null
  if (!queryId) {
    return {
      success: false,
      error: 'x_query_id not set and live fetch failed. Check network or set manually in Admin → X Settings.',
      method: 'cookie',
    }
  }

  // 5. Resolve bearer token (required — no default)
  const bearerToken = settings.x_bearer_token || null
  if (!bearerToken) {
    return {
      success: false,
      error: 'x_bearer_token not set. Update in Admin → X Settings.',
      method: 'cookie',
    }
  }

  // 6. Make the request
  try {
    const url = `https://twitter.com/i/api/graphql/${queryId}/CreateTweet`

    const variables = {
      tweet_text: text,
      dark_request: false,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: [],
    }

    // Feature switches — synced from X's main.05927b2a.js on 2025-07-19
    // + TwitterInternalAPIDocument (daily auto-updated Chrome captures).
    //
    // Grok flags updated: 7 flags changed from false → true.
    // Having ALL Grok features disabled was a suspicious pattern — Grok is
    // X's flagship AI product and virtually all modern accounts have it enabled.
    // Values sourced from TwitterInternalAPIDocument's Chrome DevTools captures.
    //
    // When queryId 404s, this list may also need updating.
    // Step 1 — get current bundle name (changes every X deploy):
    //   curl -sL 'https://x.com' | grep -oP 'main\.[a-z0-9]+\.js' | head -1
    // Step 2 — extract CreateTweet metadata from that bundle:
    //   curl -sL 'https://abs.twimg.com/responsive-web/client-web/<BUNDLE>.js' | grep -oP 'CreateTweet.*?fieldToggles:\[.*?\]'
    const features = {
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
      graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
      view_counts_everywhere_api_enabled: true,
      longform_notetweets_consumption_enabled: true,
      responsive_web_twitter_article_tweet_consumption_enabled: true,
      content_disclosure_indicator_enabled: true,
      content_disclosure_ai_generated_indicator_enabled: true,
      responsive_web_grok_show_grok_translated_post: true,
      responsive_web_grok_analysis_button_from_backend: true,
      post_ctas_fetch_enabled: false,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: false,   // TwitterInternalAPIDocument: false
      profile_label_improvements_pcf_label_in_post_enabled: true,
      responsive_web_profile_redirect_enabled: false,
      rweb_tipjar_consumption_enabled: false,   // TwitterInternalAPIDocument: false
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
      responsive_web_enhance_cards_enabled: false,
    }

    // Generate x-client-transaction-id (X's primary anti-bot header)
    const apiPath = `/i/api/graphql/${queryId}/CreateTweet`
    let transactionId: string | null = null
    try {
      transactionId = await generateTransactionId('POST', apiPath)
    } catch {
      // Non-fatal: if transaction ID generation fails, continue without it
    }

    // Build headers — matches real Chrome browser request structure
    // Verified against Chrome DevTools captures + emusks + TwitterInternalAPIDocument
    //
    // DO NOT add headers that real Chrome doesn't send — X can detect
    // non-standard headers (like x-client-uuid, x-xp-forwarded-for)
    // as bot signals. See Phase 1 analysis for details.
    const headers: Record<string, string> = {
      Authorization: `Bearer ${bearerToken}`,
      Cookie: cookies.raw,
      'X-Csrf-Token': cookies.ct0,
      'Content-Type': 'application/json',
      'X-Twitter-Auth-Type': 'OAuth2Session',
      'X-Twitter-Active-User': 'yes',
      'X-Twitter-Client-Language': 'en',
      'User-Agent': BROWSER_UA,
      Referer: 'https://x.com/',
      // Chrome Client Hints — every Chromium browser sends these
      'sec-ch-ua': SEC_CH_UA,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      // Origin — required by Fetch spec for POST with application/json
      // (even same-origin). Missing Origin is impossible from a real browser.
      origin: 'https://x.com',
      // Fetch Metadata — standard browser behavior
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      // Additional Chrome headers (verified present in emusks)
      'sec-gpc': '1',
      'priority': 'u=1, i',
      // Standard HTTP headers
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    }

    // Add x-client-transaction-id (non-fatal if generation fails)
    if (transactionId) {
      headers['x-client-transaction-id'] = transactionId
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        variables,
        queryId,  // Required by X's GraphQL schema — must match URL path
        features,
        // NOTE: fieldToggles intentionally omitted.
        // Real Chrome does NOT send fieldToggles for CreateTweet
        // (confirmed by twitter-openapi Chrome captures + emusks + twikit).
        // Sending it was a bot signal.
      }),
    })

    // Layer 1: HTTP status
    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `X API returned HTTP ${response.status}: ${errorText.slice(0, 200)}`,
        method: 'cookie',
      }
    }

    const body = await response.json()

    // Layer 2: GraphQL errors array
    // Common error codes:
    //   32  → Could not authenticate you (bad/expired token)
    //   131 → Internal error (possibly bad queryId)
    //   48  → Endpoint retired (queryId outdated)
    //   88  → Rate limit exceeded
    //   344 → Bot detection / daily tweet limit (may not be a real limit)
    if (body.errors?.length) {
      const errorMessages = body.errors
        .map((e: { message: string; code?: number }) => `${e.message} (code: ${e.code || 'unknown'})`)
        .join('; ')
      return {
        success: false,
        error: `X GraphQL error: ${errorMessages}`,
        method: 'cookie',
      }
    }

    // Layer 3: Missing data (tweet wasn't created)
    const tweetId = body?.data?.create_tweet?.tweet_results?.result?.rest_id
    if (!tweetId) {
      return {
        success: false,
        error: `Tweet was not created. Response: ${JSON.stringify(body).slice(0, 300)}`,
        method: 'cookie',
      }
    }

    // Success!
    return { success: true, tweetId, method: 'cookie' }
  } catch (error) {
    return {
      success: false,
      error: `Network error: ${error instanceof Error ? error.message : String(error)}`,
      method: 'cookie',
    }
  }
}

/**
 * Check if cookie auth is configured and return status info.
 * Used by the admin dashboard to show connection status.
 * "Configured" means the two required values are set: cookie and bearer.
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

  // Cookie and bearer are required; queryId is auto-fetched but tracked
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
}
