import { db } from '@/lib/db'
import { parseXCookies } from '@/lib/twitter-post-cookie'
import { encrypt, decrypt, isEncrypted } from '@/lib/encrypt'
import { loginViaTwitterApi } from '@/lib/twitter-api-fallback'
import { verifyAdmin } from '@/lib/admin-auth'
import { NextRequest, NextResponse } from 'next/server'

const VALID_KEYS = [
  'x_cookie_string',
  'x_query_id',
  'x_bearer_token',
  'twitterapi_keys',
  'twitterapi_proxy',
  'post_method',
  'x_username',
  'x_email',
  'x_password',
  'x_totp_secret',
  'twitterapi_login_cookie',
]
const MAX_VALUE_LENGTH = 50000 // Larger for twitterapi_keys (JSON array)
const VALID_POST_METHODS = ['direct', 'api', 'auto']

// Keys that should trigger an auto-login attempt when saved
const LOGIN_TRIGGER_KEYS = [
  'x_username', 'x_email', 'x_password', 'x_totp_secret', 'twitterapi_proxy', 'twitterapi_keys',
]

// Keys that contain sensitive data — always encrypt and never reveal in GET
const SENSITIVE_KEYS = ['x_password', 'x_totp_secret', 'twitterapi_login_cookie']

/**
 * Decrypt a value for display/masking purposes.
 * If decryption fails, return a placeholder.
 */
function decryptForDisplay(value: string): string {
  try {
    return isEncrypted(value) ? decrypt(value) : value
  } catch {
    return '[encrypted]'
  }
}

// GET /api/admin/settings — Return all settings (values masked)
export async function GET(req: NextRequest) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

  const settings = await db.setting.findMany()

  // Mask all values — decrypt first, then mask for display
  const masked = settings.map((s) => {
    let displayValue = ''
    if (s.value) {
      // Decrypt for masking logic
      const decrypted = decryptForDisplay(s.value)

      if (s.key === 'twitterapi_keys') {
        // Show key count and first 8 chars of each key
        try {
          const keys = JSON.parse(decrypted) as string[]
          displayValue = `${keys.length} key(s): ${keys.map((k) => k.slice(0, 8) + '...').join(', ')}`
        } catch {
          displayValue = decrypted.slice(0, 20) + '...'
        }
      } else if (s.key === 'post_method') {
        displayValue = decrypted // post_method is not sensitive
      } else if (s.key === 'x_username') {
        displayValue = decrypted // username is public anyway
      } else if (s.key === 'x_email') {
        // Show first 3 chars + @...
        const atIdx = decrypted.indexOf('@')
        displayValue = atIdx > 0 ? decrypted.slice(0, 3) + '***@' + decrypted.slice(atIdx + 1) : decrypted.slice(0, 5) + '***'
      } else if (s.key === 'twitterapi_proxy') {
        // Mask password in proxy URL
        displayValue = decrypted.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')
      } else if (SENSITIVE_KEYS.includes(s.key)) {
        displayValue = '••••••••' // Never reveal passwords/secrets
      } else {
        displayValue = decrypted.slice(0, 8) + '...'
      }
    }
    return {
      key: s.key,
      value: displayValue,
      updatedAt: s.updatedAt,
    }
  })

  return NextResponse.json({ settings: masked })
}

// POST /api/admin/settings — Upsert a setting (encrypt + auto-login)
export async function POST(req: NextRequest) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

  const body = await req.json()
  const { key, value } = body

  if (!key || typeof value !== 'string') {
    return NextResponse.json({ error: 'key and value are required' }, { status: 400 })
  }

  // If value is empty, delete the setting instead of storing an empty string
  if (!value.trim()) {
    await db.setting.deleteMany({ where: { key } })
    return NextResponse.json({ deleted: true, key })
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

  // Validate twitterapi_keys is valid JSON array
  if (key === 'twitterapi_keys') {
    try {
      const parsed = JSON.parse(value)
      if (!Array.isArray(parsed)) {
        return NextResponse.json(
          { error: 'twitterapi_keys must be a JSON array of API keys, e.g. ["key1","key2"]' },
          { status: 400 }
        )
      }
      for (const k of parsed) {
        if (typeof k !== 'string' || !k.trim()) {
          return NextResponse.json(
            { error: 'Each API key must be a non-empty string.' },
            { status: 400 }
          )
        }
      }
    } catch {
      return NextResponse.json(
        { error: 'twitterapi_keys must be valid JSON, e.g. ["key1","key2"]' },
        { status: 400 }
      )
    }
  }

  // Validate post_method value
  if (key === 'post_method') {
    if (!VALID_POST_METHODS.includes(value)) {
      return NextResponse.json(
        { error: `post_method must be one of: ${VALID_POST_METHODS.join(', ')}` },
        { status: 400 }
      )
    }
  }

  // Validate proxy URL format (basic)
  if (key === 'twitterapi_proxy' && value.trim()) {
    if (!value.match(/^https?:\/\/.+/)) {
      return NextResponse.json(
        { error: 'Proxy must be a valid HTTP/HTTPS URL, e.g. http://user:pass@ip:port' },
        { status: 400 }
      )
    }
  }

  // Encrypt value before storing (post_method is not encrypted — it's not sensitive)
  const encryptedValue = key === 'post_method' ? value : encrypt(value)

  const setting = await db.setting.upsert({
    where: { key },
    update: { value: encryptedValue },
    create: { key, value: encryptedValue },
  })

  // Auto-login trigger: if this key is one of the login credentials,
  // check if ALL credentials are present and try to login
  let autoLoginResult: { attempted: boolean; success?: boolean; error?: string } | null = null

  if (LOGIN_TRIGGER_KEYS.includes(key)) {
    // Check if all login credentials are present
    const allSettings = await db.setting.findMany({
      where: {
        key: { in: ['x_username', 'x_email', 'x_password', 'x_totp_secret', 'twitterapi_proxy', 'twitterapi_keys'] },
        value: { not: '' },
      },
    })

    const hasAll = ['x_username', 'x_email', 'x_password', 'x_totp_secret', 'twitterapi_proxy', 'twitterapi_keys'].every(
      (k) => allSettings.some((s) => s.key === k)
    )

    if (hasAll) {
      autoLoginResult = { attempted: true }
      const loginResult = await loginViaTwitterApi()
      autoLoginResult.success = loginResult.success
      if (!loginResult.success) {
        autoLoginResult.error = loginResult.error
      }
    }
  }

  // Return parsed confirmation for cookie string so admin can verify
  if (key === 'x_cookie_string') {
    const parsed = parseXCookies(value)
    return NextResponse.json({
      setting: { key: setting.key, updatedAt: setting.updatedAt },
      parsed: {
        auth_token: parsed.auth_token ? parsed.auth_token.slice(0, 8) + '****' : 'NOT FOUND',
        ct0: parsed.ct0 ? parsed.ct0.slice(0, 8) + '****' : 'NOT FOUND',
      },
      autoLogin: autoLoginResult,
    })
  }

  // Return count for twitterapi_keys
  if (key === 'twitterapi_keys') {
    const keys = JSON.parse(value) as string[]
    return NextResponse.json({
      setting: { key: setting.key, updatedAt: setting.updatedAt },
      keyCount: keys.length,
      autoLogin: autoLoginResult,
    })
  }

  return NextResponse.json({
    setting: { key: setting.key, updatedAt: setting.updatedAt },
    autoLogin: autoLoginResult,
  })
}

// DELETE /api/admin/settings — Delete a setting
export async function DELETE(req: NextRequest) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

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
