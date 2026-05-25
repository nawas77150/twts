import { upsertSetting } from '@/lib/db-helpers'
import { fetchXcomHtml } from '@/lib/x-transaction-id'
import { debug } from '@/lib/debug'

// ============================================================
// CreateTweet Spec Resolution (queryId + features)
//
// Resolves the CreateTweet GraphQL endpoint configuration from
// 5 sources in priority order. Never returns null.
//
// Priority:
// 1. In-memory cache (warm instance — skip DB parse)
// 2. DB row x_placeholder_json (included in getSettings batch — 0 extra queries)
// 3. GitHub placeholder.json → upsert DB + cache in memory
// 4. fetchLiveQueryId() (x.com JS bundle, ~600ms, 2 fetches) → upsert DB + cache in memory
// 5. Hardcoded FALLBACK_SPEC (GitHub + x.com both down) — NOT persisted
//
// Why step 5 is not persisted:
// FALLBACK_SPEC contains a hardcoded queryId that goes stale as X rotates
// their API. If persisted, the 3-day TTL would cause step 2 (DB cache) to
// serve stale data on subsequent requests, blocking fresh data from
// GitHub/x.com until a code:48 stale_cache retry cycle self-corrects.
// Not persisting ensures each request re-attempts steps 1-4 — they fail
// fast if network is still down, and succeed immediately if it's recovered.
//
// DB key naming: `x_placeholder_json` is a provenance name (data originally
// came from placeholder.json). The TypeScript type `CreateTweetSpec` is the
// semantic name. Not renaming to avoid a migration with no functional benefit.
// ============================================================

// Chrome 148 on Linux — synced from fa0311/latest-user-agent
// (Also defined in twitter-post-cookie.ts for headers — duplicated to avoid
// cross-module constant coupling; update both when bumping Chrome version.)
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

const PLACEHOLDER_URL =
  'https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json'
const PLACEHOLDER_TTL_MS = 3 * 24 * 60 * 60 * 1000 // 3 days

// ── Types ──────────────────────────────────────────────

/** Public contract — queryId + features needed to call CreateTweet */
export type CreateTweetSpec = {
  queryId: string
  features: Record<string, boolean>
}

/** Internal cache entry — includes fetchedAt for TTL checks */
type CachedSpec = CreateTweetSpec & { fetchedAt: number }

// ── Hardcoded Fallback ─────────────────────────────────

// Last resort when GitHub and x.com are both unreachable.
// queryId synced 2025-07-25 from placeholder.json.
// Stale queryId is acceptable here — if X rotated it, the stale_cache
// retry in postTweetViaCookie will clear caches and re-resolve.
const FALLBACK_SPEC: CreateTweetSpec = {
  queryId: 'aOhRFeMj64DfKvMEqO5qow',
  features: {
    premium_content_api_read_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_grok_analyze_button_fetch_trends_enabled: false,
    responsive_web_grok_analyze_post_followups_enabled: true,
    rweb_cashtags_composer_attachment_enabled: true,
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
    post_ctas_fetch_enabled: true,
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
  },
}

// ── Cache ──────────────────────────────────────────────

/** In-memory cache for CreateTweet spec (avoids JSON.parse on warm instances) */
let memPlaceholder: CachedSpec | null = null

/** Clear in-memory cache only. DB deletion is handled by clearAllCaches(). */
export function clearCreateTweetSpecCache(): void {
  memPlaceholder = null
}

// ── Validation ─────────────────────────────────────────

/** Structural validation — checks the public CreateTweetSpec contract */
function isValidSpec(spec: unknown): spec is CreateTweetSpec {
  return (
    typeof spec === 'object' && spec !== null &&
    typeof (spec as CreateTweetSpec).queryId === 'string' &&
    (spec as CreateTweetSpec).queryId.length > 0 &&
    typeof (spec as CreateTweetSpec).features === 'object' &&
    (spec as CreateTweetSpec).features !== null
  )
}

// ── Emergency Fallback: x.com JS Bundle ────────────────

/**
 * Emergency fallback: fetch CreateTweet queryId from X's live JS bundle.
 * Only called when placeholder.json is unavailable (GitHub down + DB empty).
 * Expensive (~600ms, 2 x.com fetches) and creates a bot fingerprint pattern,
 * so this should almost never run in normal operation.
 */
async function fetchLiveQueryId(): Promise<string | null> {
  try {
    const html = await fetchXcomHtml()
    const bundle = html.match(/main\.[a-z0-9]+\.js/)?.[0]
    if (!bundle) return null

    const js = await fetch(
      `https://abs.twimg.com/responsive-web/client-web/${bundle}`,
      { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(10_000) }
    ).then((r) => r.text())

    const match = js.match(/([A-Za-z0-9_-]{15,35})",operationName:"CreateTweet"/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

// ── 5-Step Resolution ──────────────────────────────────

/**
 * Resolve CreateTweet spec from 5 sources. Never returns null.
 *
 * Uses the settings map from getSettings() so there are zero extra DB queries.
 * Steps 3 and 4 persist to DB + memory so subsequent calls skip network.
 * Step 5 (FALLBACK_SPEC) is NOT persisted — see module header for rationale.
 */
export async function getCreateTweetSpec(
  settings: Record<string, string>
): Promise<CreateTweetSpec> {
  const now = Date.now()

  // 1. In-memory cache (warm instance — skip DB parse entirely)
  if (memPlaceholder && now - memPlaceholder.fetchedAt < PLACEHOLDER_TTL_MS) {
    return memPlaceholder
  }

  // 2. DB cache from settings map (0 extra DB queries)
  const raw = settings['x_placeholder_json']
  if (raw) {
    try {
      const cached = JSON.parse(raw) as CachedSpec  // DB stores CachedSpec (CreateTweetSpec + fetchedAt)
      if (isValidSpec(cached) &&
          typeof cached.fetchedAt === 'number' &&
          now - cached.fetchedAt < PLACEHOLDER_TTL_MS) {
        memPlaceholder = cached
        return cached
      }
    } catch { /* corrupt JSON — fall through */ }
  }

  // 3. GitHub placeholder.json → persist to DB + memory
  try {
    const resp = await fetch(PLACEHOLDER_URL, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'tweetfess-sync/1.0' },
    })
    if (resp.ok) {
      const json = await resp.json() as Record<string, unknown>
      const ct = json?.CreateTweet as { queryId?: string; features?: Record<string, boolean> } | undefined
      if (ct?.queryId) {
        const spec: CachedSpec = {
          fetchedAt: now,
          queryId: ct.queryId,
          features: ct.features ?? FALLBACK_SPEC.features,
        }
        memPlaceholder = spec
        await upsertSetting('x_placeholder_json', JSON.stringify(spec))
        debug('direct', 'Fetched placeholder.json — queryId:', spec.queryId.slice(0, 8), 'features:', Object.keys(spec.features).length, 'keys')
        return spec
      }
    }
  } catch { /* GitHub down — fall through */ }

  // 4. fetchLiveQueryId (x.com JS bundle, ~600ms, 2 fetches) → persist to DB + memory
  //    Only gives queryId — use FALLBACK features since x.com JS doesn't expose features.
  const liveQueryId = await fetchLiveQueryId()
  if (liveQueryId) {
    const spec: CachedSpec = {
      fetchedAt: now,
      queryId: liveQueryId,
      features: FALLBACK_SPEC.features,
    }
    memPlaceholder = spec
    await upsertSetting('x_placeholder_json', JSON.stringify(spec))
    debug('direct', 'Fetched live queryId from x.com — queryId:', spec.queryId.slice(0, 8))
    return spec
  }

  // 5. Hardcoded FALLBACK_SPEC — NOT persisted to DB or memory.
  debug('direct', 'All spec sources failed — using FALLBACK_SPEC (hardcoded)')
  return FALLBACK_SPEC
}
