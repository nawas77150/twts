import { db } from '@/lib/db'
import { verifyAdmin } from '@/lib/admin-auth'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/admin/submitters/unblock — Unblock a user
// Uses atomic PostgreSQL jsonb removal to prevent race conditions
// when concurrent block/unblock requests run at the same time.
export async function POST(req: NextRequest) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

  try {
    const { username } = await req.json()
    if (!username || typeof username !== 'string' || !username.trim()) {
      return NextResponse.json({ error: 'Username wajib diisi' }, { status: 400 })
    }

    const normalizedUsername = username.toLowerCase().trim()

    // Check if the username exists in the blocked list first (for error response)
    const existing = await db.setting.findUnique({ where: { key: 'blocked_usernames' } })
    if (!existing?.value) {
      return NextResponse.json({ error: 'User tidak ditemukan di blocklist' }, { status: 400 })
    }

    let blocked: string[] = []
    try {
      blocked = JSON.parse(existing.value)
    } catch { /* empty */ }

    if (!blocked.includes(normalizedUsername)) {
      return NextResponse.json({ error: 'User tidak ditemukan di blocklist' }, { status: 400 })
    }

    // Atomic removal from blocked_usernames JSON array using PostgreSQL jsonb.
    // This prevents the read-modify-write race condition where concurrent
    // requests could overwrite each other's changes.
    // jsonb_agg filters out the username, and returns NULL if the array
    // becomes empty (which we convert back to an empty array).
    await db.$executeRaw`
      UPDATE "Setting"
      SET "value" = COALESCE(
        (SELECT jsonb_agg(elem) FROM jsonb_array_elements_text("Setting"."value"::jsonb) AS elem WHERE elem != ${normalizedUsername}),
        '[]'::jsonb
      )::text,
      "updatedAt" = NOW()
      WHERE "key" = 'blocked_usernames'
    `

    return NextResponse.json({ success: true, unblocked: normalizedUsername })
  } catch (error) {
    console.error('Unblock user error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
