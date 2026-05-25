// ============================================================
// twitter-api-shared.ts — Shared types, helpers, DB primitives
//
// Common code used by all twitterapi.io modules:
//   - twitter-cookie-api.ts  (Layer 2)
//   - twitter-v2-login.ts    (Layer 3 + login + status)
//   - twitter-api-credits.ts (credits + caching)
//
// No circular deps: this module imports only from @/lib/db, @/lib/encrypt, @/lib/debug.
// None of the domain modules import each other.
// ============================================================

import { db } from '@/lib/db'
import { upsertSetting } from '@/lib/db-helpers'
import { decryptSetting } from '@/lib/encrypt'
import { debug } from '@/lib/debug'

// --- Base URL ---

export const TWITTERAPI_BASE = 'https://api.twitterapi.io'

// --- Login Credential Keys ---

/** Keys required for V2 login via twitterapi.io. Shared by settings/route.ts and getApiSettings(). */
export const LOGIN_CREDENTIAL_KEYS: string[] = [
  'x_username', 'x_email', 'x_password', 'x_totp_secret', 'twitterapi_proxy', 'twitterapi_keys',
]

/** Keys read by the direct-posting path (twitter-post-cookie.ts getSettings). */
export const X_DIRECT_SETTINGS_KEYS: string[] = [
  'x_cookie_string', 'x_query_id', 'x_bearer_token', 'post_method', 'twitterapi_keys', 'x_placeholder_json',
]

// --- Shared Interfaces ---

export interface FallbackResult {
  success: boolean
  tweetId?: string
  error?: string
  method: 'fallback_cookie' | 'fallback_login'
  apiKeyUsed?: string
}

// Re-export KeyCredits from canonical location (@/types) to avoid duplication.
// The UI components import from @/types; the API modules import from here.
export type { KeyCredits } from '@/types'

export interface LoginResult {
  success: boolean
  loginCookie?: string
  error?: string
}

// --- Cookie API Error Classification ---

export type ApiErrorClass = 'login_cookies_invalid' | 'retryable' | 'terminal'

export interface CookieApiPrereqs {
  loginCookies: string
  proxy: string
  apiKeys: string[]
}

// --- Shared Helpers (clone elimination) ---

/**
 * Mask an API key for safe logging/display.
 * Replaces `apiKey.slice(0, 8) + '...'` (7 occurrences in original).
 */
export function maskApiKey(key: string): string {
  return key.slice(0, 8) + '...'
}

/**
 * Mask the password in a proxy URL for safe logging/display.
 * Replaces `proxy.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')` (3 occurrences).
 */
export function maskProxyUrl(proxy: string): string {
  return proxy.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')
}

/**
 * Extract tweet ID from twitterapi.io response data.
 * Tries multiple response formats (data.tweet_id, data.id, nested under data.data).
 * Uses || (not ??) for exact semantic parity with original inline code.
 * Replaces `data?.data?.tweet_id || data?.data?.id || data?.tweet_id || data?.id || null` (3 occurrences).
 */
export function extractTweetId(data: unknown): string | null {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    const inner = d.data as Record<string, unknown> | undefined
    // Use || for exact parity with original (falsy guard, not just nullish).
    // Tweet IDs are non-empty strings, so || and ?? behave identically in practice.
    const val = inner?.tweet_id || inner?.id || d.tweet_id || d.id || null
    return val != null ? String(val) : null
  }
  return null
}

// --- DB Primitives ---

/** Parse twitterapi_keys JSON into a validated string array. */
export function parseApiKeys(rawJson: string | undefined): string[] {
  try {
    const parsed = JSON.parse(rawJson || '[]')
    if (Array.isArray(parsed)) return parsed.filter((k: unknown) => typeof k === 'string' && k.trim())
  } catch { /* invalid JSON */ }
  return []
}

/** Extract the best error message from a twitterapi.io API response. */
export function extractApiError(data: unknown): string {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    return (typeof d.message === 'string' ? d.message : null)
      || (typeof d.msg === 'string' ? d.msg : null)
      || (typeof d.detail === 'string' ? d.detail : null)
      || (typeof d.error === 'string' ? d.error : null)
      || JSON.stringify(data)
  }
  return String(data)
}

/**
 * Batch-read settings from DB into a key→value map.
 * Empty values are filtered out; values are decrypted if ENCRYPTION_KEY is set.
 * Deduplicates the findMany→map→for→decryptSetting pattern used by multiple modules.
 */
export async function readSettingsMap(keys: string[]): Promise<Record<string, string>> {
  const settings = await db.setting.findMany({
    where: {
      key: { in: keys },
      value: { not: '' },
    },
  })
  const map: Record<string, string> = {}
  for (const s of settings) {
    if (s.value) map[s.key] = decryptSetting(s.value, '')
  }
  return map
}

/**
 * Batch-read all twitterapi.io + X login settings from DB.
 * Values are decrypted if ENCRYPTION_KEY is set.
 */
export async function getApiSettings(): Promise<Record<string, string>> {
  return readSettingsMap([
    ...LOGIN_CREDENTIAL_KEYS,
    'twitterapi_login_cookie', 'v2_login_enabled',
    'x_cookie_string',
  ])
}

/**
 * Get the current rotation index for API keys.
 */
export async function getRotationIndex(): Promise<number> {
  const setting = await db.setting.findUnique({
    where: { key: 'twitterapi_key_index' },
  })
  return setting?.value ? parseInt(setting.value, 10) || 0 : 0
}

/**
 * Update the rotation index after using a key.
 */
export async function setRotationIndex(index: number): Promise<void> {
  await upsertSetting('twitterapi_key_index', String(index))
}

/**
 * Convert a semicolon-separated cookie string to a base64-encoded JSON object
 * suitable for twitterapi.io's login_cookies parameter.
 *
 * Input:  "auth_token=abc; ct0=xyz; twid=u=123; kdt=def"
 * Output: base64('{"auth_token":"abc","ct0":"xyz","twid":"u=123","kdt":"def"}')
 *
 * Verified by live test: this format works with create_tweet_v2.
 * Sends ALL cookies (not just the minimum 3) for better session fidelity.
 */
// --- Shared API Call ---

/**
 * Call twitterapi.io's create_tweet_v2 endpoint.
 * Deduplicates the fetch→json→debug block used by Cookie API, V2 Login API, and retry path.
 * Returns the raw Response and parsed JSON data for the caller to inspect.
 */
export async function callCreateTweetV2(
  apiKey: string,
  body: Record<string, string>,
  debugLabel: string
): Promise<{ response: Response; data: unknown }> {
  const response = await fetch(`${TWITTERAPI_BASE}/twitter/create_tweet_v2`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await response.json()
  debug(debugLabel, 'create_tweet_v2 response:', JSON.stringify(data))
  return { response, data }
}

// --- Cookie String Conversion ---

export function cookieStringToLoginCookies(cookieString: string): string | null {
  if (!cookieString || !cookieString.trim()) return null

  const cookies: Record<string, string> = {}
  const pairs = cookieString.split(';')

  for (const pair of pairs) {
    const trimmed = pair.trim()
    if (!trimmed) continue

    const eqIdx = trimmed.indexOf('=')
    if (eqIdx <= 0) continue // skip empty keys or missing '='

    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    if (key && value) {
      cookies[key] = value
    }
  }

  // Minimum auth_token required for base64 conversion. Caller (postViaCookieApi)
  // validates all 3 cookies (auth_token, ct0, twid) before calling this function.
  if (!cookies.auth_token) return null

  return Buffer.from(JSON.stringify(cookies)).toString('base64')
}
