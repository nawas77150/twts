// ============================================================
// posting-service.ts — PostingService singleton + type re-exports
//
// THE ONLY file business logic imports from.
// Re-exports types from posting-service-types.ts so consumers
// have a single import source.
// ============================================================

import { createXPostingService } from './x-posting-service'
import type { PostingService } from './posting-service-types'

// Re-export types — consumers import from this file only
export type { FailureKind, PostResult, CookieAuthStatus, PostingService } from './posting-service-types'

// ── Singleton ──

/** X PostingService instance — the single entry point for posting operations. */
export const postingService: PostingService = createXPostingService()
