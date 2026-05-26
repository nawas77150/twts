// ============================================================
// twitter-v2-login-helpers.ts — Pure-logic helpers for V2 login module
//
// Extracted from twitter-v2-login.ts to reduce cyclomatic complexity.
// No Next.js imports. No DB imports. All functions are pure or
// depend only on twitter-api-shared helpers.
// ============================================================

import { parseApiKeys, maskProxyUrl } from './twitter-api-shared'
import { safeGet } from '@/lib/utils'

// --- Constants ---

/** Fields required for V2 login (subset of LOGIN_CREDENTIAL_KEYS, excludes twitterapi_keys) */
export const V2_LOGIN_FIELDS = ['x_username', 'x_email', 'x_password', 'x_totp_secret', 'twitterapi_proxy']

/** Substrings that indicate a login_cookie error from twitterapi.io */
const LOGIN_COOKIE_ERROR_SUBSTRINGS = [
  'login_cookies is not valid',
  'login_cookies is required',
  'login_cookie is not valid',
  'login_cookie is required',
]

// --- Missing Credentials ---

/** Check which keys are missing (empty/undefined) from a settings map */
export function getMissingCredentialKeys(settings: Record<string, string>, keys: string[]): string[] {
  return keys.filter(k => !safeGet(settings, k))
}

// --- Cookie API Readiness ---

/** Check if Cookie API (Layer 2) is ready and which fields are missing */
export function getCookieApiReadiness(settings: Record<string, string>): {
  ready: boolean
  missing: string[]
} {
  const missing = getMissingCredentialKeys(settings, ['x_cookie_string', 'twitterapi_proxy'])
  if (parseApiKeys(settings.twitterapi_keys).length === 0) missing.push('twitterapi_keys')
  return { ready: missing.length === 0, missing }
}

// --- Login Cookie Error Detection ---

/** Check if an API error message indicates a login_cookie issue */
export function isLoginCookieError(errorMsg: string): boolean {
  return LOGIN_COOKIE_ERROR_SUBSTRINGS.some(s => errorMsg.includes(s))
}

// --- Debug Masking ---

/** Mask sensitive login settings for debug logging */
export function maskLoginSettings(settings: Record<string, string>) {
  return {
    x_username: settings.x_username || '(missing)',
    x_email: settings.x_email ? settings.x_email.slice(0, 3) + '***' : '(missing)',
    x_password: settings.x_password ? `(${settings.x_password.length} chars)` : '(missing)',
    x_totp_secret: settings.x_totp_secret ? `(${settings.x_totp_secret.length} chars)` : '(missing)',
    twitterapi_proxy: settings.twitterapi_proxy ? maskProxyUrl(settings.twitterapi_proxy) : '(missing)',
    twitterapi_keys: settings.twitterapi_keys ? '(present)' : '(missing)',
  }
}
