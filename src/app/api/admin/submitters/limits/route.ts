import { NextRequest, NextResponse } from 'next/server'
import { verifyAdmin, getAdminTokenFromRequest } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { PER_USER_LIMIT_KEYS } from '@/types'
import { Prisma } from '@prisma/client'

// PATCH /api/admin/submitters/limits — Set/clear custom limits for a submitter
// Only accepts `username` as identifier (matches existing admin patterns).
// customLimits values: number = set override, null = remove that key.
// customLimits: null = clear ALL overrides.
export async function PATCH(req: NextRequest) {
  const auth = verifyAdmin(getAdminTokenFromRequest(req))
  if (!auth.authorized) return auth.response

  try {
    const body = await req.json()
    const { username, customLimits } = body

    // Require username
    if (!username || typeof username !== 'string' || !username.trim()) {
      return NextResponse.json(
        { error: 'Username wajib diisi' },
        { status: 400 }
      )
    }

    const normalizedUsername = username.toLowerCase().trim()

    // Find or create submitter by username
    // A user can be whitelisted before they ever log in, so they may not
    // have a Submitter record yet. We create a placeholder if needed.
    // Both DB and input are lowercase — exact match is sufficient.
    let submitter = await db.submitter.findFirst({
      where: { username: normalizedUsername },
      select: { id: true, username: true, customLimits: true },
    })

    if (!submitter) {
      // No existing record — create a placeholder for this username
      submitter = await db.submitter.create({
        data: {
          username: normalizedUsername,
          twitterId: `pending:${normalizedUsername}`,
          displayName: normalizedUsername,
        },
        select: { id: true, username: true, customLimits: true },
      })
    }

    // Handle customLimits
    if (customLimits === null) {
      // Clear all custom limits
      const updated = await db.submitter.update({
        where: { id: submitter.id },
        data: { customLimits: Prisma.DbNull },
        select: { id: true, username: true, customLimits: true },
      })
      return NextResponse.json({
        success: true,
        submitter: updated,
        previousCustomLimits: submitter.customLimits,
      })
    }

    if (typeof customLimits !== 'object' || customLimits === null || Array.isArray(customLimits)) {
      return NextResponse.json(
        { error: 'customLimits harus berupa object atau null' },
        { status: 400 }
      )
    }

    // Merge with existing customLimits
    const existing = (submitter.customLimits && typeof submitter.customLimits === 'object' && !Array.isArray(submitter.customLimits))
      ? { ...(submitter.customLimits as Record<string, unknown>) }
      : {}

    const merged: Record<string, number> = {}

    for (const [key, value] of Object.entries(customLimits as Record<string, unknown>)) {
      if (!(PER_USER_LIMIT_KEYS as readonly string[]).includes(key)) {
        return NextResponse.json(
          { error: `Key tidak valid: ${key}. Key yang valid: ${PER_USER_LIMIT_KEYS.join(', ')}` },
          { status: 400 }
        )
      }

      if (value === null) {
        // Remove this override key
        delete existing[key]
      } else if (typeof value === 'number' && value >= 0) {
        existing[key] = value
      } else {
        return NextResponse.json(
          { error: `Value untuk ${key} harus berupa angka tidak negatif atau null` },
          { status: 400 }
        )
      }
    }

    // Build final object with only valid per-user keys that have number values
    for (const key of PER_USER_LIMIT_KEYS) {
      if (key in existing && typeof existing[key] === 'number') {
        merged[key] = existing[key] as number
      }
    }

    // Store null if no overrides remain (not empty object)
    const finalCustomLimits = Object.keys(merged).length > 0 ? merged : null

    const updated = await db.submitter.update({
      where: { id: submitter.id },
      data: { customLimits: finalCustomLimits ? (finalCustomLimits as Prisma.InputJsonObject) : Prisma.DbNull },
      select: { id: true, username: true, customLimits: true },
    })

    return NextResponse.json({
      success: true,
      submitter: updated,
      previousCustomLimits: submitter.customLimits,
    })
  } catch (error) {
    console.error('Submitters limits PATCH error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
