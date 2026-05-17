import { db } from '@/lib/db'
import { encrypt } from '@/lib/encrypt'
import { verifyAdmin, getAdminTokenFromRequest } from '@/lib/admin-auth'
import {
  DEFAULT_BLOCKED_WORDS,
  DEFAULT_NSFW_WORDS,
  DEFAULT_FILTER_RULES,
  type FilterRules,
} from '@/lib/content-filter'
import { getFilterSettings, DEFAULT_RATE_LIMITS } from '@/lib/filter-settings'
import { NextRequest, NextResponse } from 'next/server'
import { getCircuitBreakerStatus } from '@/lib/circuit-breaker'

// GET /api/admin/filter-settings — Return filter settings
export async function GET(req: NextRequest) {
  const auth = verifyAdmin(getAdminTokenFromRequest(req))
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
}

// POST /api/admin/filter-settings — Save filter settings
export async function POST(req: NextRequest) {
  const auth = verifyAdmin(getAdminTokenFromRequest(req))
  if (!auth.authorized) return auth.response

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
      rateLimits?: { submissionCooldown?: number; submissionDailyCap?: number; autoPostCooldown?: number; autoPostWindowCap?: number; autoPostWindowMinutes?: number; userPostDailyCap?: number; userPendingCap?: number; globalSubmissionDailyCap?: number; circuitBreakerThreshold?: number; circuitBreakerCooldownMinutes?: number; circuitBreakerFailureWindowMinutes?: number }
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

    return NextResponse.json({ success: true, results })
  } catch (e) {
    console.error('[filter-settings] Save error:', e)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
