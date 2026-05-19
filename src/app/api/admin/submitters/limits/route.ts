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

    // Compute the customLimits value to store
    let customLimitsData: typeof Prisma.DbNull | Prisma.InputJsonObject

    if (customLimits === null) {
      // Clear all custom limits
      customLimitsData = Prisma.DbNull
    } else {
      if (typeof customLimits !== 'object' || Array.isArray(customLimits)) {
        return NextResponse.json(
          { error: 'customLimits harus berupa object atau null' },
          { status: 400 }
        )
      }

      // Map (not Record) avoids "Generic Object Injection Sink" SAST warnings:
      // plain objects have a prototype chain that SAST flags on dynamic-key access.
      // Map.get() / Map.set() / Map.delete() have no prototype chain.
      const existing = (submitter.customLimits && typeof submitter.customLimits === 'object' && !Array.isArray(submitter.customLimits))
        ? new Map(Object.entries(submitter.customLimits as Record<string, unknown>))
        : new Map<string, unknown>()

      const merged = new Map<string, number>()

      for (const [key, value] of Object.entries(customLimits as Record<string, unknown>)) {
        if (!(PER_USER_LIMIT_KEYS as readonly string[]).includes(key)) {
          return NextResponse.json(
            { error: `Key tidak valid: ${key}. Key yang valid: ${PER_USER_LIMIT_KEYS.join(', ')}` },
            { status: 400 }
          )
        }

        if (value === null) {
          // Remove this override key
          existing.delete(key)
        } else if (typeof value === 'number' && value >= 0) {
          existing.set(key, value)
        } else {
          return NextResponse.json(
            { error: `Value untuk ${key} harus berupa angka tidak negatif atau null` },
            { status: 400 }
          )
        }
      }

      // Build final map with only valid per-user keys that have number values
      for (const key of PER_USER_LIMIT_KEYS) {
        const val = existing.get(key)
        if (val !== undefined && typeof val === 'number') {
          merged.set(key, val)
        }
      }

      // Store null if no overrides remain (not empty object)
      const finalCustomLimits = merged.size > 0 ? Object.fromEntries(merged) : null
      customLimitsData = finalCustomLimits ? (finalCustomLimits as Prisma.InputJsonObject) : Prisma.DbNull
    }

    // Single update + response — eliminates duplicated update/return block
    const updated = await db.submitter.update({
      where: { id: submitter.id },
      data: { customLimits: customLimitsData },
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
