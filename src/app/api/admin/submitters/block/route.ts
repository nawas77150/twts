import { db } from '@/lib/db'
import { verifyAdmin } from '@/lib/admin-auth'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/admin/submitters/block — Block a user from submitting
export async function POST(req: NextRequest) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

  try {
    const { username } = await req.json()
    if (!username || typeof username !== 'string' || !username.trim()) {
      return NextResponse.json({ error: 'Username wajib diisi' }, { status: 400 })
    }

    const normalizedUsername = username.toLowerCase().trim()

    // Read current blocked list, add username, write back
    const existing = await db.setting.findUnique({ where: { key: 'blocked_usernames' } })
    let blocked: string[] = []
    try {
      if (existing?.value) blocked = JSON.parse(existing.value)
    } catch { /* empty */ }

    if (!blocked.includes(normalizedUsername)) {
      blocked.push(normalizedUsername)
      await db.setting.upsert({
        where: { key: 'blocked_usernames' },
        update: { value: JSON.stringify(blocked) },
        create: { key: 'blocked_usernames', value: JSON.stringify(blocked) },
      })
    }

    // Also remove from whitelist if present (blocked takes priority)
    const whitelistSetting = await db.setting.findUnique({ where: { key: 'whitelist_usernames' } })
    if (whitelistSetting?.value) {
      try {
        let whitelist: string[] = JSON.parse(whitelistSetting.value)
        if (whitelist.includes(normalizedUsername)) {
          whitelist = whitelist.filter(u => u !== normalizedUsername)
          await db.setting.upsert({
            where: { key: 'whitelist_usernames' },
            update: { value: JSON.stringify(whitelist) },
            create: { key: 'whitelist_usernames', value: JSON.stringify(whitelist) },
          })
        }
      } catch { /* ignore */ }
    }

    return NextResponse.json({ success: true, blocked: normalizedUsername })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
