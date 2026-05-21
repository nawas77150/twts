import { db } from '@/lib/db'
import { withAdmin } from '@/lib/admin-auth'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/admin/submitters — List all submitters with their submission counts (cursor-based pagination)
export const GET = withAdmin(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url)
    const cursor = searchParams.get('cursor') || undefined
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || '50'), 1), 200)

  // Single GROUP BY query instead of 4 COUNT × N submitters (N+1 problem)
  const statusCounts = await db.$queryRaw<
    { submitterId: string; status: string; count: bigint }[]
  >`
    SELECT "submitterId", status, COUNT(*) as count
    FROM "Submission"
    GROUP BY "submitterId", status
  `

  // Build a lookup map: submitterId → { posted, pending, rejected, post_failed }
  const countMap = new Map<string, Record<string, number>>()
  for (const row of statusCounts) {
    const existing = countMap.get(row.submitterId) || {}
    existing[row.status] = Number(row.count)
    countMap.set(row.submitterId, existing)
  }

  const submitters = await db.submitter.findMany({
    select: {
      id: true,
      username: true,
      displayName: true,
      profileImage: true,
      twitterId: true,
      customLimits: true,
      createdAt: true,
      _count: {
        select: {
          submissions: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
  })

  const hasMore = submitters.length > limit
  const slicedSubmitters = hasMore ? submitters.slice(0, limit) : submitters
  const nextCursor = hasMore ? slicedSubmitters[slicedSubmitters.length - 1].id : null

  const submittersWithStats = slicedSubmitters.map((s) => {
    const counts = countMap.get(s.id) || {}
    return {
      id: s.id,
      username: s.username,
      displayName: s.displayName,
      profileImage: s.profileImage,
      customLimits: s.customLimits as Record<string, number> | null,
      twitterId: s.twitterId,
      createdAt: s.createdAt,
      totalSubmissions: s._count.submissions,
      posted: counts['posted'] || 0,
      pending: counts['pending'] || 0,
      censored: counts['censored'] || 0,
      posting: counts['posting'] || 0,
      rejected: counts['rejected'] || 0,
      postFailed: counts['post_failed'] || 0,
    }
  })

  return NextResponse.json({ submitters: submittersWithStats, nextCursor, hasMore })
  } catch (error) {
    console.error('Submitters GET error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
})
