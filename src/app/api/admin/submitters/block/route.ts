import { db } from '@/lib/db'
import { verifyAdmin } from '@/lib/admin-auth'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/admin/submitters/block — Block a user from submitting
// Uses atomic PostgreSQL jsonb append to prevent race conditions
// when two admin block requests run concurrently.
export async function POST(req: NextRequest) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

  try {
    const { username } = await req.json()
    if (!username || typeof username !== 'string' || !username.trim()) {
      return NextResponse.json({ error: 'Username wajib diisi' }, { status: 400 })
    }

    const normalizedUsername = username.toLowerCase().trim()

    // Atomic append to blocked_usernames JSON array using PostgreSQL jsonb.
    // This prevents the read-modify-write race condition where concurrent
    // requests could overwrite each other's changes.
    // If the key doesn't exist yet, creates it with [username].
    // If the username is already in the array, leaves it unchanged (no duplicates).
    await db.$executeRaw`
      INSERT INTO "Setting" (id, key, value, "updatedAt")
      VALUES (
        ${'blocked_usernames'},
        ${'blocked_usernames'},
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

    // Also remove from whitelist if present (blocked takes priority)
    // Atomic jsonb removal — no race condition
    // COALESCE ensures empty array becomes '[]' instead of NULL
    // (jsonb_agg returns NULL when no rows remain after filtering)
    await db.$executeRaw`
      UPDATE "Setting"
      SET "value" = COALESCE(
        (SELECT jsonb_agg(elem) FROM jsonb_array_elements_text("Setting"."value"::jsonb) AS elem WHERE elem != ${normalizedUsername}),
        '[]'::jsonb
      )::text,
      "updatedAt" = NOW()
      WHERE "key" = 'whitelist_usernames'
      AND "Setting"."value"::jsonb @> ${JSON.stringify([normalizedUsername])}::jsonb
    `

    return NextResponse.json({ success: true, blocked: normalizedUsername })
  } catch (error) {
    console.error('Block user error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
