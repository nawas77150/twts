// Shared helpers for whitelist/block/unblock route handlers.
// Extracts duplicated auth+validate+normalize patterns and SQL operations.

import { db } from '@/lib/db'
import { verifyAdmin, getAdminTokenFromRequest } from '@/lib/admin-auth'
import { NextRequest, NextResponse } from 'next/server'

// --- Helper 1: Auth + parse + validate + normalize ---
// Must be async because req.json() returns Promise<unknown>.
// Callers MUST invoke this inside a try block so that malformed JSON
// bodies are caught by the handler's catch clause.
export async function parseUsernameRequest(req: NextRequest): Promise<{ normalizedUsername: string } | NextResponse> {
  const auth = verifyAdmin(getAdminTokenFromRequest(req))
  if (!auth.authorized) return auth.response

  const { username } = await req.json()
  if (!username || typeof username !== 'string' || !username.trim()) {
    return NextResponse.json({ error: 'Username wajib diisi' }, { status: 400 })
  }

  return { normalizedUsername: username.toLowerCase().trim() }
}

// --- Helper 2: Atomic JSONB append ---
// Uses tagged template literal for safe parameterization.
// ${settingKey} becomes $1, $2 etc. — identical SQL to current inline code.
export async function atomicJsonbAppend(settingKey: string, username: string): Promise<void> {
  try {
    const usernameArr = JSON.stringify([username])
    await db.$executeRaw`
      INSERT INTO "Setting" (id, key, value, "updatedAt")
      VALUES (
        ${settingKey},
        ${settingKey},
        ${usernameArr},
        NOW()
      )
      ON CONFLICT (key) DO UPDATE
      SET "value" = (
        CASE WHEN "Setting"."value"::jsonb @> ${usernameArr}::jsonb
        THEN "Setting"."value"
        ELSE ("Setting"."value"::jsonb || ${JSON.stringify(username)}::jsonb)::text
        END
      ),
      "updatedAt" = NOW()
    `
  } catch (error) {
    console.error('[submitters] atomicJsonbAppend failed:', error)
    throw error
  }
}

// --- Helper 3: Atomic JSONB remove ---
// Without the AND guard — functionally correct: UPDATE is a no-op if
// username isn't in the array (only updatedAt changes).
export async function atomicJsonbRemove(settingKey: string, username: string): Promise<void> {
  try {
    await db.$executeRaw`
      UPDATE "Setting"
      SET "value" = COALESCE(
        (SELECT jsonb_agg(elem) FROM jsonb_array_elements_text("Setting"."value"::jsonb) AS elem WHERE elem != ${username}),
        '[]'::jsonb
      )::text,
      "updatedAt" = NOW()
      WHERE "key" = ${settingKey}
    `
  } catch (error) {
    console.error('[submitters] atomicJsonbRemove failed:', error)
    throw error
  }
}

// --- Helper 4: Check user exists in list (for error response) ---
export async function checkUserInList(
  settingKey: string,
  username: string,
  notFoundError: string,
): Promise<NextResponse | null> {
  const existing = await db.setting.findUnique({ where: { key: settingKey } })
  if (!existing?.value) {
    return NextResponse.json({ error: notFoundError }, { status: 400 })
  }

  let list: string[] = []
  try {
    list = JSON.parse(existing.value)
  } catch { /* empty */ }

  if (!list.includes(username)) {
    return NextResponse.json({ error: notFoundError }, { status: 400 })
  }

  return null // user found, no error
}
