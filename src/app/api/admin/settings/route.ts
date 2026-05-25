import { db } from '@/lib/db'
import { encrypt, decryptSetting, isEncryptionEnabled } from '@/lib/encrypt'
import { withAdmin } from '@/lib/admin-auth'
import { invalidateCreditsCache } from '@/lib/twitter-api-credits'
import { LOGIN_CREDENTIAL_KEYS } from '@/lib/twitter-api-shared'
import { debugError } from '@/lib/debug'
import { NextRequest, NextResponse } from 'next/server'
import {
  VALID_KEYS,
  NON_ENCRYPTED_KEYS,
  maskSettingValue,
  validateSettingInput,
  tryAutoLogin,
  formatSettingResponse,
} from '@/lib/admin-settings-helpers'

// GET /api/admin/settings — Return all settings (values masked)
export const GET = withAdmin(async (_req: NextRequest) => {
  try {
    const settings = await db.setting.findMany()

    // Mask all values — decrypt first, then mask for display
    const masked = settings.map((s) => ({
      key: s.key,
      value: s.value ? maskSettingValue(s.key, decryptSetting(s.value, '[encrypted]')) : '',
      updatedAt: s.updatedAt,
    }))

    return NextResponse.json({ settings: masked, encryptionEnabled: isEncryptionEnabled() })
  } catch (error) {
    debugError('admin/settings', 'GET error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
})

// POST /api/admin/settings — Upsert a setting (encrypt + auto-login)
export const POST = withAdmin(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const { key, value } = body

    const validationError = validateSettingInput(key, value)
    if (validationError) {
      return NextResponse.json({ error: validationError.error }, { status: validationError.status })
    }

    // Encrypt value before storing (non-sensitive settings are not encrypted)
    const encryptedValue = NON_ENCRYPTED_KEYS.includes(key) ? value : encrypt(value)

    const setting = await db.setting.upsert({
      where: { key },
      update: { value: encryptedValue },
      create: { key, value: encryptedValue },
    })

    const autoLoginResult = await tryAutoLogin(key)

    return NextResponse.json(formatSettingResponse(key, setting, value, autoLoginResult))
  } catch (error) {
    debugError('admin/settings', 'POST error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
})

// DELETE /api/admin/settings — Delete a setting
export const DELETE = withAdmin(async (req: NextRequest) => {
  try {
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

    // If deleting a login credential, also clear the cached login cookie
    // so the fallback module doesn't use stale auth
    if (LOGIN_CREDENTIAL_KEYS.includes(key)) {
      await db.setting.deleteMany({ where: { key: 'twitterapi_login_cookie' } })
    }

    // Invalidate credits cache when API keys are deleted so dashboard refreshes
    if (key === 'twitterapi_keys') {
      invalidateCreditsCache()
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    debugError('admin/settings', 'DELETE error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
})
