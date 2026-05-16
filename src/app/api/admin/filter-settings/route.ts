import { db } from '@/lib/db'
import { decrypt, isEncrypted, encrypt } from '@/lib/encrypt'
import { verifyAdmin } from '@/lib/admin-auth'
import {
  DEFAULT_BLOCKED_WORDS,
  DEFAULT_NSFW_WORDS,
  DEFAULT_FILTER_RULES,
  type FilterRules,
} from '@/lib/content-filter'
import { NextRequest, NextResponse } from 'next/server'
import { getCircuitBreakerStatus } from '@/lib/circuit-breaker'

// Settings keys for the filter feature
const FILTER_SETTING_KEYS = [
  'auto_approve', 'blocked_words', 'filter_rules', 'nsfw_words',
  'gemini_enabled', 'gemini_api_key',
  'submission_cooldown', 'submission_daily_cap', 'auto_post_cooldown',
  'auto_post_window_cap', 'auto_post_window_minutes',
  'user_post_daily_cap', 'user_pending_cap',
  'global_submission_daily_cap',
  'circuit_breaker_threshold', 'circuit_breaker_cooldown_minutes', 'circuit_breaker_failure_window_minutes',
  'whitelist_usernames', 'blocked_usernames',
]

/**
 * Decrypt a value for display/masking purposes.
 */
function decryptValue(value: string): string {
  try {
    return isEncrypted(value) ? decrypt(value) : value
  } catch (e) {
    console.error('[filter-settings] Decryption failed:', e)
    return value
  }
}

/**
 * Safely parse an integer from a setting value, returning the fallback
 * only when the value is missing/null/empty/NaN. Unlike `parseInt(x) || fallback`,
 * this correctly returns 0 when the admin intentionally sets a value to 0.
 */
function parseIntSafe(raw: string | null, fallback: number): number {
  if (raw === null || raw === '') return fallback
  const parsed = parseInt(raw, 10)
  if (Number.isNaN(parsed)) return fallback
  return parsed
}

/**
 * Get all filter settings as structured objects.
 */
// Default rate limit settings
export const DEFAULT_RATE_LIMITS = {
  submissionCooldown: 2,                // minutes between submissions
  submissionDailyCap: 20,               // max submissions per user per day
  autoPostCooldown: 10,                 // seconds between auto-posts to X
  autoPostWindowCap: 25,                // max auto-posts per time window
  autoPostWindowMinutes: 30,            // the time window in minutes
  userPostDailyCap: 5,                  // max posts per user per day on X
  userPendingCap: 5,                    // max pending submissions per user
  globalSubmissionDailyCap: 200,        // max submissions from ALL users per day
  circuitBreakerThreshold: 3,           // consecutive failures before circuit breaker pauses
  circuitBreakerCooldownMinutes: 30,    // how long circuit breaker pauses auto-post
  circuitBreakerFailureWindowMinutes: 30, // max gap between consecutive failures (streak breaker)
}

export interface RateLimitSettings {
  submissionCooldown: number             // minutes
  submissionDailyCap: number             // count
  autoPostCooldown: number               // seconds
  autoPostWindowCap: number              // max posts per window
  autoPostWindowMinutes: number          // window size in minutes
  userPostDailyCap: number               // max posts per user per day on X
  userPendingCap: number                 // max pending submissions per user
  globalSubmissionDailyCap: number       // max submissions from ALL users per day
  circuitBreakerThreshold: number        // consecutive failures before pause
  circuitBreakerCooldownMinutes: number  // how long to pause
  circuitBreakerFailureWindowMinutes: number  // max gap between failures (streak breaker)
}

export async function getFilterSettings(): Promise<{
  autoApprove: boolean
  blockedWords: string[]
  nsfwWords: string[]
  filterRules: FilterRules
  geminiEnabled: boolean
  geminiApiKeySet: boolean  // Only whether a key exists (never expose the key)
  rateLimits: RateLimitSettings
  whitelistUsernames: string[]  // Twitter usernames bypassing rate limits
  blockedUsernames: string[]    // Twitter usernames blocked from submitting
}> {
  const settings = await db.setting.findMany({
    where: { key: { in: FILTER_SETTING_KEYS } },
  })

  const getRaw = (key: string): string | null => {
    const s = settings.find((s) => s.key === key)
    if (!s) return null
    return decryptValue(s.value)
  }

  // Auto-approve: default false
  const autoApprove = getRaw('auto_approve') === 'true'

  // Blocked words: default list
  let blockedWords = DEFAULT_BLOCKED_WORDS
  const blockedWordsRaw = getRaw('blocked_words')
  if (blockedWordsRaw) {
    try {
      const parsed = JSON.parse(blockedWordsRaw)
      if (Array.isArray(parsed)) {
        blockedWords = parsed.filter((w: unknown) => typeof w === 'string' && w.trim())
      }
    } catch (e) {
      console.error('[filter-settings] Failed to parse blocked_words:', e)
    }
  }

  // NSFW words: default list
  let nsfwWords = DEFAULT_NSFW_WORDS
  const nsfwWordsRaw = getRaw('nsfw_words')
  if (nsfwWordsRaw) {
    try {
      const parsed = JSON.parse(nsfwWordsRaw)
      if (Array.isArray(parsed)) {
        nsfwWords = parsed.filter((w: unknown) => typeof w === 'string' && w.trim())
      }
    } catch (e) {
      console.error('[filter-settings] Failed to parse nsfw_words:', e)
    }
  }

  // Filter rules: defaults
  let filterRules = { ...DEFAULT_FILTER_RULES }
  const filterRulesRaw = getRaw('filter_rules')
  if (filterRulesRaw) {
    try {
      const parsed = JSON.parse(filterRulesRaw) as Partial<FilterRules>
      // Merge with defaults so new rules are added automatically
      filterRules = { ...DEFAULT_FILTER_RULES, ...parsed }
    } catch (e) {
      console.error('[filter-settings] Failed to parse filter_rules:', e)
    }
  }

  // Gemini AI filter
  const geminiEnabled = getRaw('gemini_enabled') === 'true'
  const geminiApiKey = getRaw('gemini_api_key')
  const geminiApiKeySet = !!geminiApiKey && geminiApiKey.trim().length > 0

  // Rate limit settings — using parseIntSafe to correctly handle 0 values
  // (parseInt("0") || default would treat 0 as falsy and revert to default)
  const submissionCooldown = Math.max(0, parseIntSafe(getRaw('submission_cooldown'), DEFAULT_RATE_LIMITS.submissionCooldown))
  const submissionDailyCap = Math.max(0, parseIntSafe(getRaw('submission_daily_cap'), DEFAULT_RATE_LIMITS.submissionDailyCap))
  const autoPostCooldown = Math.max(0, parseIntSafe(getRaw('auto_post_cooldown'), DEFAULT_RATE_LIMITS.autoPostCooldown))
  const autoPostWindowCap = Math.max(0, parseIntSafe(getRaw('auto_post_window_cap'), DEFAULT_RATE_LIMITS.autoPostWindowCap))
  const autoPostWindowMinutes = Math.max(1, parseIntSafe(getRaw('auto_post_window_minutes'), DEFAULT_RATE_LIMITS.autoPostWindowMinutes))
  const userPostDailyCap = Math.max(0, parseIntSafe(getRaw('user_post_daily_cap'), DEFAULT_RATE_LIMITS.userPostDailyCap))
  const userPendingCap = Math.max(1, parseIntSafe(getRaw('user_pending_cap'), DEFAULT_RATE_LIMITS.userPendingCap))
  const globalSubmissionDailyCap = Math.max(0, parseIntSafe(getRaw('global_submission_daily_cap'), DEFAULT_RATE_LIMITS.globalSubmissionDailyCap))
  const circuitBreakerThreshold = Math.max(1, parseIntSafe(getRaw('circuit_breaker_threshold'), DEFAULT_RATE_LIMITS.circuitBreakerThreshold))
  const circuitBreakerCooldownMinutes = Math.max(1, parseIntSafe(getRaw('circuit_breaker_cooldown_minutes'), DEFAULT_RATE_LIMITS.circuitBreakerCooldownMinutes))
  const circuitBreakerFailureWindowMinutes = Math.max(1, parseIntSafe(getRaw('circuit_breaker_failure_window_minutes'), DEFAULT_RATE_LIMITS.circuitBreakerFailureWindowMinutes))

  // Whitelist usernames (bypass rate limits)
  let whitelistUsernames: string[] = []
  const whitelistRaw = getRaw('whitelist_usernames')
  if (whitelistRaw) {
    try {
      const parsed = JSON.parse(whitelistRaw)
      if (Array.isArray(parsed)) {
        whitelistUsernames = parsed
          .filter((u: unknown) => typeof u === 'string' && u.trim())
          .map((u: string) => u.toLowerCase().trim())
      }
    } catch (e) {
      console.error('[filter-settings] Failed to parse whitelist_usernames:', e)
    }
  }

  // Blocked usernames (cannot submit at all)
  let blockedUsernames: string[] = []
  const blockedRaw = getRaw('blocked_usernames')
  if (blockedRaw) {
    try {
      const parsed = JSON.parse(blockedRaw)
      if (Array.isArray(parsed)) {
        blockedUsernames = parsed
          .filter((u: unknown) => typeof u === 'string' && u.trim())
          .map((u: string) => u.toLowerCase().trim())
      }
    } catch (e) {
      console.error('[filter-settings] Failed to parse blocked_usernames:', e)
    }
  }

  return {
    autoApprove,
    blockedWords,
    nsfwWords,
    filterRules,
    geminiEnabled,
    geminiApiKeySet,
    rateLimits: { submissionCooldown, submissionDailyCap, autoPostCooldown, autoPostWindowCap, autoPostWindowMinutes, userPostDailyCap, userPendingCap, globalSubmissionDailyCap, circuitBreakerThreshold, circuitBreakerCooldownMinutes, circuitBreakerFailureWindowMinutes },
    whitelistUsernames,
    blockedUsernames,
  }
}

/**
 * Get the actual Gemini API key (for server-side use only).
 * Returns null if not configured.
 */
export async function getGeminiApiKey(): Promise<string | null> {
  const setting = await db.setting.findUnique({ where: { key: 'gemini_api_key' } })
  if (!setting) return null
  const decrypted = decryptValue(setting.value)
  return decrypted?.trim() || null
}

// GET /api/admin/filter-settings — Return filter settings
export async function GET(req: NextRequest) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

  const settings = await getFilterSettings()
  const circuitBreaker = await getCircuitBreakerStatus(settings.rateLimits)

  return NextResponse.json({
    autoApprove: settings.autoApprove,
    blockedWords: settings.blockedWords,
    nsfwWords: settings.nsfwWords,
    filterRules: settings.filterRules,
    geminiEnabled: settings.geminiEnabled,
    geminiApiKeySet: settings.geminiApiKeySet,
    rateLimits: settings.rateLimits,
    whitelistUsernames: settings.whitelistUsernames,
    blockedUsernames: settings.blockedUsernames,
    circuitBreaker,
    defaults: {
      blockedWords: DEFAULT_BLOCKED_WORDS,
      nsfwWords: DEFAULT_NSFW_WORDS,
      filterRules: DEFAULT_FILTER_RULES,
      rateLimits: DEFAULT_RATE_LIMITS,
    },
  })
}

// POST /api/admin/filter-settings — Save filter settings
export async function POST(req: NextRequest) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

  try {
    const body = await req.json()
    const { autoApprove, blockedWords, nsfwWords, filterRules, geminiEnabled, geminiApiKey, rateLimits, whitelistUsernames, blockedUsernames } = body as {
      autoApprove?: boolean
      blockedWords?: string[]
      nsfwWords?: string[]
      filterRules?: Partial<FilterRules>
      geminiEnabled?: boolean
      geminiApiKey?: string
      rateLimits?: { submissionCooldown?: number; submissionDailyCap?: number; autoPostCooldown?: number; autoPostWindowCap?: number; autoPostWindowMinutes?: number; userPostDailyCap?: number; userPendingCap?: number; globalSubmissionDailyCap?: number; circuitBreakerThreshold?: number; circuitBreakerCooldownMinutes?: number; circuitBreakerFailureWindowMinutes?: number }
      whitelistUsernames?: string[]
      blockedUsernames?: string[]
    }

    const results: { key: string; updated: boolean }[] = []

    // Save auto_approve (not encrypted, like post_method)
    if (typeof autoApprove === 'boolean') {
      await db.setting.upsert({
        where: { key: 'auto_approve' },
        update: { value: autoApprove ? 'true' : 'false' },
        create: { key: 'auto_approve', value: autoApprove ? 'true' : 'false' },
      })
      results.push({ key: 'auto_approve', updated: true })
    }

    // Save blocked_words (encrypted JSON array)
    if (Array.isArray(blockedWords)) {
      // Validate each word is a non-empty string
      const validWords = blockedWords.filter(
        (w: unknown) => typeof w === 'string' && w.trim().length > 0
      )
      // Deduplicate
      const uniqueWords = [...new Set(validWords.map((w: string) => w.toLowerCase().trim()))]

      const encryptedValue = encrypt(JSON.stringify(uniqueWords))

      await db.setting.upsert({
        where: { key: 'blocked_words' },
        update: { value: encryptedValue },
        create: { key: 'blocked_words', value: encryptedValue },
      })
      results.push({ key: 'blocked_words', updated: true })
    }

    // Save nsfw_words (encrypted JSON array)
    if (Array.isArray(nsfwWords)) {
      const validWords = nsfwWords.filter(
        (w: unknown) => typeof w === 'string' && w.trim().length > 0
      )
      const uniqueWords = [...new Set(validWords.map((w: string) => w.toLowerCase().trim()))]

      const encryptedValue = encrypt(JSON.stringify(uniqueWords))

      await db.setting.upsert({
        where: { key: 'nsfw_words' },
        update: { value: encryptedValue },
        create: { key: 'nsfw_words', value: encryptedValue },
      })
      results.push({ key: 'nsfw_words', updated: true })
    }

    // Save filter_rules (encrypted JSON object)
    if (filterRules && typeof filterRules === 'object') {
      // Merge with defaults for any missing keys
      const merged = { ...DEFAULT_FILTER_RULES, ...filterRules }

      const encryptedValue = encrypt(JSON.stringify(merged))

      await db.setting.upsert({
        where: { key: 'filter_rules' },
        update: { value: encryptedValue },
        create: { key: 'filter_rules', value: encryptedValue },
      })
      results.push({ key: 'filter_rules', updated: true })
    }

    // Save gemini_enabled (not encrypted, like auto_approve)
    if (typeof geminiEnabled === 'boolean') {
      await db.setting.upsert({
        where: { key: 'gemini_enabled' },
        update: { value: geminiEnabled ? 'true' : 'false' },
        create: { key: 'gemini_enabled', value: geminiEnabled ? 'true' : 'false' },
      })
      results.push({ key: 'gemini_enabled', updated: true })
    }

    // Save gemini_api_key (encrypted, sensitive)
    if (typeof geminiApiKey === 'string') {
      if (geminiApiKey.trim()) {
        const encryptedValue = encrypt(geminiApiKey.trim())
        await db.setting.upsert({
          where: { key: 'gemini_api_key' },
          update: { value: encryptedValue },
          create: { key: 'gemini_api_key', value: encryptedValue },
        })
      } else {
        // Empty string = delete the key
        await db.setting.deleteMany({ where: { key: 'gemini_api_key' } })
      }
      results.push({ key: 'gemini_api_key', updated: true })
    }

    // Save rate limit settings (not encrypted, simple integers)
    if (rateLimits) {
      if (typeof rateLimits.submissionCooldown === 'number') {
        const val = Math.min(60, Math.max(0, rateLimits.submissionCooldown)).toString()
        await db.setting.upsert({
          where: { key: 'submission_cooldown' },
          update: { value: val },
          create: { key: 'submission_cooldown', value: val },
        })
        results.push({ key: 'submission_cooldown', updated: true })
      }
      if (typeof rateLimits.submissionDailyCap === 'number') {
        const val = Math.min(100, Math.max(0, rateLimits.submissionDailyCap)).toString()
        await db.setting.upsert({
          where: { key: 'submission_daily_cap' },
          update: { value: val },
          create: { key: 'submission_daily_cap', value: val },
        })
        results.push({ key: 'submission_daily_cap', updated: true })
      }
      if (typeof rateLimits.autoPostCooldown === 'number') {
        const val = Math.min(120, Math.max(0, rateLimits.autoPostCooldown)).toString()
        await db.setting.upsert({
          where: { key: 'auto_post_cooldown' },
          update: { value: val },
          create: { key: 'auto_post_cooldown', value: val },
        })
        results.push({ key: 'auto_post_cooldown', updated: true })
      }
      if (typeof rateLimits.autoPostWindowCap === 'number') {
        const val = Math.min(500, Math.max(0, rateLimits.autoPostWindowCap)).toString()
        await db.setting.upsert({
          where: { key: 'auto_post_window_cap' },
          update: { value: val },
          create: { key: 'auto_post_window_cap', value: val },
        })
        results.push({ key: 'auto_post_window_cap', updated: true })
      }
      if (typeof rateLimits.autoPostWindowMinutes === 'number') {
        const val = Math.min(1440, Math.max(1, rateLimits.autoPostWindowMinutes)).toString()
        await db.setting.upsert({
          where: { key: 'auto_post_window_minutes' },
          update: { value: val },
          create: { key: 'auto_post_window_minutes', value: val },
        })
        results.push({ key: 'auto_post_window_minutes', updated: true })
      }
      if (typeof rateLimits.userPostDailyCap === 'number') {
        const val = Math.min(100, Math.max(0, rateLimits.userPostDailyCap)).toString()
        await db.setting.upsert({
          where: { key: 'user_post_daily_cap' },
          update: { value: val },
          create: { key: 'user_post_daily_cap', value: val },
        })
        results.push({ key: 'user_post_daily_cap', updated: true })
      }
      if (typeof rateLimits.userPendingCap === 'number') {
        const val = Math.min(50, Math.max(1, rateLimits.userPendingCap)).toString()
        await db.setting.upsert({
          where: { key: 'user_pending_cap' },
          update: { value: val },
          create: { key: 'user_pending_cap', value: val },
        })
        results.push({ key: 'user_pending_cap', updated: true })
      }
      if (typeof rateLimits.globalSubmissionDailyCap === 'number') {
        const val = Math.min(10000, Math.max(0, rateLimits.globalSubmissionDailyCap)).toString()
        await db.setting.upsert({
          where: { key: 'global_submission_daily_cap' },
          update: { value: val },
          create: { key: 'global_submission_daily_cap', value: val },
        })
        results.push({ key: 'global_submission_daily_cap', updated: true })
      }
      if (typeof rateLimits.circuitBreakerThreshold === 'number') {
        const val = Math.min(20, Math.max(1, rateLimits.circuitBreakerThreshold)).toString()
        await db.setting.upsert({
          where: { key: 'circuit_breaker_threshold' },
          update: { value: val },
          create: { key: 'circuit_breaker_threshold', value: val },
        })
        results.push({ key: 'circuit_breaker_threshold', updated: true })
      }
      if (typeof rateLimits.circuitBreakerCooldownMinutes === 'number') {
        const val = Math.min(1440, Math.max(1, rateLimits.circuitBreakerCooldownMinutes)).toString()
        await db.setting.upsert({
          where: { key: 'circuit_breaker_cooldown_minutes' },
          update: { value: val },
          create: { key: 'circuit_breaker_cooldown_minutes', value: val },
        })
        results.push({ key: 'circuit_breaker_cooldown_minutes', updated: true })
      }
      if (typeof rateLimits.circuitBreakerFailureWindowMinutes === 'number') {
        const val = Math.min(1440, Math.max(1, rateLimits.circuitBreakerFailureWindowMinutes)).toString()
        await db.setting.upsert({
          where: { key: 'circuit_breaker_failure_window_minutes' },
          update: { value: val },
          create: { key: 'circuit_breaker_failure_window_minutes', value: val },
        })
        results.push({ key: 'circuit_breaker_failure_window_minutes', updated: true })
      }
    }

    // Save whitelist usernames (atomic merge — doesn't overwrite concurrent block/unblock changes)
    if (Array.isArray(whitelistUsernames)) {
      const valid = whitelistUsernames
        .filter((u: unknown) => typeof u === 'string' && u.trim())
        .map((u: string) => u.toLowerCase().trim())
      const unique = [...new Set(valid)]
      // Read current value, merge with admin's list, then write back.
      // This ensures that if a concurrent block/unblock route modified the
      // array while admin was editing, those changes are preserved.
      const currentWhitelist = await db.setting.findUnique({ where: { key: 'whitelist_usernames' } })
      const currentList: string[] = currentWhitelist
        ? (() => { try { const parsed = JSON.parse(decryptValue(currentWhitelist.value)); return Array.isArray(parsed) ? parsed : [] } catch { return [] } })()
        : []
      const merged = [...new Set([...currentList.filter((u: string) => typeof u === 'string' && u.trim()).map((u: string) => u.toLowerCase().trim()), ...unique])]
      await db.setting.upsert({
        where: { key: 'whitelist_usernames' },
        update: { value: JSON.stringify(merged) },
        create: { key: 'whitelist_usernames', value: JSON.stringify(merged) },
      })
      results.push({ key: 'whitelist_usernames', updated: true })
    }

    // Save blocked usernames (atomic merge — doesn't overwrite concurrent block/unblock changes)
    if (Array.isArray(blockedUsernames)) {
      const valid = blockedUsernames
        .filter((u: unknown) => typeof u === 'string' && u.trim())
        .map((u: string) => u.toLowerCase().trim())
      const unique = [...new Set(valid)]
      const currentBlocked = await db.setting.findUnique({ where: { key: 'blocked_usernames' } })
      const currentList: string[] = currentBlocked
        ? (() => { try { const parsed = JSON.parse(decryptValue(currentBlocked.value)); return Array.isArray(parsed) ? parsed : [] } catch { return [] } })()
        : []
      const merged = [...new Set([...currentList.filter((u: string) => typeof u === 'string' && u.trim()).map((u: string) => u.toLowerCase().trim()), ...unique])]
      await db.setting.upsert({
        where: { key: 'blocked_usernames' },
        update: { value: JSON.stringify(merged) },
        create: { key: 'blocked_usernames', value: JSON.stringify(merged) },
      })
      results.push({ key: 'blocked_usernames', updated: true })
    }

    return NextResponse.json({ success: true, results })
  } catch (e) {
    console.error('[filter-settings] Save error:', e)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
