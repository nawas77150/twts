import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/admin/stats - Get dashboard stats
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'

  if (authHeader !== `Bearer ${adminPassword}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [pending, approved, rejected, posted, total, submitters] = await Promise.all([
    db.submission.count({ where: { status: 'pending' } }),
    db.submission.count({ where: { status: 'approved' } }),
    db.submission.count({ where: { status: 'rejected' } }),
    db.submission.count({ where: { status: 'posted' } }),
    db.submission.count(),
    db.submitter.count(),
  ])

  return NextResponse.json({
    pending,
    approved,
    rejected,
    posted,
    total,
    submitters,
  })
}
