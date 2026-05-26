import { withAdmin } from '@/lib/admin-auth'
import { type NextRequest, NextResponse } from 'next/server'

// POST /api/admin/logout — Clear the HttpOnly admin cookie
export const POST = withAdmin(async (_req: NextRequest) => {
  const response = NextResponse.json({ success: true })
  response.cookies.set('admin_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  })
  return response
})
