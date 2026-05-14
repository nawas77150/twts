import { db } from '@/lib/db'
import { verifyAdmin } from '@/lib/admin-auth'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/admin/submitters/block — Block a user from submitting
//
// Bug #10 fix: Uses atomic PostgreSQL jsonb array append instead of
// read-modify-write, preventing race conditions when two admins block
// different users at the same time.
export async function POST(req: NextRequest) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

  try {
    const { username } = await req.json()
    if (!username || typeof username !== 'string' || !username.trim()) {
      return NextResponse.json({ error: 'Username wajib diisi' }, { status: 400 })
    }

    const normalizedUsername = username.toLowerCase().trim()

    // Atomically append to the blocked_usernames JSON array.
    // Uses PostgreSQL's jsonb || operator for array concatenation.
    // The CASE expression checks if the user is already blocked to
    // avoid duplicates (idempotent).
    //
    // This is a single SQL statement — no read-modify-write race.
    await db.$executeRaw`
      INSERT INTO "Setting" (id, key, value, "updatedAt")
      VALUES ('blocked_usernames', 'blocked_usernames', ${JSON.stringify([normalizedUsername])}, NOW())
      ON CONFLICT (key) DO UPDATE
      SET value = (
        CASE
          WHEN "Setting".value::jsonb ? ${normalizedUsername}
          THEN "Setting".value
          ELSE ("Setting".value::jsonb || jsonb_build_array(${normalizedUsername}))::text
        END
      ),
      "updatedAt" = NOW()
    `

    // Also atomically remove from whitelist if present (blocked takes priority)
    try {
      await db.$executeRaw`
        UPDATE "Setting"
        SET value = (
          COALESCE(
            (SELECT jsonb_agg(elem)::text
             FROM jsonb_array_elements(value::jsonb) AS elem
             WHERE elem::text != ${JSON.stringify(normalizedUsername)}),
            '[]'
          )
        ),
        "updatedAt" = NOW()
        WHERE key = 'whitelist_usernames'
          AND value::jsonb ? ${normalizedUsername}
      `
    } catch { /* ignore if whitelist doesn't exist */ }

    return NextResponse.json({ success: true, blocked: normalizedUsername })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
