import { db } from '@/lib/db'
import { parseXCookies } from '@/lib/twitter-post-cookie'
import { encrypt, decryptSetting, isEncryptionEnabled } from '@/lib/encrypt'
import { loginViaTwitterApi } from '@/lib/twitter-api-fallback'
import { withAdmin } from '@/lib/admin-auth'
import { invalidateCreditsCache } from '@/lib/twitter-api-credits'
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
  'v2_login_enabled',
]
const MAX_VALUE_LENGTH = 50000 // Larger for twitterapi_keys (JSON array)
const VALID_POST_METHODS = ['direct', 'api', 'auto']
const VALID_BOOLEAN_SETTINGS = ['v2_login_enabled']

// Keys that should trigger an auto-login attempt when saved
const LOGIN_TRIGGER_KEYS = [
  'x_username', 'x_email', 'x_password', 'x_totp_secret', 'twitterapi_proxy', 'twitterapi_keys',
]

// Keys that contain sensitive data — always encrypt and never reveal in GET
const SENSITIVE_KEYS = ['x_password', 'x_totp_secret', 'twitterapi_login_cookie']

// GET /api/admin/settings — Return all settings (values masked)
export const GET = withAdmin(async (req: NextRequest) => {
  try {
    const settings = await db.setting.findMany()

  // Mask all values — decrypt first, then mask for display
  const masked = settings.map((s) => {
    let displayValue = ''
    if (s.value) {
      // Decrypt for masking logic
      const decrypted = decryptSetting(s.value, '[encrypted]')

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
      } else if (s.key === 'v2_login_enabled') {
        displayValue = decrypted // toggle is not sensitive
      } else if (s.key === 'x_username') {
        displayValue = decrypted // username is public anyway
      } else if (s.key === 'x_email') {
        // Show first 3 chars + @...
        const atIdx = decrypted.indexOf('@')
        displayValue = atIdx > 0 ? decrypted.slice(0, 3) + '***@' + decrypted.slice(atIdx + 1) : decrypted.slice(0, 5) + '***'
      } else if (s.key === 'twitterapi_proxy') {
        // Mask password in proxy URL
        displayValue = decrypted.replace(/\/\/([^:]+):([^@]+)@/, '//****:****@')
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

  return NextResponse.json({ settings: masked, encryptionEnabled: isEncryptionEnabled() })
  } catch (error) {
    console.error('Settings GET error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
})

// POST /api/admin/settings — Upsert a setting (encrypt + auto-login)
export const POST = withAdmin(async (req: NextRequest) => {
  try {
  const body = await req.json()
  const { key, value } = body

  if (!key || typeof value !== 'string') {
    return NextResponse.json({ error: 'key and value are required' }, { status: 400 })
  }

  // Reject empty/whitespace-only values to prevent encrypted-empty bypass
  // (encrypt('') produces non-empty ciphertext that passes { not: '' } filters)
  if (!value.trim()) {
    return NextResponse.json({ error: 'Value cannot be empty' }, { status: 400 })
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
    const missing = []
    if (!value.includes('auth_token=')) missing.push('auth_token')
    if (!value.includes('ct0=')) missing.push('ct0')
    if (!value.includes('twid=')) missing.push('twid')
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `Cookie string must contain ${missing.join(', ')}. Copy the full cookie string from your browser.`,
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

  // Validate boolean settings
  if (VALID_BOOLEAN_SETTINGS.includes(key)) {
    if (value !== 'true' && value !== 'false') {
      return NextResponse.json(
        { error: `${key} must be 'true' or 'false'` },
        { status: 400 }
      )
    }
  }

  // Validate proxy URL format + block private/internal IPs (SSRF protection)
  if (key === 'twitterapi_proxy' && value.trim()) {
    if (!value.match(/^https?:\/\/.+/)) {
      return NextResponse.json(
        { error: 'Proxy must be a valid HTTP/HTTPS URL, e.g. http://user:pass@ip:port' },
        { status: 400 }
      )
    }
    // Parse hostname and reject RFC 1918, loopback, link-local, and cloud metadata IPs
    try {
      const url = new URL(value)
      const hostname = url.hostname
      const isPrivate =
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal') ||
        // Loopback 127.0.0.0/8
        (() => { const p = hostname.split('.'); return p.length === 4 && p[0] === '127' })() ||
        // Link-local 169.254.0.0/16 (includes AWS/GCP metadata endpoint)
        (() => { const p = hostname.split('.'); return p.length === 4 && p[0] === '169' && p[1] === '254' })() ||
        // RFC 1918: 10.0.0.0/8
        (() => { const p = hostname.split('.').map(Number); return p.length === 4 && p[0] === 10 })() ||
        // RFC 1918: 172.16.0.0/12 (172.16.x.x – 172.31.x.x)
        (() => { const p = hostname.split('.').map(Number); return p.length === 4 && p[0] === 172 && p[1] >= 16 && p[1] <= 31 })() ||
        // RFC 1918: 192.168.0.0/16
        (() => { const p = hostname.split('.').map(Number); return p.length === 4 && p[0] === 192 && p[1] === 168 })() ||
        // 0.0.0.0
        hostname === '0.0.0.0' ||
        // IPv6 loopback
        hostname === '::1' ||
        hostname.startsWith('fc') || hostname.startsWith('fd')  // IPv6 ULA
      if (isPrivate) {
        return NextResponse.json(
          { error: 'Proxy URL must not point to a private/internal IP address' },
          { status: 400 }
        )
      }
    } catch {
      return NextResponse.json(
        { error: 'Proxy must be a valid HTTP/HTTPS URL, e.g. http://user:pass@ip:port' },
        { status: 400 }
      )
    }
  }

  // Encrypt value before storing (non-sensitive settings are not encrypted)
  const nonEncryptedKeys = ['post_method', 'v2_login_enabled']
  const encryptedValue = nonEncryptedKeys.includes(key) ? value : encrypt(value)

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
      },
    })
    // Decrypt + filter: DB-level { not: '' } misses encrypted empties and
    // {PLAINTEXT}-tagged empties (regression from C3 fix). Application-level
    // check correctly detects all empty-value representations.
    const nonEmptySettings = allSettings.filter(s => {
      if (!s.value) return false
      const decrypted = decryptSetting(s.value, '')
      return decrypted.trim() !== ''
    })

    const hasAll = ['x_username', 'x_email', 'x_password', 'x_totp_secret', 'twitterapi_proxy', 'twitterapi_keys'].every(
      (k) => nonEmptySettings.some((s) => s.key === k)
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
        twid: parsed.twid ? parsed.twid.slice(0, 8) + '****' : 'NOT FOUND',
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
  } catch (error) {
    console.error('Settings POST error:', error)
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
  if (LOGIN_TRIGGER_KEYS.includes(key)) {
    await db.setting.deleteMany({ where: { key: 'twitterapi_login_cookie' } })
  }

  // Invalidate credits cache when API keys are deleted so dashboard refreshes
  if (key === 'twitterapi_keys') {
    invalidateCreditsCache()
  }

  return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Settings DELETE error:', error)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
})
