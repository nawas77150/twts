// ============================================================
// twitter-cookie-api.ts — Layer 2: Cookie-based API posting
//
// Converts stored browser cookies → base64(JSON) → login_cookies
// for create_tweet_v2. Cost: 300 credits/tweet ($0.003).
// No login step needed — cookies are already in the DB.
// Proxy is required.
//
// Verified:
// - L2-1: Manual login_cookies = base64(JSON cookie dict) — verified by live test
// - L2-2: auth_token + ct0 + twid is sufficient for manual construction
// - L2-3: Proxy is required for create_tweet_v2 (returns "proxy is required" without it)
// - L2-4: Manual construction works with create_tweet_v2 — tweet_id confirmed
// ============================================================

import { debug } from '@/lib/debug'
import {
  type FallbackResult,
  type CookieApiPrereqs,
  type ApiErrorClass,
  parseApiKeys,
  extractApiError,
  getApiSettings,
  getRotationIndex,
  setRotationIndex,
  cookieStringToLoginCookies,
  callCreateTweetV2,
  maskApiKey,
  maskProxyUrl,
  extractTweetId,
} from './twitter-api-shared'

// --- Cookie API Error Classification ---

/**
 * Classify a Cookie API error into one of 3 classes:
 * - 'login_cookies_invalid': Cookie/session issue — don't retry other keys (same cookies)
 * - 'retryable': Invalid key, rate limit, credits — try next key
 * - 'terminal': All other errors — don't retry
 */
function classifyApiError(errorMsg: string, httpStatus: number): ApiErrorClass {
  // login_cookies invalid — don't retry other keys (same cookies)
  if (
    errorMsg.includes('login_cookies is not valid') ||
    errorMsg.includes('login_cookies is required') ||
    errorMsg.includes('login_cookie is not valid') ||
    errorMsg.includes('login_cookie is required')
  ) {
    return 'login_cookies_invalid'
  }

  // Invalid API key — try next key
  if (
    httpStatus === 401 ||
    errorMsg.includes('API key is invalid') ||
    errorMsg.includes('Unauthorized')
  ) {
    return 'retryable'
  }

  // Rate limit or credit exhaustion — try next key
  if (
    httpStatus === 429 ||
    errorMsg.includes('rate limit') ||
    errorMsg.includes('credits') ||
    errorMsg.includes('quota')
  ) {
    return 'retryable'
  }

  // Other errors — don't retry (proxy issue, etc.)
  return 'terminal'
}

// --- Prerequisites Validation ---

/**
 * Validate all prerequisites for Cookie API posting.
 * Returns the validated prereqs on success, or a FallbackResult error on failure.
 */
function validateCookieApiPrereqs(settings: Record<string, string>): CookieApiPrereqs | FallbackResult {
  // 1. Validate required cookies before converting (specific error messages)
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

  return { loginCookies, proxy, apiKeys }
}

// --- Layer 2: Cookie API Posting ---

/**
 * Post a tweet via twitterapi.io using browser cookies as login_cookies.
 *
 * Converts the stored x_cookie_string (semicolon-separated) to base64(JSON)
 * and uses it directly with create_tweet_v2. No login step needed.
 *
 * Cost: 300 credits/tweet ($0.003).
 * No caching — cookies are read fresh from DB on every call.
 */
export async function postViaCookieApi(text: string): Promise<FallbackResult> {
  const settings = await getApiSettings()

  // Validate prerequisites
  const prereqs = validateCookieApiPrereqs(settings)
  if (!('loginCookies' in prereqs)) return prereqs
  const { loginCookies, proxy, apiKeys } = prereqs

  // Round-robin through API keys
  const startIndex = await getRotationIndex()

  for (let i = 0; i < apiKeys.length; i++) {
    const keyIndex = (startIndex + i) % apiKeys.length
    // eslint-disable-next-line security/detect-object-injection -- integer array index
    const apiKey = apiKeys[keyIndex]

    try {
      const body: Record<string, string> = {
        login_cookies: loginCookies,
        tweet_text: text,
        proxy,
      }

      debug('cookie-api', 'create_tweet_v2 request:', {
        login_cookies: `(${loginCookies.length} chars, base64)`,
        tweet_text: text ? `(${text.length} chars)` : '(missing)',
        proxy: maskProxyUrl(proxy),
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        apiKey: maskApiKey(apiKey!),
      })

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const { response, data } = await callCreateTweetV2(apiKey!, body, 'cookie-api')

      // Success
      const tweetId = extractTweetId(data)
      if (response.ok && tweetId) {
        await setRotationIndex((keyIndex + 1) % apiKeys.length)
        return {
          success: true,
          tweetId,
          method: 'fallback_cookie',
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          apiKeyUsed: maskApiKey(apiKey!),
        }
      }

      // Error handling
      const errorMsg = extractApiError(data)
      debug('cookie-api', 'create_tweet_v2 failed:', errorMsg)

      const errorClass = classifyApiError(errorMsg, response.status)

      if (errorClass === 'login_cookies_invalid') {
        return {
          success: false,
          error: `Cookie API: login_cookies rejected — ${errorMsg}`,
          method: 'fallback_cookie',
        }
      }

      if (errorClass === 'retryable') {
        continue
      }

      // terminal — don't retry
      return {
        success: false,
        error: `Cookie API: ${errorMsg}`,
        method: 'fallback_cookie',
      }
    } catch (error) {
      debug('cookie-api', 'Network error:', error instanceof Error ? error.message : String(error))
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
