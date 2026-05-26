// ============================================================
// admin-settings-helpers.ts — Pure-logic helpers for admin settings
//
// Extracted from src/app/api/admin/settings/route.ts to reduce
// route CC from 68 → 14. Every function is testable in isolation
// with no Next.js dependency (no NextRequest/NextResponse).
//
// Imports only: db, encrypt, twitter-v2-login, is-private-ip,
//               twitter-api-shared, twitter-post-request
// ============================================================

import { db } from '@/lib/db'
import { decryptSetting } from '@/lib/encrypt'
import { loginViaTwitterApi } from '@/lib/twitter-v2-login'
import { isPrivateIP } from '@/lib/is-private-ip'
import { maskProxyUrl, LOGIN_CREDENTIAL_KEYS } from '@/lib/twitter-api-shared'
import { parseXCookies } from '@/lib/twitter-post-request'

// ── Constants ───────────────────────────────────────────

export const VALID_KEYS = [
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
  'post_hashtags',
]

const MAX_VALUE_LENGTH = 50000 // Larger for twitterapi_keys (JSON array)
const VALID_POST_METHODS = ['direct', 'api', 'auto']
const VALID_BOOLEAN_SETTINGS = ['v2_login_enabled']

// Keys that contain sensitive data — always encrypt and never reveal in GET
const SENSITIVE_KEYS = ['x_password', 'x_totp_secret', 'twitterapi_login_cookie']

// Keys whose values are stored without encryption (non-sensitive toggles/text)
export const NON_ENCRYPTED_KEYS = ['post_method', 'v2_login_enabled', 'post_hashtags']

// ── Extract A: Mask a setting value for safe display ─────

/**
 * Mask a decrypted setting value for safe display in the admin GET response.
 * Each key type gets appropriate masking — sensitive values are fully hidden,
 * semi-sensitive values are partially revealed, and non-sensitive values are
 * shown in full.
 */
export function maskSettingValue(key: string, decrypted: string): string {
  if (key === 'twitterapi_keys') {
    // Show key count and first 8 chars of each key
    try {
      const keys = JSON.parse(decrypted) as string[]
      return `${keys.length} key(s): ${keys.map((k) => k.slice(0, 8) + '...').join(', ')}`
    } catch {
      return decrypted.slice(0, 20) + '...'
    }
  }
  if (key === 'post_method') return decrypted // post_method is not sensitive
  if (key === 'v2_login_enabled') return decrypted // toggle is not sensitive
  if (key === 'x_username') return decrypted // username is public anyway
  if (key === 'x_email') {
    // Show first 3 chars + @...
    const atIdx = decrypted.indexOf('@')
    return atIdx > 0 ? decrypted.slice(0, 3) + '***@' + decrypted.slice(atIdx + 1) : decrypted.slice(0, 5) + '***'
  }
  if (key === 'twitterapi_proxy') {
    // Mask password in proxy URL (consistent with maskProxyUrl in twitter-api-shared)
    return maskProxyUrl(decrypted)
  }
  if (key === 'post_hashtags') return decrypted // hashtags are not sensitive
  if (SENSITIVE_KEYS.includes(key)) return '••••••••' // Never reveal passwords/secrets
  return decrypted.slice(0, 8) + '...'
}

// ── Extract B: Validate a setting key/value pair ─────────

/**
 * Validate a setting key/value pair before upsert.
 * Returns { error, status } if validation fails, or null if valid.
 * Error messages and status codes are identical to the original inline checks.
 */
export function validateSettingInput(
  key: string,
  value: string,
): { error: string; status: number } | null {
  if (!key || typeof value !== 'string') {
    return { error: 'key and value are required', status: 400 }
  }

  // Reject empty/whitespace-only values to prevent encrypted-empty bypass
  // (encrypt('') produces non-empty ciphertext that passes { not: '' } filters)
  // Exception: post_hashtags can be cleared (empty = no hashtags)
  if (key !== 'post_hashtags' && !value.trim()) {
    return { error: 'Value cannot be empty', status: 400 }
  }

  // Validate known keys only
  if (!VALID_KEYS.includes(key)) {
    return { error: `Invalid key. Valid keys: ${VALID_KEYS.join(', ')}`, status: 400 }
  }

  // Cap value length
  if (value.length > MAX_VALUE_LENGTH) {
    return { error: `Value too long (max ${MAX_VALUE_LENGTH} characters)`, status: 400 }
  }

  // Validate cookie string has required fields (using parseXCookies for strict regex matching)
  if (key === 'x_cookie_string') {
    const parsed = parseXCookies(value)
    const missing = [
      !parsed.auth_token && 'auth_token',
      !parsed.ct0 && 'ct0',
      !parsed.twid && 'twid',
    ].filter(Boolean) as string[]
    if (missing.length > 0) {
      return {
        error: `Cookie string must contain ${missing.join(', ')}. Copy the full cookie string from your browser.`,
        status: 400,
      }
    }
  }

  // Validate twitterapi_keys is valid JSON array
  if (key === 'twitterapi_keys') {
    try {
      const parsed = JSON.parse(value)
      if (!Array.isArray(parsed)) {
        return { error: 'twitterapi_keys must be a JSON array of API keys, e.g. ["key1","key2"]', status: 400 }
      }
      for (const k of parsed) {
        if (typeof k !== 'string' || !k.trim()) {
          return { error: 'Each API key must be a non-empty string.', status: 400 }
        }
      }
    } catch {
      return { error: 'twitterapi_keys must be valid JSON, e.g. ["key1","key2"]', status: 400 }
    }
  }

  // Validate post_method value
  if (key === 'post_method') {
    if (!VALID_POST_METHODS.includes(value)) {
      return { error: `post_method must be one of: ${VALID_POST_METHODS.join(', ')}`, status: 400 }
    }
  }

  // Validate boolean settings
  if (VALID_BOOLEAN_SETTINGS.includes(key)) {
    if (value !== 'true' && value !== 'false') {
      return { error: `${key} must be 'true' or 'false'`, status: 400 }
    }
  }

  // Validate post_hashtags: each tag must start with #, max 60 chars total
  if (key === 'post_hashtags' && value.trim()) {
    if (value.length > 60) {
      return { error: 'Hashtag total max 60 characters', status: 400 }
    }
    const invalid = value.split(/\s+/).filter(t => !t.startsWith('#') || t.length < 2)
    if (invalid.length > 0) {
      return {
        error: `Each hashtag must start with # and be at least 2 characters. Invalid: ${invalid.join(', ')}`,
        status: 400,
      }
    }
  }

  // Validate proxy URL format + block private/internal IPs (SSRF protection)
  if (key === 'twitterapi_proxy' && value.trim()) {
    if (!value.match(/^https?:\/\/.+/)) {
      return { error: 'Proxy must be a valid HTTP/HTTPS URL, e.g. http://user:pass@ip:port', status: 400 }
    }
    try {
      const hostname = new URL(value).hostname
      if (isPrivateIP(hostname)) {
        return { error: 'Proxy URL must not point to a private/internal IP address', status: 400 }
      }
    } catch {
      return { error: 'Proxy must be a valid HTTP/HTTPS URL, e.g. http://user:pass@ip:port', status: 400 }
    }
  }

  return null
}

// ── Extract C: Auto-login trigger ────────────────────────

export type AutoLoginResult = { attempted: boolean; success?: boolean; error?: string }

/**
 * Attempt auto-login when a login credential key is updated.
 * Returns null if the key is not a login credential or if not all
 * credentials are present yet. Returns { attempted, success?, error? }
 * if a login was attempted.
 */
export async function tryAutoLogin(key: string): Promise<AutoLoginResult | null> {
  if (!LOGIN_CREDENTIAL_KEYS.includes(key)) return null

  const allSettings = await db.setting.findMany({
    where: { key: { in: [...LOGIN_CREDENTIAL_KEYS] } },
  })

  // Decrypt + filter: DB-level { not: '' } misses encrypted empties and
  // {PLAINTEXT}-tagged empties (regression from C3 fix). Application-level
  // check correctly detects all empty-value representations.
  const nonEmptySettings = allSettings.filter(s => {
    if (!s.value) return false
    const decrypted = decryptSetting(s.value, '')
    return decrypted.trim() !== ''
  })

  const hasAll = [...LOGIN_CREDENTIAL_KEYS].every(
    (k) => nonEmptySettings.some((s) => s.key === k)
  )

  if (!hasAll) return null

  const result: AutoLoginResult = { attempted: true }
  const loginResult = await loginViaTwitterApi()
  result.success = loginResult.success
  if (!loginResult.success && loginResult.error != null) {
    result.error = loginResult.error
  }
  return result
}

// ── Extract D: Format the POST response ──────────────────

/**
 * Format the response body for a successful POST (setting upsert).
 * Adds key-specific fields: parsed cookie details for x_cookie_string,
 * key count for twitterapi_keys.
 */
export function formatSettingResponse(
  key: string,
  setting: { key: string; updatedAt: Date },
  rawValue: string,
  autoLoginResult: AutoLoginResult | null,
): Record<string, unknown> {
  const base = { setting: { key: setting.key, updatedAt: setting.updatedAt }, autoLogin: autoLoginResult }

  if (key === 'x_cookie_string') {
    const parsed = parseXCookies(rawValue)
    return {
      ...base,
      parsed: {
        auth_token: parsed.auth_token ? parsed.auth_token.slice(0, 8) + '****' : 'NOT FOUND',
        ct0: parsed.ct0 ? parsed.ct0.slice(0, 8) + '****' : 'NOT FOUND',
        twid: parsed.twid ? parsed.twid.slice(0, 8) + '****' : 'NOT FOUND',
      },
    }
  }

  if (key === 'twitterapi_keys') {
    const keys = JSON.parse(rawValue) as string[]
    return { ...base, keyCount: keys.length }
  }

  return base
}
