import { db } from '@/lib/db'
import { verifyAdmin } from '@/lib/admin-auth'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/admin/submitters/whitelist — Add a user to the whitelist
// Uses atomic PostgreSQL jsonb append to prevent race conditions.
export async function POST(req: NextRequest) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

  try {
    const { username } = await req.json()
    if (!username || typeof username !== 'string' || !username.trim()) {
      return NextResponse.json({ error: 'Username wajib diisi' }, { status: 400 })
    }

    const normalizedUsername = username.toLowerCase().trim()

    // Atomic append to whitelist_usernames JSON array using PostgreSQL jsonb.
    // Prevents read-modify-write race condition.
    // If the key doesn't exist yet, creates it with [username].
    // If the username is already in the array, leaves it unchanged (no duplicates).
    await db.$executeRaw`
      INSERT INTO "Setting" (id, key, value, "updatedAt")
      VALUES (
        ${'whitelist_usernames'},
        ${'whitelist_usernames'},
        ${JSON.stringify([normalizedUsername])},
        NOW()
      )
      ON CONFLICT (key) DO UPDATE
      SET "value" = (
        CASE WHEN "Setting"."value"::jsonb @> ${JSON.stringify([normalizedUsername])}::jsonb
        THEN "Setting"."value"
        ELSE ("Setting"."value"::jsonb || ${JSON.stringify(normalizedUsername)}::jsonb)::text
        END
      ),
      "updatedAt" = NOW()
    `

    // Also remove from blocked list if present (whitelist takes priority)
    await db.$executeRaw`
      UPDATE "Setting"
      SET "value" = COALESCE(
        (SELECT jsonb_agg(elem) FROM jsonb_array_elements_text("Setting"."value"::jsonb) AS elem WHERE elem != ${normalizedUsername}),
        '[]'::jsonb
      )::text,
      "updatedAt" = NOW()
      WHERE "key" = 'blocked_usernames'
      AND "Setting"."value"::jsonb @> ${JSON.stringify([normalizedUsername])}::jsonb
    `

    return NextResponse.json({ success: true, whitelisted: normalizedUsername })
  } catch (error) {
    console.error('Whitelist POST error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}

// DELETE /api/admin/submitters/whitelist — Remove a user from the whitelist
// Uses atomic PostgreSQL jsonb removal to prevent race conditions.
export async function DELETE(req: NextRequest) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

  try {
    const { username } = await req.json()
    if (!username || typeof username !== 'string' || !username.trim()) {
      return NextResponse.json({ error: 'Username wajib diisi' }, { status: 400 })
    }

    const normalizedUsername = username.toLowerCase().trim()

    // Check if the username exists in the whitelist first
    const existing = await db.setting.findUnique({ where: { key: 'whitelist_usernames' } })
    if (!existing?.value) {
      return NextResponse.json({ error: 'User tidak ditemukan di whitelist' }, { status: 400 })
    }

    let whitelisted: string[] = []
    try {
      whitelisted = JSON.parse(existing.value)
    } catch { /* empty */ }

    if (!whitelisted.includes(normalizedUsername)) {
      return NextResponse.json({ error: 'User tidak ditemukan di whitelist' }, { status: 400 })
    }

    // Atomic removal from whitelist_usernames JSON array using PostgreSQL jsonb.
    await db.$executeRaw`
      UPDATE "Setting"
      SET "value" = COALESCE(
        (SELECT jsonb_agg(elem) FROM jsonb_array_elements_text("Setting"."value"::jsonb) AS elem WHERE elem != ${normalizedUsername}),
        '[]'::jsonb
      )::text,
      "updatedAt" = NOW()
      WHERE "key" = 'whitelist_usernames'
    `

    return NextResponse.json({ success: true, removed: normalizedUsername })
  } catch (error) {
    console.error('Whitelist DELETE error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
