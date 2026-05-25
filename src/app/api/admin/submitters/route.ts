import { db } from '@/lib/db'
import { withAdmin } from '@/lib/admin-auth'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'

// GET /api/admin/submitters — List all submitters with their submission counts (page-based pagination + server-side search)
export const GET = withAdmin(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url)
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10) || 1, 1)
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200)
    const search = searchParams.get('search')?.trim() || undefined

  const where: Prisma.SubmitterWhereInput | undefined = search
    ? {
        OR: [
          { username: { contains: search, mode: 'insensitive' } },
          { displayName: { contains: search, mode: 'insensitive' } },
        ],
      }
    : undefined

  // Run count + data queries in parallel
  const [totalCount, statusCounts, submitters] = await Promise.all([
    db.submitter.count({ where }),
    db.$queryRaw<
      { submitterId: string; status: string; count: bigint }[]
    >`
      SELECT "submitterId", status, COUNT(*) as count
      FROM "Submission"
      GROUP BY "submitterId", status
    `,
    db.submitter.findMany({
      where,
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
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  // Build a lookup map: submitterId → { posted, pending, rejected, post_failed }
  const countMap = new Map<string, Record<string, number>>()
  for (const row of statusCounts) {
    const existing = countMap.get(row.submitterId) || {}
    existing[row.status] = Number(row.count)
    countMap.set(row.submitterId, existing)
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / limit))

  const submittersWithStats = submitters.map((s) => {
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

  return NextResponse.json({
    submitters: submittersWithStats,
    totalCount,
    totalPages,
    page,
    limit,
    hasMore: page < totalPages,
  })
  } catch (error) {
    console.error('Submitters GET error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
})
