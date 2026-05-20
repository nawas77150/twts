// ============================================================
// twitter-api-credits.ts — API credits management + caching
//
// Fetches credit info from twitterapi.io /oapi/my/info endpoint.
// Includes in-memory caching with 5-minute TTL to avoid hammering
// the external API on every dashboard load.
//
// On Vercel, the in-memory cache resets on cold starts — acceptable tradeoff.
// ============================================================

import {
  TWITTERAPI_BASE,
  parseApiKeys,
  getApiSettings,
  maskApiKey,
} from './twitter-api-shared'
import type { KeyCredits } from './twitter-api-shared'

// --- Single Key Credits ---

/**
 * Fetch credit info for a single API key.
 * Uses /oapi/my/info — this endpoint is FREE (V12: doesn't consume credits).
 */
export async function getKeyCredits(apiKey: string): Promise<KeyCredits> {
  try {
    const response = await fetch(`${TWITTERAPI_BASE}/oapi/my/info`, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      return {
        apiKey: maskApiKey(apiKey),
        rechargeCredits: 0,
        bonusCredits: 0,
        totalCredits: 0,
        error: `HTTP ${response.status}`,
      }
    }

    const data = await response.json()
    return {
      apiKey: maskApiKey(apiKey),
      rechargeCredits: data.recharge_credits || 0,
      bonusCredits: data.total_bonus_credits || 0,
      totalCredits: (data.recharge_credits || 0) + (data.total_bonus_credits || 0),
    }
  } catch (error) {
    return {
      apiKey: maskApiKey(apiKey),
      rechargeCredits: 0,
      bonusCredits: 0,
      totalCredits: 0,
      error: error instanceof Error ? error.message : 'Network error',
    }
  }
}

// --- All Keys Credits ---

/**
 * Fetch credit info for all configured API keys.
 * Used by admin dashboard to show credit status.
 */
export async function getAllKeyCredits(): Promise<KeyCredits[]> {
  const settings = await getApiSettings()

  const keys = parseApiKeys(settings.twitterapi_keys)

  if (keys.length === 0) return []

  return Promise.all(keys.map((key) => getKeyCredits(key)))
}

// ── In-memory cache for API credits ──
// Credits change slowly (only when tweets are posted), so caching for 5 minutes
// avoids N external HTTP calls to twitterapi.io on every dashboard load.
// On Vercel, this cache resets on cold starts — acceptable tradeoff.

let creditsCache: KeyCredits[] | null = null
let creditsCacheTime: number = 0
const CREDITS_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Returns cached credits immediately (or null if cache is empty/stale).
 * Kicks off a background fetch to populate the cache for the next request.
 * Use this in hot paths where you don't want to block on external API calls.
 */
export function getApiCreditsNonBlocking(): KeyCredits[] | null {
  const now = Date.now()
  if (creditsCache && now - creditsCacheTime < CREDITS_CACHE_TTL) {
    return creditsCache // Cache is fresh — return immediately
  }
  // Cache is stale or empty — fire background fetch for next request
  void getAllKeyCredits().then((fresh) => {
    creditsCache = fresh
    creditsCacheTime = Date.now()
  }).catch(() => {
    // External API failed — keep whatever cache we have (or null)
  })
  return creditsCache // Return stale cache or null — don't block
}

/**
 * Cached version of getAllKeyCredits().
 * Returns cached results if fresh (<5 min), otherwise fetches new data.
 * This is the function admin stats should use to avoid hammering the external API.
 */
export async function getCachedApiCredits(): Promise<KeyCredits[]> {
  const now = Date.now()
  if (creditsCache && now - creditsCacheTime < CREDITS_CACHE_TTL) {
    return creditsCache
  }
  const fresh = await getAllKeyCredits()
  creditsCache = fresh
  creditsCacheTime = now
  return fresh
}

/**
 * Invalidate the credits cache.
 * Call this after posting a tweet (credits decrease) or after saving new API keys.
 */
export function invalidateCreditsCache(): void {
  creditsCache = null
  creditsCacheTime = 0
}
