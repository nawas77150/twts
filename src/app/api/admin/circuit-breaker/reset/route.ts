import { withAdmin } from '@/lib/admin-auth'
import { resetCircuitBreaker } from '@/lib/circuit-breaker'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/admin/circuit-breaker/reset — Manually reset the circuit breaker
export const POST = withAdmin(async (req: NextRequest) => {
  try {
    await resetCircuitBreaker()
    return NextResponse.json({ success: true, message: 'Circuit breaker reset' })
  } catch (error) {
    console.error('[circuit-breaker/reset] Error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
})
