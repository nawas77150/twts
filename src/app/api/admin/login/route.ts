import { NextRequest, NextResponse } from 'next/server'

// POST /api/admin/login - Verify admin password
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { password } = body

    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'

    if (password === adminPassword) {
      return NextResponse.json({ success: true, token: adminPassword })
    }

    return NextResponse.json({ error: 'Password salah' }, { status: 401 })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan' }, { status: 500 })
  }
}
