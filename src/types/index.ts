// ============================================================
// Tweetfess — Shared TypeScript Types
// ============================================================

// --- Status ---

export type SubmissionStatus = 'pending' | 'post_failed' | 'rejected' | 'posted'

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
  totalSubmissions: number
  posted: number
  pending: number
  rejected: number
  postFailed: number
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
  whitelistUsernames?: string[]
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

export const DEFAULT_RATE_LIMITS: RateLimitSettings = {
  submissionCooldown: 2,
  submissionDailyCap: 20,
  autoPostCooldown: 10,
  autoPostWindowCap: 25,
  autoPostWindowMinutes: 30,
  userPostDailyCap: 5,
  userPendingCap: 5,
  globalSubmissionDailyCap: 200,
  circuitBreakerThreshold: 3,
  circuitBreakerCooldownMinutes: 30,
}

// --- Status Config (for UI rendering) ---

export const STATUS_CONFIG = {
  pending: { label: 'Menunggu', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  post_failed: { label: 'Gagal Posting', color: 'bg-red-100 text-red-800 border-red-300' },
  rejected: { label: 'Ditolak', color: 'bg-gray-100 text-gray-600 border-gray-300' },
  posted: { label: 'Diposting', color: 'bg-[#F7F9F9] text-[#3D4145] border-[#EFF3F4]' },
} as const

// --- Filter Reason Label Helper ---

export function getFilterReasonLabel(reason: string): string {
  if (reason.startsWith('blocked_word:')) {
    return `"${reason.replace('blocked_word:', '').replace(/(.).+(.)/, (_, a, b) => a + '***' + b)}"`
  }
  if (reason.startsWith('ai:')) return `AI: ${reason.replace('ai:', '')}`
  if (reason.startsWith('jualan:')) return 'Jualan'
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
    return JSON.parse(filterReasons)
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

// --- Admin Cookie Helpers ---

const ADMIN_COOKIE = 'tweetfess_admin'

export function setAdminCookie(token: string): void {
  document.cookie = `${ADMIN_COOKIE}=${encodeURIComponent(token)};path=/;max-age=${7 * 24 * 60 * 60};samesite=strict`
}

export function getAdminCookie(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${ADMIN_COOKIE}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : ''
}

export function clearAdminCookie(): void {
  document.cookie = `${ADMIN_COOKIE}=;path=/;max-age=0`
}
