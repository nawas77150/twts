import { db } from '@/lib/db'
import { getSubmitterFromNextRequest } from '@/lib/twitter-auth'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/submissions/mine - Get current user's submissions
export async function GET(req: NextRequest) {
  try {
    const submitter = await getSubmitterFromNextRequest(req)

    if (!submitter) {
      return NextResponse.json({ error: 'Silakan login dengan akun X terlebih dahulu' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)

    const submissions = await db.submission.findMany({
      where: { submitterId: submitter.id },
      select: {
        id: true,
        message: true,
        status: true,
        tweetId: true,
        category: true,
        filterReasons: true,
        postError: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    // Accurate stats from separate GROUP BY (not from the limited submissions array)
    const statusCounts = await db.submission.groupBy({
      by: ['status'],
      where: { submitterId: submitter.id },
      _count: { status: true },
    })
    const stats: Record<string, number> = { total: 0, pending: 0, posted: 0, rejected: 0 }
    for (const row of statusCounts) {
      stats.total += row._count.status
      if (row.status === 'pending') stats.pending = row._count.status
      else if (row.status === 'posted') stats.posted = row._count.status
      else if (row.status === 'rejected') stats.rejected = row._count.status
    }

    return NextResponse.json({
      submissions,
      stats,
    })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
