import { db } from '@/lib/db'
import { parseXCookies } from '@/lib/twitter-post-cookie'
import { NextRequest, NextResponse } from 'next/server'

const VALID_KEYS = ['x_cookie_string', 'x_query_id', 'x_bearer_token']
const MAX_VALUE_LENGTH = 10000

// GET /api/admin/settings — Return all settings (values masked)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'
  if (authHeader !== `Bearer ${adminPassword}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const settings = await db.setting.findMany()

  // Mask all values consistently — first 8 chars + "..."
  const masked = settings.map((s) => ({
    key: s.key,
    value: s.value ? s.value.slice(0, 8) + '...' : '',
    updatedAt: s.updatedAt,
  }))

  return NextResponse.json({ settings: masked })
}

// POST /api/admin/settings — Upsert a setting
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'
  if (authHeader !== `Bearer ${adminPassword}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { key, value } = body

  if (!key || typeof value !== 'string') {
    return NextResponse.json({ error: 'key and value are required' }, { status: 400 })
  }

  // Validate known keys only
  if (!VALID_KEYS.includes(key)) {
    return NextResponse.json(
      { error: `Invalid key. Valid keys: ${VALID_KEYS.join(', ')}` },
      { status: 400 }
    )
  }

  // Cap value length
  if (value.length > MAX_VALUE_LENGTH) {
    return NextResponse.json(
      { error: `Value too long (max ${MAX_VALUE_LENGTH} characters)` },
      { status: 400 }
    )
  }

  // Validate cookie string has required fields
  if (key === 'x_cookie_string') {
    if (!value.includes('auth_token=') || !value.includes('ct0=')) {
      return NextResponse.json(
        {
          error:
            'Cookie string must contain both auth_token and ct0. Copy the full cookie string from your browser.',
        },
        { status: 400 }
      )
    }
  }

  const setting = await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })

  // Return parsed confirmation for cookie string so admin can verify
  if (key === 'x_cookie_string') {
    const parsed = parseXCookies(value)
    return NextResponse.json({
      setting: { key: setting.key, updatedAt: setting.updatedAt },
      parsed: {
        auth_token: parsed.auth_token ? parsed.auth_token.slice(0, 8) + '****' : 'NOT FOUND',
        ct0: parsed.ct0 ? parsed.ct0.slice(0, 8) + '****' : 'NOT FOUND',
      },
    })
  }

  return NextResponse.json({
    setting: { key: setting.key, updatedAt: setting.updatedAt },
  })
}

// DELETE /api/admin/settings — Delete a setting
export async function DELETE(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'
  if (authHeader !== `Bearer ${adminPassword}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const key = searchParams.get('key')

  if (!key) {
    return NextResponse.json({ error: 'key query param is required' }, { status: 400 })
  }

  if (!VALID_KEYS.includes(key)) {
    return NextResponse.json(
      { error: `Invalid key. Valid keys: ${VALID_KEYS.join(', ')}` },
      { status: 400 }
    )
  }

  await db.setting.deleteMany({ where: { key } })
  return NextResponse.json({ success: true })
}
