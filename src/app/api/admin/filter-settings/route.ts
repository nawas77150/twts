import { db } from '@/lib/db'
import { encrypt } from '@/lib/encrypt'
import { withAdmin } from '@/lib/admin-auth'
import {
  DEFAULT_BLOCKED_WORDS,
  DEFAULT_NSFW_WORDS,
  DEFAULT_FILTER_RULES,
  type FilterRules,
} from '@/lib/content-filter'
import { getFilterSettings, invalidateFilterSettingsCache } from '@/lib/filter-settings'
import { DEFAULT_RATE_LIMITS } from '@/lib/rate-limit-defaults'
import { NextRequest, NextResponse } from 'next/server'
import { getCircuitBreakerStatus } from '@/lib/circuit-breaker'

// Rate-limit settings: field name → DB key + clamp bounds
// max: null means no upper clamp (e.g. autoPostCooldown, globalPostDailyCap)
const RATE_LIMIT_DEFS = [
  { field: 'submissionCooldown',                key: 'submission_cooldown',                 min: 0, max: 60 },
  { field: 'submissionDailyCap',                key: 'submission_daily_cap',                min: 0, max: 100 },
  { field: 'autoPostCooldown',                  key: 'auto_post_cooldown',                  min: 0, max: null as number | null },
  { field: 'autoPostWindowCap',                 key: 'auto_post_window_cap',                min: 0, max: 500 },
  { field: 'autoPostWindowMinutes',             key: 'auto_post_window_minutes',            min: 1, max: 1440 },
  { field: 'globalPostDailyCap',                key: 'global_post_daily_cap',               min: 0, max: null as number | null },
  { field: 'userPostDailyCap',                  key: 'user_post_daily_cap',                 min: 0, max: 100 },
  { field: 'userPendingCap',                    key: 'user_pending_cap',                    min: 1, max: 50 },
  { field: 'globalSubmissionDailyCap',          key: 'global_submission_daily_cap',         min: 0, max: 10000 },
  { field: 'circuitBreakerThreshold',           key: 'circuit_breaker_threshold',           min: 1, max: 20 },
  { field: 'circuitBreakerCooldownMinutes',     key: 'circuit_breaker_cooldown_minutes',    min: 1, max: 1440 },
  { field: 'circuitBreakerFailureWindowMinutes', key: 'circuit_breaker_failure_window_minutes', min: 1, max: 1440 },
] as const

/**
 * Upsert rate-limit settings using the definition table.
 * Wrapped in a transaction so partial failures don't leave the DB
 * in an inconsistent state (some limits updated, others not).
 */
async function upsertRateLimits(
  rateLimits: Record<string, number | undefined>,
  results: { key: string; updated: boolean }[],
): Promise<void> {
  await db.$transaction(async (tx) => {
    for (const def of RATE_LIMIT_DEFS) {
      const raw = rateLimits[def.field]
      if (typeof raw === 'number') {
        const clamped = def.max !== null
          ? Math.min(def.max, Math.max(def.min, raw))
          : Math.max(def.min, raw)
        const val = clamped.toString()
        await tx.setting.upsert({
          where: { key: def.key },
          update: { value: val },
          create: { key: def.key, value: val },
        })
        results.push({ key: def.key, updated: true })
      }
    }
  })
}

// GET /api/admin/filter-settings — Return filter settings
export const GET = withAdmin(async (req: NextRequest) => {
  const settings = await getFilterSettings()
  const circuitBreaker = await getCircuitBreakerStatus(settings.rateLimits)

  return NextResponse.json({
    autoApprove: settings.autoApprove,
    blockedWords: settings.blockedWords,
    nsfwWords: settings.nsfwWords,
    filterRules: settings.filterRules,
    geminiEnabled: settings.geminiEnabled,
    geminiApiKeySet: settings.geminiApiKeySet,
    geminiModel: settings.geminiModel,
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
})

// POST /api/admin/filter-settings — Save filter settings
export const POST = withAdmin(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const { autoApprove, blockedWords, nsfwWords, filterRules, geminiEnabled, geminiApiKey, geminiModel, rateLimits } = body as {
      autoApprove?: boolean
      blockedWords?: string[]
      nsfwWords?: string[]
      filterRules?: Partial<FilterRules>
      geminiEnabled?: boolean
      geminiApiKey?: string
      geminiModel?: string
      rateLimits?: { submissionCooldown?: number; submissionDailyCap?: number; autoPostCooldown?: number; autoPostWindowCap?: number; autoPostWindowMinutes?: number; globalPostDailyCap?: number; userPostDailyCap?: number; userPendingCap?: number; globalSubmissionDailyCap?: number; circuitBreakerThreshold?: number; circuitBreakerCooldownMinutes?: number; circuitBreakerFailureWindowMinutes?: number }
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

    // Save gemini_model (not encrypted, not sensitive)
    if (typeof geminiModel === 'string' && geminiModel.trim()) {
      await db.setting.upsert({
        where: { key: 'gemini_model' },
        update: { value: geminiModel.trim() },
        create: { key: 'gemini_model', value: geminiModel.trim() },
      })
      results.push({ key: 'gemini_model', updated: true })
    }

    // Save rate limit settings (not encrypted, simple integers)
    if (rateLimits) {
      await upsertRateLimits(rateLimits, results)
    }

    // NOTE: whitelist_usernames and blocked_usernames are NO LONGER saved here.
    // They are managed exclusively through the dedicated atomic API routes:
    //   POST   /api/admin/submitters/whitelist  (add to whitelist + remove from blocked)
    //   DELETE /api/admin/submitters/whitelist  (remove from whitelist)
    //   POST   /api/admin/submitters/block      (add to blocked + remove from whitelist)
    //   POST   /api/admin/submitters/unblock    (remove from blocked)
    //
    // Previous implementation used a non-atomic read-merge-write (union) that could
    // re-add usernames removed by concurrent block/unblock operations when the admin
    // saved filter settings with stale form data. The dedicated routes use atomic
    // PostgreSQL jsonb operations that prevent this race condition entirely.

    // Invalidate cache so next getFilterSettings() reads fresh data from DB
    invalidateFilterSettingsCache()

    return NextResponse.json({ success: true, results })
  } catch (e) {
    console.error('[filter-settings] Save error:', e)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
})
