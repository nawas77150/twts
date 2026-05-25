// NOTE: blocked_usernames / whitelist_usernames are intentionally stored as plaintext JSON.
// These are public X handles with no security sensitivity — encrypting them would provide
// no practical benefit. The PostgreSQL ::jsonb cast used for atomic add/remove operations
// requires plaintext values. Do NOT apply encrypt() to these settings.

import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin-auth'
import { parseUsernameRequest, atomicJsonbRemove, atomicJsonbRemoveKey, checkUserInList } from '../_lib'
import { invalidateFilterSettingsCache } from '@/lib/filter-settings'

// POST /api/admin/submitters/unblock — Unblock a user
// Uses atomic PostgreSQL jsonb removal to prevent race conditions
// when concurrent block/unblock requests run at the same time.
export const POST = withAdmin(async (req: NextRequest) => {
  try {
    const parsed = await parseUsernameRequest(req)
    if (parsed instanceof NextResponse) return parsed
    const { normalizedUsername } = parsed

    // Check if the username exists in the blocked list first (for error response)
    const notFound = await checkUserInList('blocked_usernames', normalizedUsername, 'User tidak ditemukan di blocklist')
    if (notFound) return notFound

    // Wrap both removals in a transaction so that a DB connection drop mid-operation
    // cannot leave blocked_usernames updated but blocked_reasons untouched (partial state).
    // Matches the block route's transaction pattern exactly.
    await db.$transaction(async (tx) => {
      // Atomic removal from blocked_usernames JSON array using PostgreSQL jsonb.
      // This prevents the read-modify-write race condition where concurrent
      // requests could overwrite each other's changes.
      // jsonb_agg filters out the username, and returns NULL if the array
      // becomes empty (which we convert back to an empty array).
      await atomicJsonbRemove('blocked_usernames', normalizedUsername, tx)

      // Also remove the block reason (if any) — harmless if no reason was set
      await atomicJsonbRemoveKey('blocked_reasons', normalizedUsername, tx)
    })

    invalidateFilterSettingsCache()

    return NextResponse.json({ success: true, unblocked: normalizedUsername })
  } catch (error) {
    console.error('Unblock user error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
})
