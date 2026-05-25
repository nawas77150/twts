import { clearAllCaches } from '@/lib/twitter-post-cookie'
import { invalidateFilterSettingsCache } from '@/lib/filter-settings'
import { withAdmin } from '@/lib/admin-auth'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/admin/clear-cache — Clear all caches (in-memory + DB)
// (placeholder, queryId, transaction ID config, HTML cache, filter settings).
// Deleting DB rows forces a fresh GitHub fetch on next post.
// Useful when X updates their frontend and cached data becomes stale.
export const POST = withAdmin(async (req: NextRequest) => {
  await clearAllCaches()
  invalidateFilterSettingsCache()

  return NextResponse.json({
    success: true,
    message: 'All caches cleared (placeholder, queryId, transaction ID, HTML, filter settings)',
  })
})
