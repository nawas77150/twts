// ============================================================
// Tweetfess — Shared TypeScript Types
// ============================================================

// --- Status ---

export type SubmissionStatus = 'pending' | 'censored' | 'posting' | 'post_failed' | 'rejected' | 'posted'

export type PostMethod = 'direct' | 'api' | 'auto'

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
  postMethod: string | null
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

export interface CookieAuthStatus {
  configured: boolean
  source: string | null
  lastUpdated: string | null
  missing: string[]
}

// --- Filter Types ---

export interface FilterRules {
  blockedWords: boolean
  jualan: boolean
  urls: boolean
  mentions: boolean
  phoneNumbers: boolean
  nsfw: boolean
  capsSpam: boolean
  repeatedChars: boolean
  tooShort: boolean
  duplicate24h: boolean
}

export interface RateLimitSettings {
  submissionCooldown: number
  submissionDailyCap: number
  autoPostCooldown: number
  autoPostWindowCap: number
  autoPostWindowMinutes: number
  userPostDailyCap: number
  userPendingCap: number
  globalSubmissionDailyCap: number
  circuitBreakerThreshold: number
  circuitBreakerCooldownMinutes: number
  circuitBreakerFailureWindowMinutes: number
}

export interface FilterSettings {
  autoApprove: boolean
  blockedWords: string[]
  nsfwWords: string[]
  filterRules: FilterRules
  geminiEnabled: boolean
  geminiApiKeySet: boolean
  rateLimits: RateLimitSettings
  whitelistUsernames: string[]
  blockedUsernames: string[]
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
  postMethodSetting?: PostMethod
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
  isCustom: boolean
  autoApprove?: boolean
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
  rateLimits?: RateLimitSettings
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
}

export interface AdminLoginResponse {
  token: string
}

// --- Default Values ---

export const DEFAULT_FILTER_RULES: FilterRules = {
  blockedWords: true,
  jualan: true,
  urls: true,
  mentions: true,
  phoneNumbers: true,
  nsfw: false,
  capsSpam: true,
  repeatedChars: true,
  tooShort: true,
  duplicate24h: true,
}

// Re-exported from @/lib/filter-settings for backward compatibility
export { DEFAULT_RATE_LIMITS } from '@/lib/filter-settings'

// --- Status Config (for UI rendering) ---

export const STATUS_CONFIG = {
  pending: { label: 'Menunggu', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  censored: { label: 'Disensor', color: 'bg-orange-100 text-orange-800 border-orange-300' },
  posting: { label: 'Posting', color: 'bg-blue-100 text-blue-800 border-blue-300' },
  post_failed: { label: 'Gagal', color: 'bg-red-100 text-red-800 border-red-300' },
  rejected: { label: 'Ditolak', color: 'bg-gray-100 text-gray-600 border-gray-300' },
  posted: { label: 'Diposting', color: 'bg-green-100 text-green-800 border-green-300' },
} as const

// --- Filter Reason Label Helper ---

export function getFilterReasonLabel(reason: string): string {
  // Blocked word — mask the word for display
  if (reason.startsWith('blocked_word:')) {
    const word = reason.replace('blocked_word:', '')
    const masked = word.length > 2
      ? word[0] + '*'.repeat(word.length - 2) + word[word.length - 1]
      : '**'
    return `Blocked: "${masked}"`
  }

  // NSFW word — mask the word for display
  if (reason.startsWith('nsfw_word:')) {
    const word = reason.replace('nsfw_word:', '')
    const masked = word.length > 2
      ? word[0] + '*'.repeat(word.length - 2) + word[word.length - 1]
      : '**'
    return `NSFW: "${masked}"`
  }

  if (reason === 'ai:skipped_error') return 'AI: Skipped (error)'
  if (reason.startsWith('ai:')) return `AI: ${reason.replace('ai:', '')}`

  // Jualan
  if (reason.startsWith('jualan:')) {
    const tag = reason.replace('jualan:', '')
    return `Marketplace (${tag})`
  }

  if (reason === 'contains_url') return 'Link'
  if (reason.startsWith('contains_mention')) return '@Mention'
  if (reason === 'contains_phone_number') return 'No. HP'
  if (reason === 'caps_spam') return 'ALL CAPS'
  if (reason === 'repeated_characters') return 'Spam chars'
  if (reason === 'too_short') return 'Terlalu pendek'
  if (reason === 'duplicate_24h') return 'Duplikat (24j)'
  return reason
}

export function parseFilterReasons(filterReasons: string | null): string[] {
  if (!filterReasons) return []
  try {
    const parsed = JSON.parse(filterReasons)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// --- Date Formatter ---

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Admin cookie helpers removed — auth is now handled via HttpOnly cookies
// set by the server on login. See src/lib/admin-auth.ts getAdminTokenFromRequest().
