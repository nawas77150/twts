import { NextRequest, NextResponse } from 'next/server'
import { getSubmitterFromRequest } from '@/lib/twitter-auth'

// GET /api/auth/me - Check if user is logged in via Twitter OAuth
export async function GET(req: NextRequest) {
  try {
    const submitter = await getSubmitterFromRequest(req)

    if (!submitter) {
      return NextResponse.json({ authenticated: false })
    }

    return NextResponse.json({
      authenticated: true,
      submitter,
    })
  } catch {
    return NextResponse.json({ authenticated: false })
  }
}
