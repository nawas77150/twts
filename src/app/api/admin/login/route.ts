import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { generateAdminToken, ADMIN_TOKEN_TTL } from '@/lib/admin-auth'
import { getClientIp, checkLoginRateLimit, recordFailedAttempt, clearFailedAttempts } from '@/lib/login-rate-limit'

// POST /api/admin/login - Verify admin password
// Uses crypto.timingSafeEqual to prevent timing side-channel attacks.
// Returns an HMAC-derived token instead of the raw password —
// the raw password never leaves the server.
// Rate-limited: 5 failed attempts per IP per 15 minutes.
// Sets an HttpOnly cookie for browser-based admin sessions.
export async function POST(req: NextRequest) {
  try {
    // --- Rate limit check (BEFORE password check) ---
    const ip = getClientIp(req)
    const rateCheck = checkLoginRateLimit(ip)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Terlalu banyak percobaan login. Coba lagi nanti.', retryAfterSec: rateCheck.retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfterSec) } },
      )
    }

    const adminPassword = process.env.ADMIN_PASSWORD
    if (!adminPassword) {
      return NextResponse.json(
        { error: 'ADMIN_PASSWORD env var is not set. Configure it in Vercel → Settings → Environment Variables.' },
        { status: 500 }
      )
    }

    let body: { password?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Request body tidak valid' }, { status: 400 })
    }
    const { password } = body

    if (!password || typeof password !== 'string') {
      recordFailedAttempt(ip)
      return NextResponse.json({ error: 'Password salah' }, { status: 401 })
    }

    // Timing-safe comparison to prevent leaking password length via response time.
    // Both buffers are padded to equal length so timingSafeEqual always runs,
    // then we check length separately — the && short-circuit is safe because
    // by that point the time cost of the comparison is already spent.
    const passwordBuf = Buffer.from(String(password))
    const expectedBuf = Buffer.from(String(adminPassword))
    const maxLen = Math.max(passwordBuf.length, expectedBuf.length)
    const paddedPassword = Buffer.concat([passwordBuf, Buffer.alloc(maxLen - passwordBuf.length)])
    const paddedExpected = Buffer.concat([expectedBuf, Buffer.alloc(maxLen - expectedBuf.length)])
    const isMatch = crypto.timingSafeEqual(paddedPassword, paddedExpected)
      && passwordBuf.length === expectedBuf.length

    if (isMatch) {
      // Clear rate limit on successful login
      clearFailedAttempts(ip)
      // Generate a token with embedded expiry — raw password is never exposed to the client
      const token = generateAdminToken(adminPassword)

      // Set HttpOnly cookie for browser-based sessions (sent automatically with requests)
      const response = NextResponse.json({ success: true, token })
      response.cookies.set('admin_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: ADMIN_TOKEN_TTL,
      })
      return response
    }

    // Record failed attempt
    recordFailedAttempt(ip)
    return NextResponse.json({ error: 'Password salah' }, { status: 401 })
  } catch (e) {
    console.error('[admin/login] Error:', e)
    return NextResponse.json({ error: 'Terjadi kesalahan' }, { status: 500 })
  }
}
