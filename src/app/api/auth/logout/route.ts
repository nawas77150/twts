import { NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME } from '@/lib/twitter-auth'

// POST /api/auth/logout - Clear session cookie and any stale OAuth cookies
export async function POST() {
  const response = NextResponse.json({ success: true })

  // Clear the main session cookie
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })

  // Also clear any stale OAuth cookies in case they're lingering
  response.cookies.set('twitter_oauth_verifier', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })

  response.cookies.set('twitter_oauth_state', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })

  return response
}
