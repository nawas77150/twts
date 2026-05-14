import { db } from '@/lib/db'
import { verifyAdmin } from '@/lib/admin-auth'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/admin/submitters/unblock — Unblock a user
//
// Bug #10 fix: Uses atomic PostgreSQL jsonb array element removal
// instead of read-modify-write, preventing race conditions when two
// admins unblock different users at the same time.
export async function POST(req: NextRequest) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

  try {
    const { username } = await req.json()
    if (!username || typeof username !== 'string' || !username.trim()) {
      return NextResponse.json({ error: 'Username wajib diisi' }, { status: 400 })
    }

    const normalizedUsername = username.toLowerCase().trim()

    // Atomically remove the username from the blocked_usernames JSON array.
    // Uses jsonb_agg to rebuild the array without the target element.
    // The WHERE clause ensures we only update if the user is actually in the list.
    //
    // This is a single SQL statement — no read-modify-write race.
    const affected = await db.$executeRaw`
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
      WHERE key = 'blocked_usernames'
        AND value::jsonb ? ${normalizedUsername}
    `

    if (affected === 0) {
      return NextResponse.json({ error: 'User tidak ditemukan di blocklist' }, { status: 400 })
    }

    return NextResponse.json({ success: true, unblocked: normalizedUsername })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
