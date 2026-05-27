import { db } from '@/lib/db'
import { debugError } from '@/lib/debug'
import { decryptSetting } from '@/lib/encrypt'
import {
  DEFAULT_BLOCKED_WORDS,
  DEFAULT_NSFW_WORDS,
  DEFAULT_FILTER_RULES,
  type FilterRules,
} from '@/lib/content-filter'
import { DEFAULT_RATE_LIMITS, parseIntSafe, type RateLimitSettings, DEFAULT_GEMINI_MODEL } from '@/lib/rate-limit-defaults'

// Settings keys for the filter feature
export const FILTER_SETTING_KEYS = [
  'auto_approve', 'blocked_words', 'filter_rules', 'nsfw_words',
  'gemini_enabled', 'gemini_api_key', 'gemini_model', 'gemini_system_prompt',
  'submission_cooldown', 'submission_daily_cap', 'auto_post_cooldown',
  'auto_post_window_cap', 'auto_post_window_minutes',
  'global_post_daily_cap',
  'user_post_daily_cap', 'user_pending_cap',
  'global_submission_daily_cap',
  'circuit_breaker_threshold', 'circuit_breaker_cooldown_minutes', 'circuit_breaker_failure_window_minutes',
  'whitelist_usernames', 'blocked_usernames',
  'blocked_reasons',
  'post_hashtags',
]

/**
 * Default filter settings — safe fallback when getFilterSettings() throws.
 * Used by submissions/route.ts catch block to ensure auto-approve is OFF
 * when settings can't be loaded (fail-closed).
 * CC = 1 (zero decision points — just returns an object literal).
 */
export function getDefaultFilterSettings() {
  return {
    autoApprove: false,
    blockedWords: DEFAULT_BLOCKED_WORDS,
    nsfwWords: DEFAULT_NSFW_WORDS,
    filterRules: { ...DEFAULT_FILTER_RULES },
    geminiEnabled: false,
    geminiApiKeySet: false,
    geminiApiKey: null as string | null,
    geminiModel: DEFAULT_GEMINI_MODEL,
    geminiSystemPrompt: null as string | null,
    rateLimits: { ...DEFAULT_RATE_LIMITS },
    whitelistUsernames: [] as string[],
    blockedUsernames: [] as string[],
    blockedReasons: {} as Record<string, string>,
    postHashtags: '',
  }
}

/**
 * Parse a JSON setting value with try/catch and type validation.
 * Eliminates repeated try/catch JSON.parse blocks in getFilterSettings().
 * Returns fallback when raw is null/empty, JSON is malformed, or validate returns null.
 */
function parseJsonSetting<T>(
  raw: string | null,
  validate: (parsed: unknown) => T | null,
  fallback: T,
): T {
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    const result = validate(parsed)
    return result ?? fallback
  } catch (e) {
    debugError('filter-settings', 'Failed to parse setting:', e)
    return fallback
  }
}

/**
 * Validate a JSON-parsed value as a string array, filtering out non-string/empty entries.
 * Shared by blocked_words, nsfw_words, whitelist_usernames, blocked_usernames.
 */
function validateStringArray(parsed: unknown): string[] | null {
  if (!Array.isArray(parsed)) return null
  return parsed.filter((w: unknown) => typeof w === 'string' && w.trim())
}

/**
 * Validate a JSON-parsed value as a string array with lowercase trimming.
 * Used for username arrays (whitelist, blocked).
 */
function validateLowercaseStringArray(parsed: unknown): string[] | null {
  const filtered = validateStringArray(parsed)
  if (!filtered) return null
  return filtered.map((u: string) => u.toLowerCase().trim())
}

/**
 * Validate blocked_reasons as Record<string, string>.
 * Returns empty {} as valid — no reasons set yet is normal state.
 * Keys are normalized to lowercase to match blocked_usernames convention.
 */
function validateBlockedReasons(parsed: unknown): Record<string, string> | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const result: Record<string, string> = {}
  for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof val === 'string') {
      result[key.toLowerCase().trim()] = val
    }
  }
  return result
}

// --- TTL Cache for getFilterSettings() ---

let cachedSettings: { data: Awaited<ReturnType<typeof getFilterSettings>>; ts: number } | null = null
const CACHE_TTL_MS = 30_000 // 30 seconds

function isCacheValid(): boolean {
  return cachedSettings !== null && (Date.now() - cachedSettings.ts) < CACHE_TTL_MS
}

export function invalidateFilterSettingsCache(): void {
  cachedSettings = null
}

export async function getFilterSettings(): Promise<{
  autoApprove: boolean
  blockedWords: string[]
  nsfwWords: string[]
  filterRules: FilterRules
  geminiEnabled: boolean
  geminiApiKeySet: boolean  // Only whether a key exists (never expose to browser)
  geminiApiKey: string | null  // The actual key — server-side only, strip before sending to client
  geminiModel: string
  geminiSystemPrompt: string | null
  rateLimits: RateLimitSettings
  whitelistUsernames: string[]  // Twitter usernames bypassing rate limits
  blockedUsernames: string[]    // Twitter usernames blocked from submitting
  blockedReasons: Record<string, string>  // Per-user custom block messages (companion to blocked_usernames)
  postHashtags: string          // Hashtags appended to auto-posted tweets
}> {
  if (isCacheValid() && cachedSettings) return structuredClone(cachedSettings.data)

  const settings = await db.setting.findMany({
    where: { key: { in: FILTER_SETTING_KEYS } },
  })

  function getRaw(key: string): string | null {
    const s = settings.find((s) => s.key === key)
    if (!s) return null
    return decryptSetting(s.value, '')
  }

  // Auto-approve: default false
  const autoApprove = getRaw('auto_approve') === 'true'

  // Blocked words: default list
  const blockedWords = parseJsonSetting(
    getRaw('blocked_words'), validateStringArray, DEFAULT_BLOCKED_WORDS,
  )

  // NSFW words: default list
  const nsfwWords = parseJsonSetting(
    getRaw('nsfw_words'), validateStringArray, DEFAULT_NSFW_WORDS,
  )

  // Filter rules: defaults (merge with defaults so new rules are added automatically)
  const filterRules = parseJsonSetting<FilterRules>(
    getRaw('filter_rules'),
    (p) => (p && typeof p === 'object' && !Array.isArray(p)) ? { ...DEFAULT_FILTER_RULES, ...(p as Partial<FilterRules>) } : null,
    { ...DEFAULT_FILTER_RULES },
  )

  // Gemini AI filter
  const geminiEnabled = getRaw('gemini_enabled') === 'true'
  const geminiApiKey = getRaw('gemini_api_key')
  const geminiApiKeySet = !!geminiApiKey && geminiApiKey.trim().length > 0
  const geminiModel = getRaw('gemini_model')?.trim() || DEFAULT_GEMINI_MODEL

  // Rate limit settings — using parseIntSafe to correctly handle 0 values
  // (parseInt("0") || default would treat 0 as falsy and revert to default)
  const submissionCooldown = Math.max(0, parseIntSafe(getRaw('submission_cooldown'), DEFAULT_RATE_LIMITS.submissionCooldown))
  const submissionDailyCap = Math.max(0, parseIntSafe(getRaw('submission_daily_cap'), DEFAULT_RATE_LIMITS.submissionDailyCap))
  const autoPostCooldown = Math.max(0, parseIntSafe(getRaw('auto_post_cooldown'), DEFAULT_RATE_LIMITS.autoPostCooldown))
  const autoPostWindowCap = Math.max(0, parseIntSafe(getRaw('auto_post_window_cap'), DEFAULT_RATE_LIMITS.autoPostWindowCap))
  const autoPostWindowMinutes = Math.max(1, parseIntSafe(getRaw('auto_post_window_minutes'), DEFAULT_RATE_LIMITS.autoPostWindowMinutes))
  const globalPostDailyCap = Math.max(0, parseIntSafe(getRaw('global_post_daily_cap'), DEFAULT_RATE_LIMITS.globalPostDailyCap))
  const userPostDailyCap = Math.max(0, parseIntSafe(getRaw('user_post_daily_cap'), DEFAULT_RATE_LIMITS.userPostDailyCap))
  const userPendingCap = Math.max(1, parseIntSafe(getRaw('user_pending_cap'), DEFAULT_RATE_LIMITS.userPendingCap))
  const globalSubmissionDailyCap = Math.max(0, parseIntSafe(getRaw('global_submission_daily_cap'), DEFAULT_RATE_LIMITS.globalSubmissionDailyCap))
  const circuitBreakerThreshold = Math.max(1, parseIntSafe(getRaw('circuit_breaker_threshold'), DEFAULT_RATE_LIMITS.circuitBreakerThreshold))
  const circuitBreakerCooldownMinutes = Math.max(1, parseIntSafe(getRaw('circuit_breaker_cooldown_minutes'), DEFAULT_RATE_LIMITS.circuitBreakerCooldownMinutes))
  const circuitBreakerFailureWindowMinutes = Math.max(1, parseIntSafe(getRaw('circuit_breaker_failure_window_minutes'), DEFAULT_RATE_LIMITS.circuitBreakerFailureWindowMinutes))

  // Whitelist usernames (bypass rate limits)
  const whitelistUsernames = parseJsonSetting(
    getRaw('whitelist_usernames'), validateLowercaseStringArray, [] as string[],
  )

  // Blocked usernames (cannot submit at all)
  const blockedUsernames = parseJsonSetting(
    getRaw('blocked_usernames'), validateLowercaseStringArray, [] as string[],
  )

  // Blocked reasons (companion to blocked_usernames — optional per-user block message)
  // Stored as {"username": "reason text"}. Missing key = default message.
  const blockedReasons = parseJsonSetting(
    getRaw('blocked_reasons'), validateBlockedReasons, {} as Record<string, string>,
  )

  // Gemini system prompt (custom override, encrypted like other content settings)
  const geminiSystemPrompt = getRaw('gemini_system_prompt')?.trim() || null

  // Post hashtags (appended to auto-posted tweets)
  const postHashtags = getRaw('post_hashtags')?.trim() || ''

  const result = {
    autoApprove,
    blockedWords,
    nsfwWords,
    filterRules,
    geminiEnabled,
    geminiApiKeySet,
    geminiApiKey: geminiApiKey?.trim() || null,
    geminiModel,
    geminiSystemPrompt,
    rateLimits: { submissionCooldown, submissionDailyCap, autoPostCooldown, autoPostWindowCap, autoPostWindowMinutes, globalPostDailyCap, userPostDailyCap, userPendingCap, globalSubmissionDailyCap, circuitBreakerThreshold, circuitBreakerCooldownMinutes, circuitBreakerFailureWindowMinutes },
    whitelistUsernames,
    blockedUsernames,
    blockedReasons,
    postHashtags,
  }

  cachedSettings = { data: result, ts: Date.now() }
  return structuredClone(result)
}
