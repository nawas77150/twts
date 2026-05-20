import { clearAllCaches } from '@/lib/twitter-post-cookie'
import { invalidateFilterSettingsCache } from '@/lib/filter-settings'
import { verifyAdmin, getAdminTokenFromRequest } from '@/lib/admin-auth'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/admin/clear-cache — Clear all in-memory caches
// (queryId, transaction ID config, HTML cache).
// Useful when X updates their frontend and cached data becomes stale.
export async function POST(req: NextRequest) {
  const auth = verifyAdmin(getAdminTokenFromRequest(req))
  if (!auth.authorized) return auth.response

  clearAllCaches()
  invalidateFilterSettingsCache()

  return NextResponse.json({
    success: true,
    message: 'All caches cleared (queryId, transaction ID, HTML, filter settings)',
  })
}
