import { db } from '@/lib/db'
import { verifyAdmin } from '@/lib/admin-auth'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/admin/submitters/unblock — Unblock a user
export async function POST(req: NextRequest) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

  try {
    const { username } = await req.json()
    if (!username || typeof username !== 'string' || !username.trim()) {
      return NextResponse.json({ error: 'Username wajib diisi' }, { status: 400 })
    }

    const normalizedUsername = username.toLowerCase().trim()

    // Read current blocked list, remove username, write back
    const existing = await db.setting.findUnique({ where: { key: 'blocked_usernames' } })
    if (!existing?.value) {
      return NextResponse.json({ error: 'User tidak ditemukan di blocklist' }, { status: 400 })
    }

    let blocked: string[] = []
    try {
      blocked = JSON.parse(existing.value)
    } catch { /* empty */ }

    if (!blocked.includes(normalizedUsername)) {
      return NextResponse.json({ error: 'User tidak ditemukan di blocklist' }, { status: 400 })
    }

    blocked = blocked.filter(u => u !== normalizedUsername)
    await db.setting.upsert({
      where: { key: 'blocked_usernames' },
      update: { value: JSON.stringify(blocked) },
      create: { key: 'blocked_usernames', value: JSON.stringify(blocked) },
    })

    return NextResponse.json({ success: true, unblocked: normalizedUsername })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
