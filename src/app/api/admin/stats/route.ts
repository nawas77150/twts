import { db } from '@/lib/db'
import { postingService } from '@/lib/posting-service'
import { getApiCreditsNonBlocking, getCachedApiCredits, getApiLoginStatus, invalidateCreditsCache } from '@/lib/twitter-api-fallback'
import { withAdmin } from '@/lib/admin-auth'
import { getFilterSettings, invalidateFilterSettingsCache } from '@/lib/filter-settings'
import { getCircuitBreakerStatus } from '@/lib/circuit-breaker'
import { isEncryptionEnabled } from '@/lib/encrypt'
import { debugError } from '@/lib/debug'
import { DEFAULT_BLOCKED_WORDS, DEFAULT_NSFW_WORDS } from '@/lib/content-filter'
import { NextRequest, NextResponse } from 'next/server'

// Vercel serverless function timeout — multiple DB queries + external API calls
export const maxDuration = 30

// GET /api/admin/stats - Get dashboard stats + post method ratio + API credits + login status
export const GET = withAdmin(async (req: NextRequest) => {
  // If refresh=true, invalidate caches before fetching
  // On Vercel serverless, each API route is a separate function instance —
  // mutation routes invalidate their own cache but not the stats route's cache.
  // Passing refresh=true ensures the stats route also clears its stale data.
  if (req.nextUrl.searchParams.get('refresh') === 'true') {
    invalidateCreditsCache()
    invalidateFilterSettingsCache()
  }

  try {
  // 1. Single GROUP BY for all submission counts (was 6 separate count() queries)
  const statusCounts = await db.$queryRaw<
    { status: string; count: bigint }[]
  >`
    SELECT status, COUNT(*) as count
    FROM "Submission"
    GROUP BY status
  `
  const counts: Record<string, number> = {}
  let total = 0
  for (const row of statusCounts) {
    const c = Number(row.count)
    counts[row.status] = c
    total += c
  }

  // 2. All DB-only queries in parallel (fast — <5ms total)
  const [submitters, postMethodStats, cookieAuthStatus, apiLoginStatus, postMethodSetting, filterSettingsData] =
    await Promise.all([
      db.submitter.count(),
      getPostMethodStats(),
      postingService.getAuthStatus(),
      getApiLoginStatus(),
      getPostMethodSetting(),
      getFilterSettings(),
    ])

  // Strip geminiApiKey before sending to client (server-side only field)
  const { geminiApiKey: _geminiApiKey, ...safeFilterSettings } = filterSettingsData

  // 3. API credits — try non-blocking first (instant if cached).
  // On cold start / after cache invalidation, fall through to blocking fetch
  // so credits always appear (no more "refresh a few times" issue).
  let apiCredits = getApiCreditsNonBlocking()
  if (apiCredits === null) {
    apiCredits = await getCachedApiCredits()
  }

  // Get circuit breaker status separately (needs filterSettings.rateLimits)
  const circuitBreaker = await getCircuitBreakerStatus(filterSettingsData.rateLimits)

  return NextResponse.json({
    pending: counts['pending'] || 0,
    censored: counts['censored'] || 0,
    posting: counts['posting'] || 0,
    postFailed: counts['post_failed'] || 0,
    rejected: counts['rejected'] || 0,
    posted: counts['posted'] || 0,
    total,
    submitters,
    cookieAuthStatus,
    postMethodStats,
    apiCredits,
    apiLoginStatus,
    postMethodSetting,
    filterSettings: {
      ...safeFilterSettings,
      defaultBlockedWords: DEFAULT_BLOCKED_WORDS,
      defaultNsfwWords: DEFAULT_NSFW_WORDS,
    },
    circuitBreaker,
    encryptionEnabled: isEncryptionEnabled(),
  })
  } catch (error) {
    debugError('admin/stats', 'GET error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
})

/**
 * Calculate post method statistics from posted submissions.
 * Returns counts and success rates for direct/retry/fallback methods.
 */
async function getPostMethodStats(): Promise<{
  total: number
  direct: number
  retry: number
  fallback: number
  directRate: number
  retryRate: number
  fallbackRate: number
}> {
  // Single GROUP BY instead of loading all posted rows into JS
  const rows = await db.$queryRaw<
    { postMethod: string | null; count: bigint }[]
  >`
    SELECT "postMethod", COUNT(*) as count
    FROM "Submission"
    WHERE status = 'posted'
    GROUP BY "postMethod"
  `

  let direct = 0
  let retry = 0
  let fallback = 0
  let unknown = 0

  for (const row of rows) {
    const count = Number(row.count)
    if (row.postMethod === 'direct') direct = count
    else if (row.postMethod === 'retry') retry = count
    else if (row.postMethod === 'fallback' || row.postMethod === 'fallback_cookie' || row.postMethod === 'fallback_login') fallback = count
    else unknown += count // Legacy posts (no postMethod) count as direct
  }

  const total = direct + retry + fallback + unknown

  return {
    total,
    direct: direct + unknown, // Legacy posts (no postMethod) count as direct
    retry,
    fallback,
    directRate: total > 0 ? Math.round(((direct + unknown) / total) * 1000) / 10 : 0,
    retryRate: total > 0 ? Math.round((retry / total) * 1000) / 10 : 0,
    fallbackRate: total > 0 ? Math.round((fallback / total) * 1000) / 10 : 0,
  }
}

/**
 * Get the current post_method setting from DB.
 * Returns 'direct', 'api', or 'auto' (default).
 */
async function getPostMethodSetting(): Promise<string> {
  const setting = await db.setting.findUnique({ where: { key: 'post_method' } })
  const value = setting?.value
  if (value === 'direct' || value === 'api' || value === 'auto') return value
  return 'auto'
}
