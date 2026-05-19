// NOTE: blocked_usernames / whitelist_usernames are intentionally stored as plaintext JSON.
// These are public X handles with no security sensitivity — encrypting them would provide
// no practical benefit. The PostgreSQL ::jsonb cast used for atomic add/remove operations
// requires plaintext values. Do NOT apply encrypt() to these settings.

import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { parseUsernameRequest, atomicJsonbAppend, atomicJsonbRemove } from '../_lib'

// POST /api/admin/submitters/block — Block a user from submitting
// Uses atomic PostgreSQL jsonb append to prevent race conditions
// when two admin block requests run concurrently.
export async function POST(req: NextRequest) {
  try {
    const parsed = await parseUsernameRequest(req)
    if (parsed instanceof NextResponse) return parsed
    const { normalizedUsername } = parsed

    // Atomic append to blocked_usernames JSON array using PostgreSQL jsonb.
    // This prevents the read-modify-write race condition where concurrent
    // requests could overwrite each other's changes.
    // If the key doesn't exist yet, creates it with [username].
    // If the username is already in the array, leaves it unchanged (no duplicates).
    await atomicJsonbAppend('blocked_usernames', normalizedUsername)

    // Also remove from whitelist if present (blocked takes priority)
    // Atomic jsonb removal — no race condition
    // COALESCE ensures empty array becomes '[]' instead of NULL
    // (jsonb_agg returns NULL when no rows remain after filtering)
    await atomicJsonbRemove('whitelist_usernames', normalizedUsername)

    // Auto-reject all queued submissions from this blocked user.
    // Keeps the queue clean so the cron autopost never encounters
    // a blocked user's submissions in pending/post_failed status.
    // Note: rejected submissions are NOT restored on unblock.
    // Admin must manually re-approve any submissions they want to reinstate.
    const blockedSubmitter = await db.submitter.findUnique({
      where: { username: normalizedUsername },
      select: { id: true },
    })
    if (blockedSubmitter) {
      await db.submission.updateMany({
        where: {
          submitterId: blockedSubmitter.id,
          status: { in: ['pending', 'post_failed'] },
        },
        data: {
          status: 'rejected',
          postError: '[Auto] Submitter blocked',
        },
      })
    }

    return NextResponse.json({ success: true, blocked: normalizedUsername })
  } catch (error) {
    console.error('Block user error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
