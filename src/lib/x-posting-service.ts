// ============================================================
// x-posting-service.ts — X implementation of PostingService
//
// Wraps twitter-post-cookie.ts behind the PostingService interface.
// Only posting-service.ts imports from this file.
//
// FAILURE_MAP satisfies Record<ErrorClass, FailureKind> ensures:
// - Input exhaustiveness: new ErrorClass values require a map entry
// - Output exhaustiveness: the type assertion below ensures
//   all FailureKind values are produced by the map
// ============================================================

import {
  postTweetViaCookie,
  getCookieAuthStatus,
  clearAllCaches,
} from '@/lib/twitter-post-cookie'
import type { ErrorClass } from '@/lib/twitter-post-error'
import type { FailureKind, PostResult, CookieAuthStatus, PostingService } from './posting-service-types'

// ── Error classification ───────────────────────────────

/**
 * Map X's 7 ErrorClass values → 3 FailureKind values.
 *
 * satisfies Record<ErrorClass, FailureKind> ensures compile-time
 * input exhaustiveness: if ErrorClass gains a new value, this map
 * must include it.
 *
 * The type assertion below ensures output exhaustiveness:
 * if FailureKind gains a value not produced by this map,
 * the _outputExhaustive assignment fails to compile.
 */
const FAILURE_MAP = {
  stale_cache: 'transient',
  transient: 'transient',
  auth_failure: 'permanent',
  rate_limit: 'permanent',
  stealth_ban: 'permanent',
  duplicate_posted: 'duplicate',
  terminal: 'transient',
} as const satisfies Record<ErrorClass, FailureKind>

// Compile-time output exhaustiveness: FAILURE_MAP produces all FailureKind values.
// If FailureKind gains a value not in the map's values, this becomes a compile error.
type _produced = (typeof FAILURE_MAP)[keyof typeof FAILURE_MAP]
const _outputExhaustive: [FailureKind] extends [_produced] ? true : never = true
void _outputExhaustive

/** Classify an X error into a failure kind for the posting abstraction. */
function classifyFailure(errorClass?: ErrorClass): FailureKind {
  return errorClass ? FAILURE_MAP[errorClass] : 'transient'
}

// ── Factory ────────────────────────────────────────────

/** Create the X PostingService implementation. */
export function createXPostingService(): PostingService {
  return {
    async post(text: string): Promise<PostResult> {
      const result = await postTweetViaCookie(text)
      return {
        success: result.success,
        ...(result.tweetId != null && { tweetId: result.tweetId }),
        ...(result.error != null && { error: result.error }),
        ...(!result.success && { failureKind: classifyFailure(result.errorClass) }),
        method: result.method,
        ...(result.retriesUsed != null && { retriesUsed: result.retriesUsed }),
      }
    },

    async getAuthStatus(): Promise<CookieAuthStatus> {
      const status = await getCookieAuthStatus()
      return {
        configured: status.configured,
        source: status.source,
        lastUpdated: status.lastUpdated?.toISOString() ?? null,
        missing: status.missing,
      }
    },

    async clearCaches(): Promise<void> {
      await clearAllCaches()
    },
  }
}
