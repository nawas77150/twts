import { NextResponse } from 'next/server'

// POST /api/auth/logout - Clear session cookie
export async function POST() {
  const response = NextResponse.json({ success: true })

  response.cookies.set('menfess_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })

  return response
}
