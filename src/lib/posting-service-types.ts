// ============================================================
// posting-service-types.ts — PostingService abstraction types
//
// Pure type definitions — zero runtime code, zero imports.
// Safe to import from any module without circular deps.
//
// Business logic imports from posting-service.ts for types + singleton.
// Implementations import from here for types + exhaustiveness.
// ============================================================

/** Failure classification for the posting abstraction. */
export type FailureKind = 'transient' | 'permanent' | 'duplicate'

/** Result of a posting operation. */
export type PostResult = {
  success: boolean
  tweetId?: string
  error?: string
  failureKind?: FailureKind
  method?: string
  retriesUsed?: number
}

/** Authentication status of a posting backend. */
export interface CookieAuthStatus {
  configured: boolean
  source: string | null
  lastUpdated: string | null
  missing: string[]
}

/** Abstraction boundary for posting to social media. */
export interface PostingService {
  post(text: string): Promise<PostResult>
  getAuthStatus(): Promise<CookieAuthStatus>
  clearCaches(): Promise<void>
}
