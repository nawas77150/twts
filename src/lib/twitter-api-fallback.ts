import { db } from '@/lib/db'
import { encrypt, decryptSetting } from '@/lib/encrypt'
import { debug } from '@/lib/debug'

// ============================================================
// TwitterAPI.io posting module — 3-layer architecture
//
// Layer 2: Cookie-based API posting (postViaCookieApi)
//   Converts stored browser cookies → base64(JSON) → login_cookies
//   for create_tweet_v2. Cost: 300 credits/tweet ($0.003).
//   No login step needed — cookies are already in the DB.
//   Proxy is required.
//
// Layer 3: V2 Login API posting (postViaTwitterApi)
//   Uses user_login_v2 → create_tweet_v2 flow:
//   1. Login via user_login_v2 (username + email + password + totp_secret + proxy)
//      → returns login_cookie
//   2. Cache login_cookie in DB (encrypted)
//   3. Post via create_tweet_v2 with cached login_cookie + proxy
//   4. If login_cookie expires → auto re-login → cache → retry
//   Cost: 500 + 300 = 800 credits/tweet ($0.008).
//   Controlled by v2_login_enabled toggle (OFF by default).
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
// - L2-1: Manual login_cookies = base64(JSON cookie dict) — verified by live test
// - L2-2: auth_token + ct0 + twid is sufficient for manual construction
// - L2-3: Proxy is required for create_tweet_v2 (returns "proxy is required" without it)
// - L2-4: Manual construction works with create_tweet_v2 — tweet_id confirmed
//
// Key insight: login_cookies = base64(JSON of cookie key-value pairs).
// The V2 login endpoint generates this from a browser session, but we can
// construct it directly from stored browser cookies — saving 500 credits/tweet.
// ============================================================

const TWITTERAPI_BASE = 'https://api.twitterapi.io'

interface FallbackResult {
  success: boolean
  tweetId?: string
  error?: string
  method: 'fallback_cookie' | 'fallback_login'
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

/** Parse twitterapi_keys JSON into a validated string array. */
function parseApiKeys(rawJson: string | undefined): string[] {
  try {
    const parsed = JSON.parse(rawJson || '[]')
    if (Array.isArray(parsed)) return parsed.filter((k: unknown) => typeof k === 'string' && k.trim())
  } catch { /* invalid JSON */ }
  return []
}

/** Extract the best error message from a twitterapi.io API response. */
function extractApiError(data: unknown): string {
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
          'twitterapi_login_cookie', 'v2_login_enabled',
          'x_cookie_string',
        ],
      },
      value: { not: '' },
    },
  })
  const map: Record<string, string> = {}
  for (const s of settings) {
    if (s.value) map[s.key] = decryptSetting(s.value)
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
 * Convert a semicolon-separated cookie string to a base64-encoded JSON object
 * suitable for twitterapi.io's login_cookies parameter.
 *
 * Input:  "auth_token=abc; ct0=xyz; twid=u=123; kdt=def"
 * Output: base64('{"auth_token":"abc","ct0":"xyz","twid":"u=123","kdt":"def"}')
 *
 * Verified by live test: this format works with create_tweet_v2.
 * Sends ALL cookies (not just the minimum 3) for better session fidelity.
 */
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
  debug('[twitterapi] loginViaTwitterApi settings:', {
    x_username: settings.x_username || '(missing)',
    x_email: settings.x_email ? settings.x_email.slice(0, 3) + '***' : '(missing)',
    x_password: settings.x_password ? `(${settings.x_password.length} chars)` : '(missing)',
    x_totp_secret: settings.x_totp_secret ? `(${settings.x_totp_secret.length} chars)` : '(missing)',
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
    })

    const data = await response.json()
    debug('[twitterapi] user_login_v2 response:', JSON.stringify(data))

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
      error: `Login network error: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * Layer 2: Post a tweet via twitterapi.io using browser cookies as login_cookies.
 *
 * Converts the stored x_cookie_string (semicolon-separated) to base64(JSON)
 * and uses it directly with create_tweet_v2. No login step needed.
 *
 * Cost: 300 credits/tweet ($0.003).
 * No caching — cookies are read fresh from DB on every call.
 */
export async function postViaCookieApi(text: string): Promise<FallbackResult> {
  const settings = await getApiSettings()

  // 1. Validate required cookies before converting (specific error messages)
  // Uses inline .test() checks instead of importing parseXCookies to avoid
  // circular dependency (twitter-post-cookie.ts imports from this file).
  const cookieStr = settings.x_cookie_string || ''
  const missingCookies: string[] = []
  if (!/auth_token=([^;]+)/.test(cookieStr)) missingCookies.push('auth_token')
  if (!/ct0=([^;]+)/.test(cookieStr)) missingCookies.push('ct0')
  if (!/twid=([^;]+)/.test(cookieStr)) missingCookies.push('twid')
  if (missingCookies.length > 0) {
    return {
      success: false,
      error: `Cookie API: Missing ${missingCookies.join(', ')}. Paste full cookie string from browser in X Settings.`,
      method: 'fallback_cookie',
    }
  }
  const loginCookies = cookieStringToLoginCookies(cookieStr)
  if (!loginCookies) {
    return {
      success: false,
      error: 'Cookie API: No browser cookies configured. Paste cookies in X Settings.',
      method: 'fallback_cookie',
    }
  }

  // 2. Proxy is required for create_tweet_v2
  const proxy = settings.twitterapi_proxy
  if (!proxy) {
    return {
      success: false,
      error: 'Cookie API: Proxy is required. Configure in API Settings.',
      method: 'fallback_cookie',
    }
  }

  // 3. Parse API keys
  const apiKeys = parseApiKeys(settings.twitterapi_keys)

  if (apiKeys.length === 0) {
    return {
      success: false,
      error: 'Cookie API: No API keys configured. Add keys in Admin → API Settings.',
      method: 'fallback_cookie',
    }
  }

  // 4. Round-robin through API keys
  const startIndex = await getRotationIndex()

  for (let i = 0; i < apiKeys.length; i++) {
    const keyIndex = (startIndex + i) % apiKeys.length
    const apiKey = apiKeys[keyIndex]

    try {
      const body: Record<string, string> = {
        login_cookies: loginCookies,
        tweet_text: text,
        proxy,
      }

      debug('[cookie-api] create_tweet_v2 request:', {
        login_cookies: `(${loginCookies.length} chars, base64)`,
        tweet_text: text ? `(${text.length} chars)` : '(missing)',
        proxy: proxy.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@'),
        apiKey: apiKey.slice(0, 8) + '...',
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
      debug('[cookie-api] create_tweet_v2 response:', JSON.stringify(data))

      // Success
      const tweetId = data?.data?.tweet_id || data?.data?.id || data?.tweet_id || data?.id || null
      if (response.ok && tweetId) {
        await setRotationIndex((keyIndex + 1) % apiKeys.length)
        return {
          success: true,
          tweetId: String(tweetId),
          method: 'fallback_cookie',
          apiKeyUsed: apiKey.slice(0, 8) + '...',
        }
      }

      // Error handling
      const errorMsg = extractApiError(data)
      debug('[cookie-api] create_tweet_v2 failed:', errorMsg)

      // login_cookies invalid — don't retry other keys (same cookies)
      // This signals the caller to try Layer 3 if available
      if (
        errorMsg.includes('login_cookies is not valid') ||
        errorMsg.includes('login_cookies is required') ||
        errorMsg.includes('login_cookie is not valid') ||
        errorMsg.includes('login_cookie is required')
      ) {
        return {
          success: false,
          error: `Cookie API: login_cookies rejected — ${errorMsg}`,
          method: 'fallback_cookie',
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

      // Other errors — don't retry (proxy issue, etc.)
      return {
        success: false,
        error: `Cookie API: ${errorMsg}`,
        method: 'fallback_cookie',
      }
    } catch (error) {
      debug('[cookie-api] Network error:', error instanceof Error ? error.message : String(error))
      // Network error — try next key
      continue
    }
  }

  return {
    success: false,
    error: 'Cookie API: All API keys exhausted or failed. Add more keys in Admin → API Settings.',
    method: 'fallback_cookie',
  }
}

/**
 * Check if V2 login fallback is enabled.
 * Reads v2_login_enabled from settings (default: false).
 */
export async function isV2LoginEnabled(): Promise<boolean> {
  const settings = await getApiSettings()
  return settings.v2_login_enabled === 'true'
}

/**
 * Layer 3: Post a tweet via twitterapi.io using V2 login flow.
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
  let loginCookie = settings.twitterapi_login_cookie || null

  if (!loginCookie) {
    const loginResult = await loginViaTwitterApi()
    if (!loginResult.success) {
      return {
        success: false,
        error: `No cached login_cookie and auto-login failed: ${loginResult.error}`,
        method: 'fallback_login',
      }
    }
    loginCookie = loginResult.loginCookie!
  }

  const proxy = settings.twitterapi_proxy || null

  // Round-robin through API keys
  const startIndex = await getRotationIndex()
  let lastApiError = '' // Capture the actual error for diagnostics

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

      debug('[twitterapi] create_tweet_v2 request:', {
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
      debug('[twitterapi] create_tweet_v2 response:', JSON.stringify(data))

      // Success — try multiple possible response formats
      const tweetId = data?.data?.tweet_id || data?.data?.id || data?.tweet_id || data?.id || null

      if (response.ok && tweetId) {
        await setRotationIndex((keyIndex + 1) % apiKeys.length)
        return {
          success: true,
          tweetId: String(tweetId),
          method: 'fallback_login',
          apiKeyUsed: apiKey.slice(0, 8) + '...',
        }
      }

      const errorMsg = extractApiError(data)
      lastApiError = `HTTP ${response.status}: ${errorMsg}`
      debug('[twitterapi] create_tweet_v2 failed:', lastApiError)

      // login_cookies expired/invalid → auto re-login and retry ONCE
      // Only match specific login_cookie errors — broad matches like
      // includes('cookie') or includes('session') cause false positives
      // (e.g. "Too many requests in this session") that waste 500 credits
      // on unnecessary re-logins and skip trying other API keys.
      if (
        errorMsg.includes('login_cookies is not valid') ||
        errorMsg.includes('login_cookies is required') ||
        errorMsg.includes('login_cookie is not valid') ||
        errorMsg.includes('login_cookie is required')
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
          debug('[twitterapi] create_tweet_v2 retry response:', JSON.stringify(retryData))

          const retryTweetId = retryData?.data?.tweet_id || retryData?.data?.id || retryData?.tweet_id || retryData?.id || null

          if (retryResponse.ok && retryTweetId) {
            await setRotationIndex((keyIndex + 1) % apiKeys.length)
            return {
              success: true,
              tweetId: String(retryTweetId),
              method: 'fallback_login',
              apiKeyUsed: apiKey.slice(0, 8) + '...',
            }
          }

          // Retry also failed — stop, don't try other keys (same login_cookie issue)
          const retryError = extractApiError(retryData)
          return {
            success: false,
            error: `API fallback failed after re-login: ${retryError}`,
            method: 'fallback_login',
          }
        }

        // Re-login failed
        return {
          success: false,
          error: `API fallback: login_cookie expired and re-login failed: ${loginResult.error}`,
          method: 'fallback_login',
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

      // Other error — try next key (but keep lastApiError for diagnostics)
      continue
    } catch (error) {
      lastApiError = `Network error: ${error instanceof Error ? error.message : String(error)}`
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

  const keys = parseApiKeys(settings.twitterapi_keys)

  if (keys.length === 0) return []

  return Promise.all(keys.map((key) => getKeyCredits(key)))
}

// ── In-memory cache for API credits ──
// Credits change slowly (only when tweets are posted), so caching for 5 minutes
// avoids N external HTTP calls to twitterapi.io on every dashboard load.
// On Vercel, this cache resets on cold starts — acceptable tradeoff.
let creditsCache: KeyCredits[] | null = null
let creditsCacheTime: number = 0
const CREDITS_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Returns cached credits immediately (or null if cache is empty/stale).
 * Kicks off a background fetch to populate the cache for the next request.
 * Use this in hot paths where you don't want to block on external API calls.
 */
export function getApiCreditsNonBlocking(): KeyCredits[] | null {
  const now = Date.now()
  if (creditsCache && now - creditsCacheTime < CREDITS_CACHE_TTL) {
    return creditsCache // Cache is fresh — return immediately
  }
  // Cache is stale or empty — fire background fetch for next request
  void getAllKeyCredits().then((fresh) => {
    creditsCache = fresh
    creditsCacheTime = Date.now()
  }).catch(() => {
    // External API failed — keep whatever cache we have (or null)
  })
  return creditsCache // Return stale cache or null — don't block
}

/**
 * Cached version of getAllKeyCredits().
 * Returns cached results if fresh (<5 min), otherwise fetches new data.
 * This is the function admin stats should use to avoid hammering the external API.
 */
export async function getCachedApiCredits(): Promise<KeyCredits[]> {
  const now = Date.now()
  if (creditsCache && now - creditsCacheTime < CREDITS_CACHE_TTL) {
    return creditsCache
  }
  const fresh = await getAllKeyCredits()
  creditsCache = fresh
  creditsCacheTime = now
  return fresh
}

/**
 * Invalidate the credits cache.
 * Call this after posting a tweet (credits decrease) or after saving new API keys.
 */
export function invalidateCreditsCache(): void {
  creditsCache = null
  creditsCacheTime = 0
}

/**
 * Get API login status for the admin dashboard.
 * Returns whether a login_cookie is cached, whether all V2 credentials are present,
 * and whether the cookie-based API is ready.
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

  // Cookie API readiness (Layer 2)
  const hasCookieString = !!settings.x_cookie_string
  const hasProxy = !!settings.twitterapi_proxy
  const apiKeys = parseApiKeys(settings.twitterapi_keys)
  const hasApiKeys = apiKeys.length > 0
  const cookieApiReady = hasCookieString && hasProxy && hasApiKeys
  const cookieApiMissing: string[] = []
  if (!hasCookieString) cookieApiMissing.push('x_cookie_string')
  if (!hasProxy) cookieApiMissing.push('twitterapi_proxy')
  if (!hasApiKeys) cookieApiMissing.push('twitterapi_keys')

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
