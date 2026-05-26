// ============================================================
// twitter-v2-login.ts — Layer 3: V2 Login API posting + login + status
//
// V2 Login API posting (postViaTwitterApi):
//   Uses user_login_v2 → create_tweet_v2 flow:
//   1. Login via user_login_v2 (username + email + password + totp_secret + proxy)
//      → returns login_cookie
//   2. Cache login_cookie in DB (encrypted)
//   3. Post via create_tweet_v2 with cached login_cookie + proxy
//   4. If login_cookie expires → auto re-login → cache → retry
//   Cost: 500 + 300 = 800 credits/tweet ($0.008).
//   Controlled by v2_login_enabled toggle (OFF by default).
//
// Also includes:
//   - loginViaTwitterApi() — standalone login function (used by settings/route auto-login)
//   - isV2LoginEnabled() — toggle check
//   - getApiLoginStatus() — admin dashboard status (straddles both cookie + V2)
//
// Verified:
// - V6:  API key validation works
// - V7:  create_tweet_v2 endpoint exists
// - V9:  300 credits/tweet ($0.003)
// - V10: 10k free credits on registration
// - V12: /oapi/my/info is free
// - V20: user_login_v2 returns login_cookie
// - V22: Browser cookies as raw string do NOT work as login_cookies (U1 DISPROVED)
// - V23: login_cookie from user_login_v2 is an opaque string, not browser cookie format
// - V24: login_cookie stays valid indefinitely (per twitterapi.io docs)
// - V25: Proxy is REQUIRED for user_login_v2, required for create_tweet_v2
// - V26: user_login_v2 costs 500 credits ($0.005) per call
// ============================================================

import { db } from '@/lib/db'
import { upsertSetting } from '@/lib/db-helpers'
import { getErrorMessage } from '@/lib/utils'
import { encrypt } from '@/lib/encrypt'
import { debug } from '@/lib/debug'
import {
  TWITTERAPI_BASE,
  FallbackResult,
  LoginResult,
  parseApiKeys,
  extractApiError,
  getApiSettings,
  getRotationIndex,
  setRotationIndex,
  callCreateTweetV2,
  maskApiKey,
  maskProxyUrl,
  extractTweetId,
  LOGIN_CREDENTIAL_KEYS,
} from './twitter-api-shared'
import {
  V2_LOGIN_FIELDS,
  getMissingCredentialKeys,
  getCookieApiReadiness,
  isLoginCookieError,
  maskLoginSettings,
} from './twitter-v2-login-helpers'

// --- Login Cookie Caching ---

/**
 * Cache a login_cookie in DB (encrypted).
 * Only called by loginViaTwitterApi — lives here (not in shared) because
 * it has exactly one consumer.
 */
async function cacheLoginCookie(loginCookie: string): Promise<void> {
  const encrypted = encrypt(loginCookie)
  await upsertSetting('twitterapi_login_cookie', encrypted)
}

// --- Login ---

/**
 * Log in to X via twitterapi.io user_login_v2.
 *
 * This generates an opaque login_cookie that is used for create_tweet_v2.
 * Requires: x_username, x_email, x_password, x_totp_secret, twitterapi_proxy, and at least one API key.
 *
 * Cost: 500 credits ($0.005) per call.
 * login_cookie stays valid indefinitely — only re-login when it expires.
 */
export async function loginViaTwitterApi(): Promise<LoginResult> {
  const settings = await getApiSettings()

  // Debug: log what we're sending (mask sensitive values)
  debug('twitterapi', 'loginViaTwitterApi settings:', maskLoginSettings(settings))

  // Validate all required fields
  const missing = getMissingCredentialKeys(settings, V2_LOGIN_FIELDS)

  if (missing.length > 0) {
    return {
      success: false,
      error: `API login requires: ${missing.join(', ')}. Configure in Admin → API Settings.`,
    }
  }

  // Get first API key
  const apiKeys = parseApiKeys(settings.twitterapi_keys)

  if (apiKeys.length === 0) {
    return {
      success: false,
      error: 'No twitterapi.io API keys configured. Add keys in Admin → API Settings.',
    }
  }

  const apiKey = apiKeys[0]

  try {
    const response = await fetch(`${TWITTERAPI_BASE}/twitter/user_login_v2`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_name: settings.x_username,
        email: settings.x_email,
        password: settings.x_password,
        totp_secret: settings.x_totp_secret,
        proxy: settings.twitterapi_proxy,
      }),
      signal: AbortSignal.timeout(15_000),
    })

    const data = await response.json()
    debug('twitterapi', 'user_login_v2 response:', JSON.stringify(data))

    if (response.ok && (data?.login_cookie || data?.login_cookies)) {
      // API returns "login_cookies" (plural) despite docs saying "login_cookie"
      const loginCookie = data?.login_cookie || data?.login_cookies
      await cacheLoginCookie(loginCookie)
      return { success: true, loginCookie }
    }

    // Login succeeded but no login_cookie returned
    // Per docs: "We highly recommend enabling 2FA — otherwise the login_cookie may be faulty"
    // Also: "residential proxies" recommended for cookie validity
    if (response.ok) {
      return {
        success: false,
        error: `user_login_v2 returned success but no login_cookie in response. Response: ${JSON.stringify(data)}. Possible causes: (1) Proxy issue — use a residential proxy in the same region as your X account, (2) 2FA misconfigured — verify totp_secret matches your X account's authentication app secret.`,
      }
    }

    const errorMsg = extractApiError(data)
    return {
      success: false,
      error: `user_login_v2 failed: ${errorMsg}`,
    }
  } catch (error) {
    return {
      success: false,
      error: `Login network error: ${getErrorMessage(error)}`,
    }
  }
}

// --- V2 Login Toggle ---

/**
 * Check if V2 login fallback is enabled.
 * Reads v2_login_enabled from settings (default: false).
 */
export async function isV2LoginEnabled(): Promise<boolean> {
  const settings = await getApiSettings()
  return settings.v2_login_enabled === 'true'
}

// --- V2 Login API Helpers ---

/**
 * Get or generate a login_cookie for V2 API posting.
 * Returns the login_cookie string on success, or a FallbackResult error on failure.
 */
async function ensureLoginCookie(settings: Record<string, string>): Promise<string | FallbackResult> {
  const loginCookie = settings.twitterapi_login_cookie || null

  if (loginCookie) return loginCookie

  const loginResult = await loginViaTwitterApi()
  if (!loginResult.success) {
    return {
      success: false,
      error: `No cached login_cookie and auto-login failed: ${loginResult.error}`,
      method: 'fallback_login',
    }
  }
  if (!loginResult.loginCookie) {
    return { success: false, error: 'Auto-login succeeded but login_cookie was missing from response', method: 'fallback_login' as const }
  }
  return loginResult.loginCookie
}

// --- Layer 3: V2 Login API Posting ---

/**
 * Post a tweet via twitterapi.io using V2 login flow.
 *
 * Flow:
 * 1. Read cached login_cookie from DB
 * 2. If no login_cookie → auto-login via user_login_v2
 * 3. Call create_tweet_v2 with login_cookie + proxy
 * 4. If login_cookie is invalid → auto re-login → retry
 *
 * Cost: 800 credits/tweet ($0.008) — 500 login + 300 post.
 * Only used when v2_login_enabled is true.
 */
export async function postViaTwitterApi(text: string): Promise<FallbackResult> {
  const settings = await getApiSettings()

  // Parse API keys
  const apiKeys = parseApiKeys(settings.twitterapi_keys)

  if (apiKeys.length === 0) {
    return {
      success: false,
      error: 'V2 Login API: No API keys configured. Add keys in Admin → API Settings.',
      method: 'fallback_login',
    }
  }

  // Get or generate login_cookie
  const loginCookieResult = await ensureLoginCookie(settings)
  if (typeof loginCookieResult !== 'string') return loginCookieResult
  let loginCookie = loginCookieResult

  const proxy = settings.twitterapi_proxy || null

  // Round-robin through API keys
  const startIndex = await getRotationIndex()
  let lastApiError = '' // Capture the actual error for diagnostics
  let didReLogin = false // Gate: only re-login once per call to avoid credit waste

  for (let i = 0; i < apiKeys.length; i++) {
    const keyIndex = (startIndex + i) % apiKeys.length
    const apiKey = apiKeys[keyIndex]

    try {
      const body: Record<string, string> = {
        login_cookies: loginCookie,
        tweet_text: text,
      }
      if (proxy) {
        body.proxy = proxy
      }

      debug('twitterapi', 'create_tweet_v2 request:', {
        login_cookies: loginCookie ? `(${loginCookie.length} chars)` : '(missing)',
        tweet_text: text ? `(${text.length} chars)` : '(missing)',
        proxy: proxy ? maskProxyUrl(proxy) : '(missing)',
      })

      const { response, data } = await callCreateTweetV2(apiKey, body, 'twitterapi')

      // Success — try multiple possible response formats
      const tweetId = extractTweetId(data)

      if (response.ok && tweetId) {
        await setRotationIndex((keyIndex + 1) % apiKeys.length)
        return {
          success: true,
          tweetId,
          method: 'fallback_login',
          apiKeyUsed: maskApiKey(apiKey),
        }
      }

      const errorMsg = extractApiError(data)
      lastApiError = `HTTP ${response.status}: ${errorMsg}`
      debug('twitterapi', 'create_tweet_v2 failed:', lastApiError)

      // login_cookies expired/invalid → re-login, update cookie, continue key rotation
      // Only match specific login_cookie errors — broad matches cause false positives
      if (isLoginCookieError(errorMsg) && !didReLogin) {
        const loginResult = await loginViaTwitterApi()
        didReLogin = true
        if (!loginResult.success || !loginResult.loginCookie) {
          return {
            success: false,
            error: `API fallback: login_cookie expired and re-login failed: ${loginResult.error || 'no login_cookie in response'}`,
            method: 'fallback_login',
          }
        }
        loginCookie = loginResult.loginCookie
        continue
      }

      // All other errors (invalid key, rate limit, etc.) — try next key
      continue
    } catch (error) {
      lastApiError = `Network error: ${getErrorMessage(error)}`
      // Network error — try next key
      continue
    }
  }

  return {
    success: false,
    error: lastApiError
      ? `API fallback gagal (${apiKeys.length} key): ${lastApiError}`
      : `API fallback: semua ${apiKeys.length} key gagal atau habis credits. Tambahkan key baru di Admin → API Settings.`,
    method: 'fallback_login',
  }
}

// --- API Login Status ---

/**
 * Get API login status for the admin dashboard.
 * Returns whether a login_cookie is cached, whether all V2 credentials are present,
 * and whether the cookie-based API is ready.
 *
 * Lives in v2-login because its heaviest logic is the V2 credential validation
 * (6 missing fields check + upsert for lastLoginAt). Cookie-API readiness is
 * a secondary concern that doesn't warrant importing from twitter-cookie-api.
 */
export async function getApiLoginStatus(): Promise<{
  hasLoginCookie: boolean
  lastLoginAt: Date | null
  hasCredentials: boolean
  missingCredentials: string[]
  v2LoginEnabled: boolean
  cookieApiReady: boolean
  cookieApiMissing: string[]
}> {
  const settings = await getApiSettings()

  const hasLoginCookie = !!settings.twitterapi_login_cookie
  const missingCredentials = getMissingCredentialKeys(settings, LOGIN_CREDENTIAL_KEYS)
  const hasCredentials = missingCredentials.length === 0

  // Cookie API readiness (Layer 2)
  const { ready: cookieApiReady, missing: cookieApiMissing } = getCookieApiReadiness(settings)

  // V2 login toggle
  const v2LoginEnabled = settings.v2_login_enabled === 'true'

  // Get last login time from the setting's updatedAt
  let lastLoginAt: Date | null = null
  if (hasLoginCookie) {
    const setting = await db.setting.findUnique({
      where: { key: 'twitterapi_login_cookie' },
      select: { updatedAt: true },
    })
    lastLoginAt = setting?.updatedAt ?? null
  }

  return { hasLoginCookie, lastLoginAt, hasCredentials, missingCredentials, v2LoginEnabled, cookieApiReady, cookieApiMissing }
}
