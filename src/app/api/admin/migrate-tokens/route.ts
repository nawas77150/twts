// src/app/api/admin/migrate-tokens/route.ts
import { db } from '@/lib/db'
import { encrypt, isEncrypted } from '@/lib/encrypt'
import { verifyAdmin, getAdminTokenFromRequest } from '@/lib/admin-auth'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const auth = verifyAdmin(getAdminTokenFromRequest(req))
  if (!auth.authorized) return auth.response

  const submitters = await db.submitter.findMany({
    where: {
      OR: [
        { oauth2AccessToken: { not: null } },
        { oauth2RefreshToken: { not: null } },
      ]
    },
    select: { id: true, username: true, oauth2AccessToken: true, oauth2RefreshToken: true }
  })

  let migrated = 0
  for (const s of submitters) {
    const updates: Record<string, string> = {}
    if (s.oauth2AccessToken && !isEncrypted(s.oauth2AccessToken)) {
      updates.oauth2AccessToken = encrypt(s.oauth2AccessToken)
    }
    if (s.oauth2RefreshToken && !isEncrypted(s.oauth2RefreshToken)) {
      updates.oauth2RefreshToken = encrypt(s.oauth2RefreshToken)
    }
    if (Object.keys(updates).length > 0) {
      await db.submitter.update({ where: { id: s.id }, data: updates })
      migrated++
    }
  }

  return NextResponse.json({ migrated, total: submitters.length })
}
