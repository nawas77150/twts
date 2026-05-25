// NOTE: blocked_usernames / whitelist_usernames are intentionally stored as plaintext JSON.
// These are public X handles with no security sensitivity — encrypting them would provide
// no practical benefit. The PostgreSQL ::jsonb cast used for atomic add/remove operations
// requires plaintext values. Do NOT apply encrypt() to these settings.

import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/admin-auth'
import { parseUsernameRequest, atomicJsonbAppend, atomicJsonbRemove, checkUserInList } from '../_lib'
import { debugError } from '@/lib/debug'
import { invalidateFilterSettingsCache } from '@/lib/filter-settings'

// POST /api/admin/submitters/whitelist — Add a user to the whitelist
// Uses atomic PostgreSQL jsonb append to prevent race conditions.
export const POST = withAdmin(async (req: NextRequest) => {
  try {
    const parsed = await parseUsernameRequest(req)
    if (parsed instanceof NextResponse) return parsed
    const { normalizedUsername } = parsed

    // Wrap both mutations in a transaction to prevent partial state
    // (whitelist updated but blocked_usernames not yet removed).
    await db.$transaction(async (tx) => {
      // Atomic append to whitelist_usernames JSON array using PostgreSQL jsonb.
      // Prevents read-modify-write race condition.
      // If the key doesn't exist yet, creates it with [username].
      // If the username is already in the array, leaves it unchanged (no duplicates).
      await atomicJsonbAppend('whitelist_usernames', normalizedUsername, tx)

      // Also remove from blocked list if present (whitelist takes priority)
      await atomicJsonbRemove('blocked_usernames', normalizedUsername, tx)
    })

    invalidateFilterSettingsCache()

    return NextResponse.json({ success: true, whitelisted: normalizedUsername })
  } catch (error) {
    debugError('submitters/whitelist', 'POST error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
})

// DELETE /api/admin/submitters/whitelist — Remove a user from the whitelist
// Uses atomic PostgreSQL jsonb removal to prevent race conditions.
export const DELETE = withAdmin(async (req: NextRequest) => {
  try {
    const parsed = await parseUsernameRequest(req)
    if (parsed instanceof NextResponse) return parsed
    const { normalizedUsername } = parsed

    // Check if the username exists in the whitelist first
    const notFound = await checkUserInList('whitelist_usernames', normalizedUsername, 'User tidak ditemukan di whitelist')
    if (notFound) return notFound

    // Atomic removal from whitelist_usernames JSON array using PostgreSQL jsonb.
    await atomicJsonbRemove('whitelist_usernames', normalizedUsername)
    invalidateFilterSettingsCache()

    return NextResponse.json({ success: true, removed: normalizedUsername })
  } catch (error) {
    debugError('submitters/whitelist', 'DELETE error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
})
