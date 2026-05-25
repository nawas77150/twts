// Shared helpers for whitelist/block/unblock route handlers.
// Extracts duplicated parse+validate+normalize patterns and SQL operations.
// Auth is handled by the withAdmin wrapper in each route — not here.

import { db } from '@/lib/db'
import { debugError } from '@/lib/debug'
import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'

// --- Helper 1: Parse + validate + normalize username from request body ---
// Must be async because req.json() returns Promise<unknown>.
// Callers MUST invoke this inside a try block so that malformed JSON
// bodies are caught by the handler's catch clause.
// NOTE: Auth is handled by withAdmin() wrapper in the route — this function
// only parses and validates the request body.
export async function parseUsernameRequest(req: NextRequest): Promise<{ normalizedUsername: string; reason?: string } | NextResponse> {
  const { username, reason } = await req.json() as { username?: string; reason?: string }
  if (!username || typeof username !== 'string' || !username.trim()) {
    return NextResponse.json({ error: 'Username wajib diisi' }, { status: 400 })
  }

  // Strip leading @ before normalizing — Twitter OAuth returns bare usernames ("alice"),
  // but admins often paste "@alice". Without stripping, the includes() check in
  // _rate-limits.ts silently fails: ['@alice'].includes('alice') → false.
  return {
    normalizedUsername: username.toLowerCase().trim().replace(/^@/, ''),
    reason: typeof reason === 'string' ? (reason.trim() || undefined) : undefined,
  }
}

// --- Helper 2: Atomic JSONB append ---
// Uses tagged template literal for safe parameterization.
// ${settingKey} becomes $1, $2 etc. — identical SQL to current inline code.
// Optional `tx` param: when inside a $transaction, pass the transaction client
// so all operations share the same transaction. Falls back to `db` if omitted.
export async function atomicJsonbAppend(settingKey: string, username: string, tx?: Prisma.TransactionClient): Promise<void> {
  const client = tx ?? db
  try {
    const usernameArr = JSON.stringify([username])
    await client.$executeRaw`
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
        ELSE ("Setting"."value"::jsonb || ${usernameArr}::jsonb)::text
        END
      ),
      "updatedAt" = NOW()
    `
  } catch (error) {
    debugError('submitters', 'atomicJsonbAppend failed:', error)
    throw error
  }
}

// --- Helper 3: Atomic JSONB remove ---
// Without the AND guard — functionally correct: UPDATE is a no-op if
// username isn't in the array (only updatedAt changes).
// Optional `tx` param: when inside a $transaction, pass the transaction client.
export async function atomicJsonbRemove(settingKey: string, username: string, tx?: Prisma.TransactionClient): Promise<void> {
  const client = tx ?? db
  try {
    await client.$executeRaw`
      UPDATE "Setting"
      SET "value" = COALESCE(
        (SELECT jsonb_agg(elem) FROM jsonb_array_elements_text("Setting"."value"::jsonb) AS elem WHERE elem != ${username}),
        '[]'::jsonb
      )::text,
      "updatedAt" = NOW()
      WHERE "key" = ${settingKey}
    `
  } catch (error) {
    debugError('submitters', 'atomicJsonbRemove failed:', error)
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

// --- Helper 5: Atomic JSONB object key set ---
// Sets obj[key] = value using PostgreSQL jsonb_set().
// Used by block route to store per-user block reasons.
// `key` is a normalized username (no { or } chars — safe as jsonpath).
// COALESCE(NULLIF(...), '{}') guard: if the existing row's value is corrupt
// (empty string, invalid JSON), the ::jsonb cast would throw. This fallback
// treats corrupt data as empty object instead of breaking every block action.
export async function atomicJsonbSetKey(
  settingKey: string,
  key: string,
  value: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? db
  try {
    const initialValue = JSON.stringify({ [key]: value })
    const jsonPath = `{${key}}`
    const jsonValue = JSON.stringify(value)  // Must be valid JSON — string needs quotes
    await client.$executeRaw`
      INSERT INTO "Setting" (id, key, value, "updatedAt")
      VALUES (${settingKey}, ${settingKey}, ${initialValue}, NOW())
      ON CONFLICT (key) DO UPDATE
      SET "value" = jsonb_set(COALESCE(NULLIF("Setting"."value", ''), '{}')::jsonb, ${jsonPath}::text[], ${jsonValue}::jsonb)::text,
          "updatedAt" = NOW()
    `
  } catch (error) {
    debugError('submitters', 'atomicJsonbSetKey failed:', error)
    throw error
  }
}

// --- Helper 6: Atomic JSONB object key remove ---
// Removes obj[key] using PostgreSQL `-` operator.
// Used by unblock route to clean up block reasons.
export async function atomicJsonbRemoveKey(
  settingKey: string,
  key: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? db
  try {
    await client.$executeRaw`
      UPDATE "Setting"
      SET "value" = (COALESCE(NULLIF("Setting"."value", ''), '{}')::jsonb - ${key})::text,
          "updatedAt" = NOW()
      WHERE "key" = ${settingKey}
    `
  } catch (error) {
    debugError('submitters', 'atomicJsonbRemoveKey failed:', error)
    throw error
  }
}
