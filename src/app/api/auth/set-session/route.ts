import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/twitter-auth'
import { db } from '@/lib/db'
import { debugError } from '@/lib/debug'

// POST /api/auth/set-session - Set the httpOnly session cookie
// Called by the intermediate HTML page after OAuth callback
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { token } = body

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Token required' }, { status: 400 })
    }

    // Verify the session token
    const session = verifySessionToken(token)
    if (!session) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // Verify the submitter exists
    const submitter = await db.submitter.findUnique({
      where: { id: session.submitterId },
      select: { id: true, username: true, displayName: true, profileImage: true, twitterId: true },
    })

    if (!submitter) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Set the httpOnly session cookie in a regular JSON response (not a redirect!)
    // This is more reliable on Vercel than setting cookies in redirect responses
    const response = NextResponse.json({
      success: true,
      submitter,
    })

    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    })

    return response
  } catch (error) {
    debugError('auth/set-session', 'Error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
