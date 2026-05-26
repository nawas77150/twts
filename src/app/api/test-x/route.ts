import { NextRequest, NextResponse } from 'next/server'
import { postingService } from '@/lib/posting-service'
import { verifyAdmin, getAdminTokenFromRequest } from '@/lib/admin-auth'
import { debug } from '@/lib/debug'
import { acquirePostingLock, releasePostingLock } from '@/lib/posting-lock'
import { recordPostSuccess, recordPostFailure } from '@/lib/circuit-breaker'
import { getFilterSettings } from '@/lib/filter-settings'

// Vercel serverless function timeout — test posting with retries can take time
export const maxDuration = 30

// GET /api/test-x - Check X auth configuration status
export async function GET(req: NextRequest) {
  const auth = verifyAdmin(getAdminTokenFromRequest(req))
  if (!auth.authorized) return auth.response

  // Check OAuth 2.0 (login) credentials — still needed for user authentication
  const oauth2ClientId = process.env.OAUTH2_CLIENT_ID || process.env.TWITTER_CLIENT_ID
  const oauth2ClientSecret = process.env.OAUTH2_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET

  const oauth2Status = {
    configured: !!(oauth2ClientId && oauth2ClientSecret),
    clientId: oauth2ClientId ? `${oauth2ClientId.substring(0, 8)}...` : 'MISSING',
    clientSecret: oauth2ClientSecret ? `${oauth2ClientSecret.substring(0, 4)}****` : 'MISSING',
    note: 'OAuth 2.0 is for user LOGIN only (free).',
  }

  // Check cookie auth (posting)
  const cookieAuthStatus = await postingService.getAuthStatus()

  return NextResponse.json({
    oauth2: oauth2Status,
    cookieAuth: cookieAuthStatus,
  })
}

// POST /api/test-x - Test posting a tweet via cookie auth
export async function POST(req: NextRequest) {
  const auth = verifyAdmin(getAdminTokenFromRequest(req))
  if (!auth.authorized) return auth.response

  // Get optional custom text from body
  let testText = 'Tweetfess test! 🚀'
  try {
    const body = await req.json()
    if (body.text) testText = body.text
  } catch {
    // use default text
  }

  const lockValue = await acquirePostingLock()
  if (!lockValue) {
    debug('test-x', 'Posting lock busy')
    return NextResponse.json(
      { success: false, error: 'Sedang ada posting lain yang berjalan. Coba lagi dalam beberapa detik.' },
      { status: 409 }
    )
  }

  try {
    const result = await postingService.post(testText)
    debug('test-x', 'Test post result:', { success: result.success, tweetId: result.tweetId, method: result.method, retriesUsed: result.retriesUsed, error: result.error?.slice(0, 100) })

    // Update circuit breaker state
    if (result.success) {
      await recordPostSuccess()
    } else {
      try {
        const settings = await getFilterSettings()
        await recordPostFailure(result.failureKind ?? 'transient', settings.rateLimits)
      } catch { /* best effort */ }
    }

    return NextResponse.json({
      success: result.success,
      tweetId: result.tweetId,
      text: testText,
      error: result.error,
      tweetUrl: result.tweetId ? `https://x.com/i/status/${result.tweetId}` : null,
    })
  } finally {
    await releasePostingLock(lockValue)
  }
}
