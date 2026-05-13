import { db } from '@/lib/db'
import { getCookieAuthStatus } from '@/lib/twitter-post-cookie'
import { getAllKeyCredits, getApiLoginStatus } from '@/lib/twitter-api-fallback'
import { verifyAdmin } from '@/lib/admin-auth'
import { getFilterSettings } from '@/app/api/admin/filter-settings/route'
import { NextRequest, NextResponse } from 'next/server'

// Vercel serverless function timeout — multiple DB queries + external API calls
export const maxDuration = 30

// GET /api/admin/stats - Get dashboard stats + post method ratio + API credits + login status
export async function GET(req: NextRequest) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

  const [pending, approved, rejected, posted, total, submitters, cookieAuthStatus, postMethodStats, apiCredits, apiLoginStatus, postMethodSetting, filterSettingsData] =
    await Promise.all([
      db.submission.count({ where: { status: 'pending' } }),
      db.submission.count({ where: { status: 'approved' } }),
      db.submission.count({ where: { status: 'rejected' } }),
      db.submission.count({ where: { status: 'posted' } }),
      db.submission.count(),
      db.submitter.count(),
      getCookieAuthStatus(),
      getPostMethodStats(),
      getAllKeyCredits(),
      getApiLoginStatus(),
      getPostMethodSetting(),
      getFilterSettings(),
    ])

  return NextResponse.json({
    pending,
    approved,
    rejected,
    posted,
    total,
    submitters,
    cookieAuthStatus,
    postMethodStats,
    apiCredits,
    apiLoginStatus,
    postMethodSetting,
    filterSettings: filterSettingsData,
  })
}

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
  // Get all posted submissions with their postMethod
  const postedSubmissions = await db.submission.findMany({
    where: { status: 'posted' },
    select: { postMethod: true },
  })

  const total = postedSubmissions.length
  const direct = postedSubmissions.filter((s) => s.postMethod === 'direct').length
  const retry = postedSubmissions.filter((s) => s.postMethod === 'retry').length
  const fallback = postedSubmissions.filter((s) => s.postMethod === 'fallback').length
  const unknown = total - direct - retry - fallback // Posts before postMethod was added

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
