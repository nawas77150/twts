import { clearAllCaches } from '@/lib/twitter-post-cookie'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/admin/clear-cache — Clear all in-memory caches
// (queryId, transaction ID config, HTML cache).
// Useful when X updates their frontend and cached data becomes stale.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'
  if (authHeader !== `Bearer ${adminPassword}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  clearAllCaches()

  return NextResponse.json({
    success: true,
    message: 'All caches cleared (queryId, transaction ID, HTML)',
  })
}
