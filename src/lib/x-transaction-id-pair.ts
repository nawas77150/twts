// ============================================================
// X Client Transaction ID Generator — Pair-Dict Approach
//
// Generates the x-client-transaction-id header value using
// pre-computed {animationKey, verification} pairs from:
//   fa0311/x-client-transaction-id-pair-dict
//
// This is the PRIMARY method for transaction ID generation.
// It replaces the live SVG + cubic-bezier approach (which
// requires 3 HTTP fetches to x.com and misses WebRTC SDP bytes).
//
// Advantages over the live approach (x-transaction-id.ts):
// - Zero x.com network requests (no HTML/JS/SVG fetching)
// - Includes WebRTC SDP bytes (pre-computed in real browser)
// - Real browser-computed animation key (not math approximation)
// - No fragile regex that breaks when X updates frontend
// - Auto-updated daily at 22:00 UTC via GitHub Actions
//
// Algorithm (same as x-client-transaction-id-generater npm):
// 1. Fetch pair.json from GitHub CDN (cached 4h)
// 2. Pick random {animationKey, verification} pair
// 3. Build hash: SHA-256("{method}!{path}!{timeNow}obfiowerehiring{animationKey}")
// 4. Assemble: [...keyBytes, ...timeBytes, ...hash[0:16], 3]
// 5. XOR encode with random byte, base64 encode
//
// If this fails (GitHub down, etc.), the caller falls back to
// the live SVG approach in x-transaction-id.ts.
// ============================================================

import * as crypto from 'crypto'
import { debug } from '@/lib/debug'
import { buildTransactionId } from '@/lib/x-transaction-id-shared'

// --- Types ---

interface PairDict {
  animationKey: string
  verification: string
}

// --- Constants ---

const PAIR_URL = process.env.PAIR_JSON_URL || 'https://raw.githubusercontent.com/fa0311/x-client-transaction-id-pair-dict/refs/heads/main/pair.json'

// --- Cache ---

let cachedPairs: PairDict[] | null = null
let cachedPairsTime: number = 0
const PAIR_CACHE_TTL = 4 * 60 * 60 * 1000 // 4 hours

/**
 * Fetch pair-dict from GitHub CDN with in-memory caching.
 *
 * The pair.json file is ~5KB, CDN-cached globally, and auto-updated
 * daily at 22:00 UTC by GitHub Actions. We cache it for 4 hours to
 * balance freshness with network efficiency.
 */
async function fetchPairs(): Promise<PairDict[]> {
  const now = Date.now()
  if (cachedPairs && now - cachedPairsTime < PAIR_CACHE_TTL) {
    return structuredClone(cachedPairs)
  }

  debug('pair-dict', 'Fetching pair.json from GitHub CDN')
  const resp = await fetch(PAIR_URL, { signal: AbortSignal.timeout(10_000) })
  if (!resp.ok) {
    throw new Error(`Failed to fetch pair.json: ${resp.status}`)
  }

  const pairs = (await resp.json()) as PairDict[]
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new Error('pair.json is empty or invalid')
  }

  // Validate schema: each entry must have non-empty animationKey and verification strings
  const validPairs = pairs.filter(p =>
    typeof p.animationKey === 'string' && p.animationKey.trim() !== '' &&
    typeof p.verification === 'string' && p.verification.trim() !== ''
  )
  if (validPairs.length === 0) {
    throw new Error('pair.json contains no valid entries')
  }
  if (validPairs.length < pairs.length) {
    console.warn(`[pair-dict] ${pairs.length - validPairs.length} invalid entries filtered out of ${pairs.length} total`)
  }

  // Drastic-change warning: if cached pairs exist and the new count is < 50% of the cached count,
  // log a warning and keep the old cache
  if (cachedPairs && validPairs.length < cachedPairs.length * 0.5) {
    console.warn(`[pair-dict] Drastic change detected: ${validPairs.length} entries vs previous ${cachedPairs.length}. Keeping old cache.`)
    return structuredClone(cachedPairs)
  }

  cachedPairs = validPairs
  cachedPairsTime = now
  debug('pair-dict', 'Loaded', validPairs.length, 'pairs, cached for 4h')
  return structuredClone(cachedPairs)
}

// --- Transaction ID Generator ---

/**
 * Generate x-client-transaction-id using pre-computed pair-dict values.
 *
 * This is the primary method — fast (0 x.com fetches), accurate (includes
 * WebRTC SDP bytes via pre-computation), and resilient (no regex parsing).
 *
 * @returns Transaction ID string, or null if pair-dict is unavailable
 *          (caller should fall back to the live SVG approach)
 */
export async function generateTransactionIdFromPair(
  method: string,
  path: string
): Promise<string | null> {
  try {
    const pairs = await fetchPairs()
    // Cryptographically-secure random selection (not Math.random)
    const pair = pairs[crypto.randomInt(pairs.length)]

    // Decode verification key (base64 → bytes — the twitter-site-verification key)
    const keyBytes = Array.from(Buffer.from(pair.verification, 'base64'))

    // Delegate to shared builder (handles timestamp, hash, XOR, base64)
    return buildTransactionId(method, path, keyBytes, pair.animationKey)
  } catch (error) {
    debug(
      'pair-dict',
      'Failed:',
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}

/**
 * Clear pair-dict cache.
 * Called when clearing all caches (stale data, retry, admin action).
 */
export function clearPairCache(): void {
  cachedPairs = null
  cachedPairsTime = 0
}
