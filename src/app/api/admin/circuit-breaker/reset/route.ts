import { withAdmin } from '@/lib/admin-auth'
import { debugError } from '@/lib/debug'
import { resetCircuitBreaker } from '@/lib/circuit-breaker'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/admin/circuit-breaker/reset — Manually reset the circuit breaker
export const POST = withAdmin(async (_req: NextRequest) => {
  try {
    await resetCircuitBreaker()
    return NextResponse.json({ success: true, message: 'Circuit breaker reset' })
  } catch (error) {
    debugError('circuit-breaker/reset', 'Error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
})
