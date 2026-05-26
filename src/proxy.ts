import { type NextRequest, NextResponse } from 'next/server'
import { getAdminTokenFromRequest, verifyAdmin } from '@/lib/admin-auth'

/**
 * Next.js 16 Proxy — runs on Node.js runtime (not Edge).
 * Full HMAC verification of admin_token cookie via verifyAdmin().
 *
 * Protects two route groups:
 *   1. /admin/:path* — frontend pages (redirect to /admin on failure)
 *   2. /api/admin/:path* — API routes (return JSON 401 on failure)
 *
 * Loop prevention:
 *   - /admin root → always NextResponse.next() (login card handles !isAdmin)
 *   - /api/admin/login → always NextResponse.next() (login endpoint itself)
 *   - /admin/* sub-paths with invalid/expired/missing token → redirect + clear cookie
 *   - /api/admin/* with invalid/expired/missing token → JSON 401 + clear cookie
 *
 * Without the /api/admin/:path* matcher, bots hitting admin API routes
 * spin up serverless functions + Prisma connections just to get rejected
 * by per-route verifyAdmin() calls. The proxy rejects them at the edge
 * before the function body executes.
 */

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // /admin root always passes through — login card renders when !isAdmin
  if (pathname === '/admin') return NextResponse.next()

  // /api/admin/login always passes through — it's the login endpoint itself
  if (pathname === '/api/admin/login') return NextResponse.next()

  // Full HMAC verify for all other matched paths
  const token = getAdminTokenFromRequest(request)
  const result = verifyAdmin(token)

  if (!result.authorized) {
    // API routes: return JSON 401 + clear cookie
    if (pathname.startsWith('/api/admin')) {
      const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      response.cookies.set('admin_token', '', { maxAge: 0, path: '/' })
      return response
    }

    // Frontend routes: redirect to /admin + clear expired cookie
    const redirect = NextResponse.redirect(new URL('/admin', request.url))
    redirect.cookies.set('admin_token', '', { maxAge: 0, path: '/' })
    return redirect
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
}
