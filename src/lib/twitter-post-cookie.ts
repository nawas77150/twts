import { db } from '@/lib/db'

// ============================================================
// Cookie-based tweet posting via X's internal GraphQL API
//
// This uses X's internal CreateTweet endpoint — the same one
// the x.com web client uses. Cost: $0. No paid API needed.
//
// How it works:
// 1. Read cookie string from DB → env var → null
// 2. Parse auth_token and ct0 from the cookie string
// 3. Read queryId from DB → default
// 4. Read bearer token from DB → default
// 5. POST to X GraphQL CreateTweet
// 6. Parse response with comprehensive error checking
//
// Error detection checks THREE layers:
// - HTTP status (!response.ok)
// - GraphQL errors array (body.errors)
// - Missing data (body.data.create_tweet null)
//
// IMPORTANT: Do NOT add `export const runtime = 'edge'` to any
// route file that uses this module — it requires Node.js runtime
// for crypto, fetch, and Prisma.
// ============================================================

// Default queryId for CreateTweet.
// This changes when X updates their frontend (every 2-8 weeks).
// When it breaks, get the new one from browser DevTools → Network →
// post a tweet → find the CreateTweet request URL → copy the queryId.
const DEFAULT_QUERY_ID = 'zDI0bdpYOclPaXNFJkCSKw'

// X's public "consumer" Bearer token — the same one the x.com web
// client uses. It's not secret and doesn't change frequently, but
// should be updatable from the admin UI if requests start returning 401.
const DEFAULT_BEARER_TOKEN =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

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

  // 4. Resolve queryId: DB → default
  const queryId = settings.x_query_id || DEFAULT_QUERY_ID

  // 5. Resolve bearer token: DB → default
  const bearerToken = settings.x_bearer_token || DEFAULT_BEARER_TOKEN

  // 6. Make the request
  try {
    const url = `https://x.com/i/api/graphql/${queryId}/CreateTweet`

    const variables = {
      tweet_text: text,
      dark_request: false,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: [],
    }

    const features = {
      communities_web_enable_tweet_community_results_fetch: true,
      c9s_tweet_anatomy_moderator_badge_enabled: true,
      tweetypie_unmention_optimization_enabled: true,
      responsive_web_edit_tweet_api_enabled: true,
      graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
      view_counts_everywhere_api_enabled: true,
      longform_notetweets_consumption_enabled: true,
      responsive_web_twitter_article_tweet_consumption_enabled: true,
      tweet_awards_web_tipping_enabled: false,
      creator_subscriptions_quote_tweet_preview_enabled: false,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: true,
      articles_preview_enabled: true,
      rweb_video_timestamps_enabled: true,
      rweb_tipjar_consumption_enabled: true,
      freedom_of_speech_not_reach_fetch_enabled: true,
      standardized_nudges_misinfo: true,
      tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
      rweb_video_tagging_enabled: true,
      premium_content_api_read_enabled: false,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_enhance_cards_enabled: false,
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Cookie: cookies.raw,
        'X-Csrf-Token': cookies.ct0,
        'Content-Type': 'application/json',
        'X-Twitter-Active-User': 'yes',
        'X-Twitter-Client-Language': 'en',
      },
      body: JSON.stringify({ variables, features }),
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
 */
export async function getCookieAuthStatus(): Promise<{
  configured: boolean
  source: 'database' | 'env_var' | null
  lastUpdated: Date | null
}> {
  const settings = await getSettings()

  if (settings.x_cookie_string) {
    // Need updatedAt — targeted query for just the timestamp
    const dbSetting = await db.setting.findUnique({
      where: { key: 'x_cookie_string' },
      select: { updatedAt: true },
    })
    return {
      configured: true,
      source: 'database',
      lastUpdated: dbSetting?.updatedAt ?? null,
    }
  }

  const envCookie = process.env.X_COOKIE_STRING?.trim()
  if (envCookie) {
    return { configured: true, source: 'env_var', lastUpdated: null }
  }

  return { configured: false, source: null, lastUpdated: null }
}
