import { verifyAdmin, getAdminTokenFromRequest } from '@/lib/admin-auth'
import { resetCircuitBreaker } from '@/lib/circuit-breaker'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/admin/circuit-breaker/reset — Manually reset the circuit breaker
export async function POST(req: NextRequest) {
  const auth = verifyAdmin(getAdminTokenFromRequest(req))
  if (!auth.authorized) return auth.response

  try {
    await resetCircuitBreaker()
    return NextResponse.json({ success: true, message: 'Circuit breaker reset' })
  } catch (error) {
    console.error('[circuit-breaker/reset] Error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
