// ============================================================
// twitter-post-error.ts — Error classification & response parsing
//
// Pure functions — no I/O, no DB, no fetch.
// Safe to import from any module without circular deps.
//
// Used by:
//   - twitter-post-cookie.ts (retry routing, response parsing)
//   - circuit-breaker.ts (ErrorClass type)
// ============================================================

// ── Types ──────────────────────────────────────────────

/**
 * Classified error types from X API responses.
 * Used to drive retry logic and circuit breaker filtering.
 *
 * - stale_cache: X rotated queryId → clear caches and retry
 * - transient: Temporary issue (226, empty results) → retry with backoff
 * - auth_failure: Cookie/bearer expired → needs admin intervention
 * - rate_limit: X imposed rate limit → needs admin to wait
 * - stealth_ban: Account shadowbanned → needs admin to check account
 * - duplicate_posted: Error 187 — tweet already exists on X (phantom success)
 * - terminal: Unrecognized/unrecoverable error → no retry
 */
export type ErrorClass = 'stale_cache' | 'transient' | 'auth_failure' | 'rate_limit' | 'stealth_ban' | 'duplicate_posted' | 'terminal'

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
export const MAX_DIRECT_ATTEMPTS = 4

// ── Error Classification ───────────────────────────────

/**
 * Table-driven error classifier. Replaces isStaleCacheError() + is226Error().
 * Adding new error patterns = adding 1 row to ERROR_PATTERNS. Zero CC increase.
 */
const ERROR_PATTERNS: [RegExp, ErrorClass][] = [
  [/code: 48|HTTP 404/, 'stale_cache'],
  [/HTTP 226|code: 226|might be automated/, 'transient'],
  [/HTTP 401|Could not authenticate/, 'auth_failure'],
  [/HTTP 429|code: 88|Rate limit exceeded/, 'rate_limit'],
  // code: 187 = "Status is a duplicate" — X rejected because the tweet already
  // exists (phantom success from a previous crash). Not a real failure — the tweet
  // IS on X. Must not penalize circuit breaker. Recovered in execute-post.ts
  // via handleDuplicatePosted().
  [/code: 187/, 'duplicate_posted'],
  // Best-effort — not definitive. code: 64 is a hard suspension (not stealth),
  // code: 353 is poorly documented, and "suspended" may appear in non-ban messages.
  // Misclassifying as stealth_ban is safe: it just skips circuit-breaker retry,
  // which is the conservative (fail-open) failure mode.
  [/code: 353|suspended|code: 64/, 'stealth_ban'],
]

export function classifyError(error: string): ErrorClass {
  for (const [pattern, cls] of ERROR_PATTERNS) {
    if (pattern.test(error)) return cls
  }
  return 'terminal'
}

// ── Response Parsing ───────────────────────────────────

/**
 * Detect empty tweet_results — X silently rejects the tweet.
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

/**
 * Parsed outcome from X's CreateTweet response.
 * Consolidates the 4-layer response check into one discriminated union:
 *   1. tweetId present → success (even with errors — GraphQL partial success)
 *   2. Empty tweet_results → silent rejection
 *   3. GraphQL errors array → classified error
 *   4. No data, no errors → unknown failure
 */
export type DirectPostOutcome =
  | { kind: 'success'; tweetId: string }
  | { kind: 'empty_results' }
  | { kind: 'graphql_error'; error: string; errorClass: ErrorClass }
  | { kind: 'unknown_failure'; body: unknown }

export function parseDirectPostResponse(body: unknown): DirectPostOutcome {
  // Layer 1: tweetId present = tweet created (even if errors[] exists)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- X API response shape is untyped
  const tweetId = (body as any)?.data?.create_tweet?.tweet_results?.result?.rest_id
  if (tweetId) return { kind: 'success', tweetId }

  // Layer 2: Empty tweet_results — X silently rejected
  if (isEmptyResults(body)) return { kind: 'empty_results' }

  // Layer 3: GraphQL errors array
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- X API response shape is untyped
  const errors = (body as any)?.errors
  if (errors?.length) {
    const msgs = errors
      .map((e: { message: string; code?: number }) => `${e.message} (code: ${e.code || 'unknown'})`)
      .join('; ')
    const error = `X GraphQL error: ${msgs}`
    return { kind: 'graphql_error', error, errorClass: classifyError(error) }
  }

  // Layer 4: No tweetId, no errors, no empty results — unknown
  return { kind: 'unknown_failure', body }
}

// ── Retry Decision ─────────────────────────────────────

/**
 * Should the retry loop continue, clear caches and continue, or bail?
 * Eliminates the duplicated stale_cache/transient check pattern
 * that appeared in both the HTTP error and GraphQL error branches.
 */
export type RetryDecision = 'clear_and_continue' | 'continue' | 'bail'

export function shouldRetry(attempt: number, errorClass: ErrorClass): RetryDecision {
  if (errorClass === 'stale_cache' && attempt === 0) return 'clear_and_continue'
  if (errorClass === 'transient' && attempt < MAX_DIRECT_ATTEMPTS - 1) return 'continue'
  return 'bail'
}
