// NOTE: blocked_usernames / whitelist_usernames are intentionally stored as plaintext JSON.
// These are public X handles with no security sensitivity — encrypting them would provide
// no practical benefit. The PostgreSQL ::jsonb cast used for atomic add/remove operations
// requires plaintext values. Do NOT apply encrypt() to these settings.

import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin-auth'
import { parseUsernameRequest, atomicJsonbAppend, atomicJsonbRemove, atomicJsonbSetKey } from '../_lib'
import { debugError } from '@/lib/debug'
import { invalidateFilterSettingsCache } from '@/lib/filter-settings'

// POST /api/admin/submitters/block — Block a user from submitting
// Uses atomic PostgreSQL jsonb append to prevent race conditions
// when two admin block requests run concurrently.
export const POST = withAdmin(async (req: NextRequest) => {
  try {
    const parsed = await parseUsernameRequest(req)
    if (parsed instanceof NextResponse) return parsed
    const { normalizedUsername, reason } = parsed

    // Wrap all mutations in a transaction so that a DB connection drop mid-operation
    // cannot leave blocked_usernames updated but whitelist_usernames untouched (partial state).
    await db.$transaction(async (tx) => {
      // Atomic append to blocked_usernames JSON array using PostgreSQL jsonb.
      // This prevents the read-modify-write race condition where concurrent
      // requests could overwrite each other's changes.
      // If the key doesn't exist yet, creates it with [username].
      // If the username is already in the array, leaves it unchanged (no duplicates).
      await atomicJsonbAppend('blocked_usernames', normalizedUsername, tx)

      // Also remove from whitelist if present (blocked takes priority)
      // Atomic jsonb removal — no race condition
      // COALESCE ensures empty array becomes '[]' instead of NULL
      // (jsonb_agg returns NULL when no rows remain after filtering)
      await atomicJsonbRemove('whitelist_usernames', normalizedUsername, tx)

      // Store custom block reason (if provided)
      if (reason) {
        await atomicJsonbSetKey('blocked_reasons', normalizedUsername, reason, tx)
      }

      // Auto-reject all queued submissions from this blocked user.
      // Keeps the queue clean so the cron autopost never encounters
      // a blocked user's submissions in pending/post_failed status.
      // Note: rejected submissions are NOT restored on unblock.
      // Admin must manually re-approve any submissions they want to reinstate.
      const blockedSubmitter = await tx.submitter.findUnique({
        where: { username: normalizedUsername },
        select: { id: true },
      })
      if (blockedSubmitter) {
        await tx.submission.updateMany({
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
    })

    invalidateFilterSettingsCache()

    return NextResponse.json({ success: true, blocked: normalizedUsername })
  } catch (error) {
    debugError('submitters/block', 'Error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
})
