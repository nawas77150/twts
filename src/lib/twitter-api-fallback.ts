import { db } from '@/lib/db'
import { encrypt, decrypt, isEncrypted } from '@/lib/encrypt'

// ============================================================
// TwitterAPI.io fallback posting module (V2 API)
//
// Uses user_login_v2 → create_tweet_v2 flow:
// 1. Login via user_login_v2 (username + email + password + totp_secret + proxy)
//    → returns opaque login_cookie (NOT browser cookies)
// 2. Cache login_cookie in DB (encrypted)
// 3. Post via create_tweet_v2 with cached login_cookie + proxy
// 4. If login_cookie expires → auto re-login → cache → retry
//
// Verified:
// - V6:  API key validation works
// - V7:  create_tweet_v2 endpoint exists
// - V9:  300 credits/tweet ($0.003)
// - V10: 10k free credits on registration
// - V12: /oapi/my/info is free
// - V20: user_login_v2 returns login_cookie
// - V22: Browser cookies do NOT work as login_cookies (U1 DISPROVED)
// - V23: login_cookie from user_login_v2 is an opaque string, not browser cookie format
// - V24: login_cookie stays valid indefinitely (per twitterapi.io docs)
// - V25: Proxy is REQUIRED for user_login_v2, recommended for create_tweet_v2
// - V26: user_login_v2 costs 500 credits ($0.005) per call
//
// Key insight: login_cookies ≠ browser cookies.
// login_cookies is a server-generated opaque token from user_login_v2.
// Browser cookies (auth_token, ct0) are completely incompatible.
// ============================================================

const TWITTERAPI_BASE = 'https://api.twitterapi.io'

interface FallbackResult {
  success: boolean
  tweetId?: string
  error?: string
  method: 'fallback'
  apiKeyUsed?: string
}

interface KeyCredits {
  apiKey: string
  rechargeCredits: number
  bonusCredits: number
  totalCredits: number
  error?: string
}

interface LoginResult {
  success: boolean
  loginCookie?: string
  error?: string
}

/**
 * Decrypt a setting value if encrypted, return as-is if plaintext.
 * Handles migration from unencrypted to encrypted values.
 */
function decryptValue(value: string): string {
  if (!value) return value
  try {
    return isEncrypted(value) ? decrypt(value) : value
  } catch {
    // If decryption fails, return as-is (might be plaintext from before encryption)
    return value
  }
}

/**
 * Batch-read all twitterapi.io + X login settings from DB.
 * Values are decrypted if ENCRYPTION_KEY is set.
 */
async function getApiSettings(): Promise<Record<string, string>> {
  const settings = await db.setting.findMany({
    where: {
      key: {
        in: [
          'twitterapi_keys', 'twitterapi_proxy',
          'x_username', 'x_email', 'x_password', 'x_totp_secret',
          'twitterapi_login_cookie',
        ],
      },
      value: { not: '' },
    },
  })
  const map: Record<string, string> = {}
  for (const s of settings) {
    if (s.value) map[s.key] = decryptValue(s.value)
  }
  return map
}

/**
 * Get the current rotation index for API keys.
 */
async function getRotationIndex(): Promise<number> {
  const setting = await db.setting.findUnique({
    where: { key: 'twitterapi_key_index' },
  })
  return setting?.value ? parseInt(setting.value, 10) || 0 : 0
}

/**
 * Update the rotation index after using a key.
 */
async function setRotationIndex(index: number): Promise<void> {
  await db.setting.upsert({
    where: { key: 'twitterapi_key_index' },
    update: { value: String(index) },
    create: { key: 'twitterapi_key_index', value: String(index) },
  })
}

/**
 * Cache a login_cookie in DB (encrypted).
 */
async function cacheLoginCookie(loginCookie: string): Promise<void> {
  const encrypted = encrypt(loginCookie)
  await db.setting.upsert({
    where: { key: 'twitterapi_login_cookie' },
    update: { value: encrypted },
    create: { key: 'twitterapi_login_cookie', value: encrypted },
  })
}

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
  console.log('[twitterapi] loginViaTwitterApi settings:', {
    x_username: settings.x_username || '(missing)',
    x_email: settings.x_email ? settings.x_email.slice(0, 3) + '***' : '(missing)',
    x_password: settings.x_password ? `(${settings.x_password.length} chars)` : '(missing)',
    x_totp_secret: settings.x_totp_secret ? `(${settings.x_totp_secret.length} chars, starts: ${settings.x_totp_secret.slice(0, 4)})` : '(missing)',
    twitterapi_proxy: settings.twitterapi_proxy ? settings.twitterapi_proxy.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@') : '(missing)',
    twitterapi_keys: settings.twitterapi_keys ? '(present)' : '(missing)',
  })

  // Validate all required fields
  const missing: string[] = []
  if (!settings.x_username) missing.push('x_username')
  if (!settings.x_email) missing.push('x_email')
  if (!settings.x_password) missing.push('x_password')
  if (!settings.x_totp_secret) missing.push('x_totp_secret')
  if (!settings.twitterapi_proxy) missing.push('twitterapi_proxy')

  if (missing.length > 0) {
    return {
      success: false,
      error: `API login requires: ${missing.join(', ')}. Configure in Admin → API Settings.`,
    }
  }

  // Get first API key
  let apiKeys: string[] = []
  try {
    const parsed = JSON.parse(settings.twitterapi_keys || '[]')
    if (Array.isArray(parsed)) apiKeys = parsed.filter((k: unknown) => typeof k === 'string' && k.trim())
  } catch {
    // invalid JSON
  }

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
    })

    const data = await response.json()
    console.log('[twitterapi] user_login_v2 response:', JSON.stringify(data))

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

    const errorMsg = data?.msg || data?.detail || data?.error || data?.message || JSON.stringify(data)
    return {
      success: false,
      error: `user_login_v2 failed: ${errorMsg}`,
    }
  } catch (error) {
    return {
      success: false,
      error: `Login network error: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * Post a tweet via twitterapi.io create_tweet_v2.
 *
 * Flow:
 * 1. Read cached login_cookie from DB
 * 2. If no login_cookie → auto-login via user_login_v2
 * 3. Call create_tweet_v2 with login_cookie + proxy
 * 4. If login_cookie is invalid → auto re-login → retry
 */
export async function postViaTwitterApi(text: string): Promise<FallbackResult> {
  const settings = await getApiSettings()

  // Parse API keys
  let apiKeys: string[] = []
  try {
    const parsed = JSON.parse(settings.twitterapi_keys || '[]')
    if (Array.isArray(parsed)) apiKeys = parsed.filter((k: unknown) => typeof k === 'string' && k.trim())
  } catch {
    // invalid JSON
  }

  if (apiKeys.length === 0) {
    return {
      success: false,
      error: 'TwitterAPI.io fallback not configured. Add API keys in Admin → API Settings.',
      method: 'fallback',
    }
  }

  // Get or generate login_cookie
  let loginCookie = settings.twitterapi_login_cookie || null

  if (!loginCookie) {
    const loginResult = await loginViaTwitterApi()
    if (!loginResult.success) {
      return {
        success: false,
        error: `No cached login_cookie and auto-login failed: ${loginResult.error}`,
        method: 'fallback',
      }
    }
    loginCookie = loginResult.loginCookie!
  }

  const proxy = settings.twitterapi_proxy || null

  // Round-robin through API keys
  const startIndex = await getRotationIndex()

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

      console.log('[twitterapi] create_tweet_v2 request:', {
        login_cookies: loginCookie ? `(${loginCookie.length} chars)` : '(missing)',
        tweet_text: text ? `(${text.length} chars)` : '(missing)',
        proxy: proxy ? proxy.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@') : '(missing)',
      })

      const response = await fetch(`${TWITTERAPI_BASE}/twitter/create_tweet_v2`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      const data = await response.json()
      console.log('[twitterapi] create_tweet_v2 response:', JSON.stringify(data))

      // Success — try multiple possible response formats
      const tweetId = data?.data?.tweet_id || data?.data?.id || data?.tweet_id || data?.id || null

      if (response.ok && tweetId) {
        await setRotationIndex((keyIndex + 1) % apiKeys.length)
        return {
          success: true,
          tweetId: String(tweetId),
          method: 'fallback',
          apiKeyUsed: apiKey.slice(0, 8) + '...',
        }
      }

      const errorMsg = data?.detail || data?.error || data?.message || data?.msg || JSON.stringify(data)

      // login_cookies expired/invalid → auto re-login and retry ONCE
      if (
        errorMsg.includes('login_cookies is not valid') ||
        errorMsg.includes('login_cookies is required') ||
        errorMsg.includes('cookie') ||
        errorMsg.includes('session')
      ) {
        // Only re-login once to avoid infinite loops
        const loginResult = await loginViaTwitterApi()
        if (loginResult.success) {
          loginCookie = loginResult.loginCookie!
          // Retry with new login_cookie using same API key
          const retryBody: Record<string, string> = {
            login_cookies: loginCookie,
            tweet_text: text,
          }
          if (proxy) retryBody.proxy = proxy

          const retryResponse = await fetch(`${TWITTERAPI_BASE}/twitter/create_tweet_v2`, {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(retryBody),
          })

          const retryData = await retryResponse.json()
          console.log('[twitterapi] create_tweet_v2 retry response:', JSON.stringify(retryData))

          const retryTweetId = retryData?.data?.tweet_id || retryData?.data?.id || retryData?.tweet_id || retryData?.id || null

          if (retryResponse.ok && retryTweetId) {
            await setRotationIndex((keyIndex + 1) % apiKeys.length)
            return {
              success: true,
              tweetId: String(retryTweetId),
              method: 'fallback',
              apiKeyUsed: apiKey.slice(0, 8) + '...',
            }
          }

          // Retry also failed — stop, don't try other keys (same login_cookie issue)
          const retryError = retryData?.detail || retryData?.error || retryData?.message || JSON.stringify(retryData)
          return {
            success: false,
            error: `API fallback failed after re-login: ${retryError}`,
            method: 'fallback',
          }
        }

        // Re-login failed
        return {
          success: false,
          error: `API fallback: login_cookie expired and re-login failed: ${loginResult.error}`,
          method: 'fallback',
        }
      }

      // Invalid API key — try next key
      if (
        response.status === 401 ||
        errorMsg.includes('API key is invalid') ||
        errorMsg.includes('Unauthorized')
      ) {
        continue
      }

      // Rate limit or credit exhaustion — try next key
      if (
        response.status === 429 ||
        errorMsg.includes('rate limit') ||
        errorMsg.includes('credits') ||
        errorMsg.includes('quota')
      ) {
        continue
      }

      // Other error — try next key
      continue
    } catch (error) {
      // Network error — try next key
      continue
    }
  }

  return {
    success: false,
    error: `API fallback: semua ${apiKeys.length} key gagal atau habis credits. Tambahkan key baru di Admin → API Settings.`,
    method: 'fallback',
  }
}

/**
 * Fetch credit info for a single API key.
 * Uses /oapi/my/info — this endpoint is FREE (V12: doesn't consume credits).
 */
export async function getKeyCredits(apiKey: string): Promise<KeyCredits> {
  try {
    const response = await fetch(`${TWITTERAPI_BASE}/oapi/my/info`, {
      headers: { 'x-api-key': apiKey },
    })

    if (!response.ok) {
      return {
        apiKey: apiKey.slice(0, 8) + '...',
        rechargeCredits: 0,
        bonusCredits: 0,
        totalCredits: 0,
        error: `HTTP ${response.status}`,
      }
    }

    const data = await response.json()
    return {
      apiKey: apiKey.slice(0, 8) + '...',
      rechargeCredits: data.recharge_credits || 0,
      bonusCredits: data.total_bonus_credits || 0,
      totalCredits: (data.recharge_credits || 0) + (data.total_bonus_credits || 0),
    }
  } catch (error) {
    return {
      apiKey: apiKey.slice(0, 8) + '...',
      rechargeCredits: 0,
      bonusCredits: 0,
      totalCredits: 0,
      error: error instanceof Error ? error.message : 'Network error',
    }
  }
}

/**
 * Fetch credit info for all configured API keys.
 * Used by admin dashboard to show credit status.
 */
export async function getAllKeyCredits(): Promise<KeyCredits[]> {
  const settings = await getApiSettings()

  let keys: string[] = []
  try {
    const parsed = JSON.parse(settings.twitterapi_keys || '[]')
    if (Array.isArray(parsed)) keys = parsed.filter((k: unknown) => typeof k === 'string' && k.trim())
  } catch {
    // invalid JSON
  }

  if (keys.length === 0) return []

  return Promise.all(keys.map((key) => getKeyCredits(key)))
}

/**
 * Get API login status for the admin dashboard.
 * Returns whether a login_cookie is cached and whether all credentials are present.
 */
export async function getApiLoginStatus(): Promise<{
  hasLoginCookie: boolean
  lastLoginAt: Date | null
  hasCredentials: boolean
  missingCredentials: string[]
}> {
  const settings = await getApiSettings()

  const hasLoginCookie = !!settings.twitterapi_login_cookie
  const hasCredentials = !!(
    settings.x_username &&
    settings.x_email &&
    settings.x_password &&
    settings.x_totp_secret &&
    settings.twitterapi_proxy &&
    settings.twitterapi_keys
  )

  const missingCredentials: string[] = []
  if (!settings.x_username) missingCredentials.push('x_username')
  if (!settings.x_email) missingCredentials.push('x_email')
  if (!settings.x_password) missingCredentials.push('x_password')
  if (!settings.x_totp_secret) missingCredentials.push('x_totp_secret')
  if (!settings.twitterapi_proxy) missingCredentials.push('twitterapi_proxy')
  if (!settings.twitterapi_keys) missingCredentials.push('twitterapi_keys')

  // Get last login time from the setting's updatedAt
  let lastLoginAt: Date | null = null
  if (hasLoginCookie) {
    const setting = await db.setting.findUnique({
      where: { key: 'twitterapi_login_cookie' },
      select: { updatedAt: true },
    })
    lastLoginAt = setting?.updatedAt ?? null
  }

  return { hasLoginCookie, lastLoginAt, hasCredentials, missingCredentials }
}
