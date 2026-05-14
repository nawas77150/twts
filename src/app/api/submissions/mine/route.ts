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

    // Stats for this user
    const totalCount = submissions.length
    const pendingCount = submissions.filter(s => s.status === 'pending').length
    const postedCount = submissions.filter(s => s.status === 'posted').length
    const rejectedCount = submissions.filter(s => s.status === 'rejected').length

    return NextResponse.json({
      submissions,
      stats: {
        total: totalCount,
        pending: pendingCount,
        posted: postedCount,
        rejected: rejectedCount,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
