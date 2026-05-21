import { NextRequest, NextResponse } from 'next/server'
import { getAdminTokenFromRequest, verifyAdmin } from '@/lib/admin-auth'

/**
 * Next.js 16 Proxy — runs on Node.js runtime (not Edge).
 * Full HMAC verification of admin_token cookie via verifyAdmin().
 *
 * Loop prevention:
 *   1. /admin root → always NextResponse.next() (login card handles !isAdmin)
 *   2. /admin/* sub-paths with valid token → NextResponse.next()
 *   3. /admin/* sub-paths with invalid/expired/missing token →
 *      redirect to /admin + clear expired cookie (maxAge=0)
 */

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // /admin root always passes through — login card renders when !isAdmin
  if (pathname === '/admin') return NextResponse.next()

  // Sub-paths: full HMAC verify
  const token = getAdminTokenFromRequest(request)
  const result = verifyAdmin(token)

  if (!result.authorized) {
    // Create our own redirect — do NOT return result.response
    // (verifyAdmin returns JSON 401s, not redirects)
    const redirect = NextResponse.redirect(new URL('/admin', request.url))
    redirect.cookies.set('admin_token', '', { maxAge: 0, path: '/' })
    return redirect
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*'],
}
