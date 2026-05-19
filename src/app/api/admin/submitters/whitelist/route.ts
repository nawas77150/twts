// NOTE: blocked_usernames / whitelist_usernames are intentionally stored as plaintext JSON.
// These are public X handles with no security sensitivity — encrypting them would provide
// no practical benefit. The PostgreSQL ::jsonb cast used for atomic add/remove operations
// requires plaintext values. Do NOT apply encrypt() to these settings.

import { NextRequest, NextResponse } from 'next/server'
import { parseUsernameRequest, atomicJsonbAppend, atomicJsonbRemove, checkUserInList } from '../_lib'

// POST /api/admin/submitters/whitelist — Add a user to the whitelist
// Uses atomic PostgreSQL jsonb append to prevent race conditions.
export async function POST(req: NextRequest) {
  try {
    const parsed = await parseUsernameRequest(req)
    if (parsed instanceof NextResponse) return parsed
    const { normalizedUsername } = parsed

    // Atomic append to whitelist_usernames JSON array using PostgreSQL jsonb.
    // Prevents read-modify-write race condition.
    // If the key doesn't exist yet, creates it with [username].
    // If the username is already in the array, leaves it unchanged (no duplicates).
    await atomicJsonbAppend('whitelist_usernames', normalizedUsername)

    // Also remove from blocked list if present (whitelist takes priority)
    await atomicJsonbRemove('blocked_usernames', normalizedUsername)

    return NextResponse.json({ success: true, whitelisted: normalizedUsername })
  } catch (error) {
    console.error('Whitelist POST error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}

// DELETE /api/admin/submitters/whitelist — Remove a user from the whitelist
// Uses atomic PostgreSQL jsonb removal to prevent race conditions.
export async function DELETE(req: NextRequest) {
  try {
    const parsed = await parseUsernameRequest(req)
    if (parsed instanceof NextResponse) return parsed
    const { normalizedUsername } = parsed

    // Check if the username exists in the whitelist first
    const notFound = await checkUserInList('whitelist_usernames', normalizedUsername, 'User tidak ditemukan di whitelist')
    if (notFound) return notFound

    // Atomic removal from whitelist_usernames JSON array using PostgreSQL jsonb.
    await atomicJsonbRemove('whitelist_usernames', normalizedUsername)

    return NextResponse.json({ success: true, removed: normalizedUsername })
  } catch (error) {
    console.error('Whitelist DELETE error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
