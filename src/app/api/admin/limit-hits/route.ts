import { db } from '@/lib/db'
import { withAdmin } from '@/lib/admin-auth'
import { getStartOfTodayWIB } from '@/lib/constants'
import { safeAccess } from '@/lib/utils'
import { debugError } from '@/lib/debug'
import { NextRequest, NextResponse } from 'next/server'

const LIMIT_TYPE_LABELS: Record<string, string> = {
  cooldown: 'Cooldown',
  daily_cap: 'Batas harian',
  pending_cap: 'Batas antrean',
  global_cap: 'Batas global',
  post_cap: 'Batas post',
}

// GET /api/admin/limit-hits — Limit health stats for today (calendar day WIB)
export const GET = withAdmin(async (_req: NextRequest) => {
  try {
    const startOfToday = getStartOfTodayWIB()

    // Hits per limit type (total count)
    const hitsByType = await db.limitHit.groupBy({
      by: ['limitType'],
      where: { createdAt: { gte: startOfToday } },
      _count: { _all: true },
    })

    // Unique users per limit type (raw SQL for DISTINCT COUNT)
    const distinctByType = await db.$queryRaw<
      { limitType: string; uniqueUsers: bigint }[]
    >`
      SELECT "limitType", COUNT(DISTINCT username) as "uniqueUsers"
      FROM "LimitHit"
      WHERE "createdAt" >= ${startOfToday}
      GROUP BY "limitType"
    `

    // Top blocked users (today WIB) — raw SQL for ORDER BY COUNT DESC
    const topUsersRaw = await db.$queryRaw<
      { username: string; hits: bigint }[]
    >`
      SELECT username, COUNT(*) as hits
      FROM "LimitHit"
      WHERE "createdAt" >= ${startOfToday}
      GROUP BY username
      ORDER BY hits DESC
      LIMIT 10
    `

    // Build summary
    const summary = Object.keys(LIMIT_TYPE_LABELS).map((type) => {
      const hitRow = hitsByType.find((r) => r.limitType === type)
      const distinctRow = distinctByType.find((r) => r.limitType === type)
      return {
        limitType: type,
        label: safeAccess(LIMIT_TYPE_LABELS, type as keyof typeof LIMIT_TYPE_LABELS),
        totalHits: hitRow?._count._all ?? 0,
        uniqueUsers: Number(distinctRow?.uniqueUsers ?? 0),
      }
    })

    // Total hits for cleanup reference
    const totalHits = hitsByType.reduce((sum, r) => sum + r._count._all, 0)

    return NextResponse.json({
      summary,
      topUsers: topUsersRaw.map((u) => ({
        username: u.username,
        hits: Number(u.hits),
      })),
      totalHits,
      windowLabel: 'hari ini (WIB)',
    })
  } catch (error) {
    debugError('limit-hits', 'Error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
})
