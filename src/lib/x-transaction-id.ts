// ============================================================
// X Client Transaction ID Generator — Fallback (Live SVG Approach)
//
// Generates the x-client-transaction-id header value using the
// live SVG + cubic-bezier approach. This is now the FALLBACK
// method — the primary method uses pre-computed pairs from
// x-transaction-id-pair.ts (0 x.com fetches, includes WebRTC bytes).
//
// This fallback is used when the pair-dict approach fails
// (GitHub down, pair.json fetch error, etc.).
//
// Algorithm:
// 1. Fetch x.com homepage → extract site verification key + ondemand JS URL
// 2. Fetch ondemand JS → extract key byte indices
// 3. Parse SVG animation frames from homepage
// 4. Compute animation key (cubic bezier interpolation)
// 5. Build transaction ID: SHA-256 hash + XOR encoding + base64
//
// Known limitations (vs pair-dict primary):
// - Missing WebRTC SDP bytes (no RTCPeerConnection in Node.js)
// - Math approximation of animation key (no DOM, no getComputedStyle)
// - 3 HTTP fetches to x.com = bot fingerprint
// - Fragile regex that breaks when X updates frontend
//
// Adapted from:
// - Lqm1/x-client-transaction-id (TypeScript, browser-based)
// - iSarabjitDhiman/XClientTransaction (Python)
// - vladkens/twscrape (Python, xclid.py)
// ============================================================

import { buildTransactionId } from '@/lib/x-transaction-id-shared'
import { extractSiteVerificationKey, extractOnDemandFileUrl, extractIndices, computeAnimationKey } from '@/lib/x-transaction-id-html'

// Chrome 148 on Linux — synced from fa0311/latest-user-agent
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

// --- Shared HTML Cache ---
// Both fetchLiveQueryId (twitter-post-cookie.ts) and getTransactionIdConfig
// need the x.com homepage HTML. To avoid fetching it twice on cold starts,
// we cache the HTML here with a short TTL. Both functions call fetchXcomHtml()
// instead of fetching independently.
let cachedHtml: string | null = null
let cachedHtmlTime: number = 0
const HTML_CACHE_TTL = 5 * 60 * 1000 // 5 minutes — short TTL, just for deduplication

/**
 * Fetch x.com homepage HTML with in-memory caching.
 * Shared between fetchLiveQueryId and getTransactionIdConfig
 * to avoid duplicate fetches on cold starts.
 */
export async function fetchXcomHtml(): Promise<string> {
  const now = Date.now()
  if (cachedHtml && now - cachedHtmlTime < HTML_CACHE_TTL) {
    return cachedHtml
  }
  const resp = await fetch('https://x.com', {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(10_000),
  })
  if (!resp.ok) {
    throw new Error(`Failed to fetch x.com homepage: ${resp.status}`)
  }
  cachedHtml = await resp.text()
  cachedHtmlTime = now
  return cachedHtml
}

// --- Main Transaction ID Generator ---

interface TransactionIdConfig {
  keyBytes: number[]
  animationKey: string
  rowIndex: number
  keyBytesIndices: number[]
}

let cachedConfig: TransactionIdConfig | null = null
let cachedConfigTime: number = 0
const CONFIG_CACHE_TTL = 4 * 60 * 60 * 1000 // 4 hours

/**
 * Fetch and cache the transaction ID configuration from X's homepage.
 * This is expensive (3 fetches) so we cache it for 4 hours.
 */
async function getTransactionIdConfig(): Promise<TransactionIdConfig> {
  const now = Date.now()
  if (cachedConfig && now - cachedConfigTime < CONFIG_CACHE_TTL) {
    return structuredClone(cachedConfig)
  }

  // Step 1: Fetch x.com homepage (uses shared cache to avoid duplicate fetches)
  const html = await fetchXcomHtml()

  // Step 2: Extract site verification key
  const key = extractSiteVerificationKey(html)
  const keyBytes = Array.from(Buffer.from(key, 'base64'))

  // Step 3: Extract ondemand JS URL and fetch it
  const onDemandUrl = extractOnDemandFileUrl(html)
  const onDemandResp = await fetch(onDemandUrl, {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(10_000),
  })
  if (!onDemandResp.ok) {
    throw new Error(`Failed to fetch ondemand file: ${onDemandResp.status}`)
  }
  const onDemandJs = await onDemandResp.text()

  // Step 4: Extract indices
  const [rowIndex, keyBytesIndices] = extractIndices(onDemandJs)

  // Step 5: Compute animation key
  const animationKey = computeAnimationKey(
    keyBytes,
    rowIndex,
    keyBytesIndices,
    html
  )

  cachedConfig = { keyBytes, animationKey, rowIndex, keyBytesIndices }
  cachedConfigTime = now

  return structuredClone(cachedConfig)
}

/**
 * Generate an x-client-transaction-id for a given HTTP method and path.
 *
 * Usage:
 *   const tid = await generateTransactionId('POST', '/i/api/graphql/xxx/CreateTweet')
 *   // → "ey4Kxa8F2d..."
 *
 * This should be called for every API request and the result sent as
 * the x-client-transaction-id header.
 */
export async function generateTransactionId(
  method: string,
  path: string
): Promise<string> {
  const config = await getTransactionIdConfig()
  return buildTransactionId(method, path, config.keyBytes, config.animationKey)
}

/**
 * Clear all cached data (transaction ID config + HTML cache).
 * Call this if you start getting 404s or other errors that might
 * indicate X has updated their frontend.
 */
export function clearTransactionIdCache(): void {
  cachedConfig = null
  cachedConfigTime = 0
  cachedHtml = null
  cachedHtmlTime = 0
}
