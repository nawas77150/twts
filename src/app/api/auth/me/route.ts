import { NextRequest, NextResponse } from 'next/server'
import { getSubmitterFromNextRequest } from '@/lib/twitter-auth'
import { getFilterSettings } from '@/lib/filter-settings'
import { debugError } from '@/lib/debug'
import { safeGet } from '@/lib/utils'

// GET /api/auth/me - Check if user is logged in via Twitter OAuth
export async function GET(req: NextRequest) {
  try {
    const submitter = await getSubmitterFromNextRequest(req)

    if (!submitter) {
      return NextResponse.json({ authenticated: false })
    }

    // Check if user is blocked — use canonical getFilterSettings() which
    // handles decryption and normalization, instead of raw JSON.parse
    let blocked = false
    let blockReason: string | undefined
    if (submitter.username) {
      try {
        const settings = await getFilterSettings()
        blocked = settings.blockedUsernames.includes(submitter.username.toLowerCase())
        if (blocked) {
          blockReason = safeGet(settings.blockedReasons, submitter.username.toLowerCase())
        }
      } catch {
        // If settings can't be loaded, treat as not blocked
      }
    }

    return NextResponse.json({
      authenticated: true,
      submitter,
      blocked,
      blockReason,
    })
  } catch (error) {
    debugError('auth/me', 'Error:', error)
    return NextResponse.json({ authenticated: false, error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
