import { withAdmin } from '@/lib/admin-auth'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/admin/session — Lightweight session check (no DB queries)
// Returns 200 if the HttpOnly admin cookie is valid, 401 otherwise.
// Use this instead of /api/admin/stats for session validation.
export const GET = withAdmin(async (req: NextRequest) => {
  return NextResponse.json({ authenticated: true })
})
