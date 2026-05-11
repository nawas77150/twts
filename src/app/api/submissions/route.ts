import { db } from '@/lib/db'
import { getSubmitterFromRequest } from '@/lib/twitter-auth'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/submissions - List all submissions (admin only, includes submitter info)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'

  if (authHeader !== `Bearer ${adminPassword}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')

  const where = status && status !== 'all' ? { status } : {}

  const submissions = await db.submission.findMany({
    where,
    include: {
      submitter: {
        select: { id: true, username: true, displayName: true, profileImage: true, twitterId: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ submissions })
}

// POST /api/submissions - Create new submission (requires Twitter login)
export async function POST(req: NextRequest) {
  try {
    // Get submitter from session cookie (Twitter OAuth)
    const submitter = await getSubmitterFromRequest(req)

    if (!submitter) {
      return NextResponse.json({ error: 'Silakan login dengan akun X terlebih dahulu' }, { status: 401 })
    }

    const body = await req.json()
    const { message, category } = body

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Pesan wajib diisi' }, { status: 400 })
    }

    const trimmedMessage = message.trim()

    if (trimmedMessage.length === 0) {
      return NextResponse.json({ error: 'Pesan tidak boleh kosong' }, { status: 400 })
    }

    if (trimmedMessage.length > 280) {
      return NextResponse.json(
        { error: `Pesan terlalu panjang (${trimmedMessage.length}/280 karakter)` },
        { status: 400 }
      )
    }

    const submission = await db.submission.create({
      data: {
        message: trimmedMessage,
        category: category?.trim() || null,
        submitterId: submitter.id,
      },
    })

    return NextResponse.json({ submission }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
