// ============================================================
// Tweetfess — Shared TypeScript Types
// ============================================================

import type { FilterRules } from '@/lib/content-filter-engine'
import type { RateLimitSettings } from '@/lib/rate-limit-defaults'
import type { CookieAuthStatus } from '@/lib/posting-service-types'

// --- Status ---

export type SubmissionStatus = 'pending' | 'censored' | 'posting' | 'post_failed' | 'rejected' | 'posted'

export type PostMethodSetting = 'direct' | 'api' | 'auto'
export type PostMethodResult = string

// --- Models ---

export interface SubmitterInfo {
  id: string
  username: string
  displayName: string | null
  profileImage: string | null
  twitterId: string | null
}

export interface Submission {
  id: string
  message: string
  status: SubmissionStatus
  tweetId: string | null
  postMethod: PostMethodResult | null
  postError: string | null
  category: string | null
  filterReasons: string | null
  submitterId: string
  submitter: SubmitterInfo
  createdAt: string
  updatedAt: string
}

// --- API Response Types ---

export interface KeyCredits {
  apiKey: string
  rechargeCredits: number
  bonusCredits: number
  totalCredits: number
  error?: string
}

export interface ApiLoginStatus {
  hasLoginCookie: boolean
  lastLoginAt: string | null
  hasCredentials: boolean
  missingCredentials: string[]
  v2LoginEnabled: boolean
  cookieApiReady: boolean
  cookieApiMissing: string[]
}

export interface PostMethodStats {
  total: number
  direct: number
  retry: number
  fallback: number
  directRate: number
  retryRate: number
  fallbackRate: number
}

export type { CookieAuthStatus } from '@/lib/posting-service-types'

// --- Filter Types ---

export type { FilterRules }

export type { RateLimitSettings } from '@/lib/rate-limit-defaults'

export interface FilterSettings {
  autoApprove: boolean
  blockedWords: string[]
  nsfwWords: string[]
  filterRules: FilterRules
  geminiEnabled: boolean
  geminiApiKeySet: boolean
  geminiModel: string
  geminiSystemPrompt: string | null
  rateLimits: RateLimitSettings
  whitelistUsernames: string[]
  blockedUsernames: string[]
  blockedReasons: Record<string, string>
  postHashtags: string
  defaultBlockedWords?: string[]
  defaultNsfwWords?: string[]
  defaultGeminiSystemPrompt?: string
}

// --- Stats ---

export interface Stats {
  pending: number
  censored: number
  posting: number
  postFailed: number
  rejected: number
  posted: number
  total: number
  submitters: number
  cookieAuthStatus: CookieAuthStatus | null
  postMethodStats: PostMethodStats | null
  apiCredits: KeyCredits[] | null
  apiLoginStatus: ApiLoginStatus | null
  filterSettings: FilterSettings | null
  postMethodSetting?: PostMethodSetting
  circuitBreaker?: CircuitBreakerStatus | null
  encryptionEnabled?: boolean
}

// --- Circuit Breaker ---

export interface CircuitBreakerStatus {
  paused: boolean
  failCount: number
  pausedUntil: number | null
  threshold: number
}

// --- Submitter with Stats (for admin user management) ---

export interface SubmitterWithStats {
  id: string
  username: string
  displayName: string | null
  profileImage: string | null
  customLimits: Record<string, number> | null
  totalSubmissions: number
  posted: number
  pending: number
  censored: number
  rejected: number
  postFailed: number
}

// --- Per-User Custom Limits ---

export type PerUserLimits = Pick<RateLimitSettings,
  'submissionCooldown' | 'submissionDailyCap' | 'userPendingCap' | 'userPostDailyCap'
>

export const PER_USER_LIMIT_KEYS: (keyof PerUserLimits)[] = [
  'submissionCooldown',
  'submissionDailyCap',
  'userPendingCap',
  'userPostDailyCap',
]

export const PER_USER_LIMIT_LABELS: Record<keyof PerUserLimits, string> = {
  submissionCooldown: 'Cooldown (menit)',
  submissionDailyCap: 'Batas Harian',
  userPendingCap: 'Max Pending',
  userPostDailyCap: 'Batas Post Harian',
}

export interface SubmissionLimitsData {
  dailyCap: number
  dailyUsed: number
  pendingCap: number
  pendingUsed: number
  postCap: number
  postUsed: number
  cooldownSeconds: number
  isWhitelisted?: boolean    // Whitelisted users bypass per-user cooldown & caps
  isCustom: boolean
  autoApprove?: boolean
  hashtags?: string          // Admin-configured hashtags appended to posts (e.g. "#conf #anon")
  maxMessageLength?: number  // Effective max: 280 minus hashtag space
}

// --- Pagination ---

export interface PaginationInfo {
  page: number
  limit: number
  total: number
  totalPages: number
  hasMore: boolean
}

export interface PaginatedSubmissions {
  submissions: Submission[]
  pagination: PaginationInfo
}

// --- API Request Types ---

export interface SubmitMessageRequest {
  message: string
  category?: string
}

export interface AdminLoginRequest {
  password: string
}

export interface SaveSettingRequest {
  key: string
  value: string
}

export interface SaveFilterSettingsRequest {
  autoApprove?: boolean
  blockedWords?: string[]
  nsfwWords?: string[]
  filterRules?: FilterRules
  geminiEnabled?: boolean
  geminiApiKey?: string
  geminiModel?: string
  geminiSystemPrompt?: string
  rateLimits?: Partial<RateLimitSettings>
  // whitelistUsernames and blockedUsernames are NOT included here.
  // They are managed exclusively through atomic API routes:
  //   POST/DELETE /api/admin/submitters/whitelist
  //   POST /api/admin/submitters/block and /unblock
  // This prevents the read-merge-write race condition where saving
  // filter settings with stale form data would re-add users that
  // were removed by concurrent block/unblock operations.
}

// --- Auth Response ---

export interface AuthCheckResponse {
  authenticated: boolean
  submitter?: SubmitterInfo
  blocked?: boolean
  blockReason?: string
}

export interface AdminLoginResponse {
  token: string
}
