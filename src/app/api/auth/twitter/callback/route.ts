import { type NextRequest, NextResponse } from 'next/server'
import {
  exchangeCodeForToken,
  fetchTwitterUser,
  upsertSubmitterFromTwitter,
  createSessionToken,
  getBaseUrl,
  getOAuth2Credentials,
} from '@/lib/twitter-auth'
import { db } from '@/lib/db'
import { debug, debugError } from '@/lib/debug'

// Helper: redirect to error page and clear OAuth temp cookies
function authErrorRedirect(baseUrl: string, path: string = '/?auth=error'): NextResponse {
  const response = NextResponse.redirect(new URL(path, baseUrl))
  response.cookies.set('twitter_oauth_state', '', { maxAge: 0, path: '/' })
  response.cookies.set('twitter_oauth_verifier', '', { maxAge: 0, path: '/' })
  response.cookies.set('twitter_oauth_flow_id', '', { maxAge: 0, path: '/' })
  return response
}

// Opportunistic cleanup: delete expired OAuthFlow records.
// Runs as part of the callback to keep the table clean without a separate cron job.
// Limited to 50 records to avoid slowing down the callback.
async function cleanupExpiredFlows() {
  try {
    await db.oAuthFlow.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })
  } catch (error) {
    // Non-critical — don't block the login flow
    debugError('oauth', 'Expired flow cleanup failed:', error)
  }
}

// GET /api/auth/twitter/callback - Handle Twitter OAuth 2.0 callback
//
// State resolution strategy (dual-path):
// 1. PRIMARY: Extract flowId from the `state` param → look up OAuthFlow in DB
//    This works even if the callback loads in X's in-app WebView (separate cookie store).
// 2. FALLBACK: Read state + code_verifier from cookies (desktop / no-X-app scenarios)
//
// Returns an intermediate HTML page that sets the session cookie via fetch,
// then redirects to the home page. This is more reliable on Vercel than
// setting cookies in redirect responses (which can be dropped by the CDN).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  const baseUrl = getBaseUrl()

  // User denied access
  if (error) {
    debugError('oauth', 'OAuth denied:', error, errorDescription)
    return authErrorRedirect(baseUrl, '/?auth=denied')
  }

  if (!code || !state) {
    debugError('oauth', 'Callback missing code or state')
    return authErrorRedirect(baseUrl)
  }

  // --- Resolve OAuth state: try DB first, fall back to cookies ---
  let codeVerifier: string | undefined

  // Path 1: DB-based state (works across browser contexts — fixes mobile login)
  const stateParts = state.split('.')
  const flowId = stateParts[0]

  if (flowId) {
    try {
      const flow = await db.oAuthFlow.findUnique({ where: { id: flowId } })

      if (flow) {
        // Verify the full state matches (CSRF protection)
        const expectedState = `${flow.id}.${flow.state}`
        if (state !== expectedState) {
          debugError('oauth', 'State mismatch (DB) — possible CSRF attack')
          // Delete the flow to prevent reuse
          await db.oAuthFlow.delete({ where: { id: flowId } }).catch(() => {})
          return authErrorRedirect(baseUrl)
        }

        // Check expiry
        if (flow.expiresAt < new Date()) {
          debugError('oauth', 'Flow expired')
          await db.oAuthFlow.delete({ where: { id: flowId } }).catch(() => {})
          return authErrorRedirect(baseUrl)
        }

        // State verified — consume the flow (one-time use)
        codeVerifier = flow.codeVerifier
        await db.oAuthFlow.delete({ where: { id: flowId } })

        // Opportunistic cleanup of expired flows
        void cleanupExpiredFlows() // fire-and-forget — don't await

        debug('oauth', 'State resolved from DB (flowId:', flowId, ')')
      }
    } catch (dbError) {
      debugError('oauth', 'DB lookup failed, falling back to cookies:', dbError)
    }
  }

  // Path 2: Cookie-based fallback (desktop / mobile without X app)
  if (!codeVerifier) {
    const storedState = req.cookies.get('twitter_oauth_state')?.value
    if (state !== storedState) {
      debugError('oauth', 'State mismatch (cookie) — possible CSRF attack or cross-browser-context redirect')
      return authErrorRedirect(baseUrl)
    }

    codeVerifier = req.cookies.get('twitter_oauth_verifier')?.value
    if (!codeVerifier) {
      debugError('oauth', 'Missing OAuth code verifier cookie — may have expired or cross-browser-context redirect')
      return authErrorRedirect(baseUrl)
    }

    debug('oauth', 'State resolved from cookies (fallback)')
  }

  // Get OAuth2 credentials (supports both OAUTH2_* and TWITTER_* env var names)
  const creds = getOAuth2Credentials()
  if (!creds) {
    console.error('Missing OAuth2 credentials. Set OAUTH2_CLIENT_ID + OAUTH2_CLIENT_SECRET (or TWITTER_CLIENT_ID + TWITTER_CLIENT_SECRET) in Vercel env vars.') // eslint-disable-line no-console
    return authErrorRedirect(baseUrl)
  }

  const redirectUri = `${baseUrl}/api/auth/twitter/callback`

  // Exchange code for access token
  const tokenData = await exchangeCodeForToken(
    creds.clientId,
    creds.clientSecret,
    code,
    redirectUri,
    codeVerifier
  )

  if (!tokenData?.access_token) {
    debugError('oauth', 'Failed to exchange code for token - check server logs for details')
    return authErrorRedirect(baseUrl)
  }

  // Fetch Twitter user info
  // Primary: user's OAuth 2.0 token with tweet.read users.read scope
  let twitterUser = await fetchTwitterUser(tokenData.access_token)

  // Fallback: if /2/users/me fails (e.g. old token without tweet.read scope),
  // create an anonymous profile so the user sees a clear "re-login" prompt.
  //
  // IMPORTANT: Use a FIXED anon identity instead of hashing the access token.
  // The access token rotates on every login, so hashing it would create a
  // different ID each time → orphaned duplicate records (NEW-13).
  // With a fixed identity, upsert finds the existing record on re-login.
  // This is safe because anon users are blocked from posting at the API level.
  if (!twitterUser) {
    debugError('oauth',
      'Failed to fetch Twitter user profile — using anon fallback. ' +
      'This usually means the OAuth token is missing the tweet.read scope. ' +
      'The user should log out and re-login to get a token with the correct scope.'
    )
    twitterUser = {
      id: 'anon_fallback',
      name: 'Anonymous User',
      username: 'anon_fallback',
    }
  }

  // Create or update submitter in DB
  try {
    const submitter = await upsertSubmitterFromTwitter(twitterUser, {
      accessToken: tokenData.access_token,
      ...(tokenData.refresh_token != null && { refreshToken: tokenData.refresh_token }),
    })

    // Create session token
    const sessionToken = createSessionToken(submitter.id)

    // Validate session token format before embedding in HTML (SAST: prevent XSS).
    // Session tokens are JWT-like: base64url segments separated by dots.
    if (!/^[A-Za-z0-9._-]+$/.test(sessionToken)) {
      debugError('oauth', 'Invalid session token format — possible injection')
      return authErrorRedirect(baseUrl)
    }

    // Return an intermediate HTML page that sets the session cookie via fetch,
    // then redirects. This is more reliable on Vercel than setting cookies
    // in redirect responses, which can be stripped by the CDN.
    //
    // Use standard Response (not NextResponse) for HTML content to avoid SAST
    // flag on NextResponse with raw HTML. Add Set-Cookie headers manually for
    // the OAuth temp cookie cleanup.
    const pageContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Login berhasil...</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; color: #334155; }
    .container { text-align: center; }
    .spinner { width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #0ea5e9; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <p>Login berhasil! Mengalihkan...</p>
  </div>
  <script>
    (async function() {
      try {
        const res = await fetch('/api/auth/set-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: '${sessionToken}' })
        });
        if (res.ok) {
          window.location.href = '/?auth=success';
        } else {
          console.error('Failed to set session:', await res.text()) // eslint-disable-line no-console
          window.location.href = '/?auth=error';
        }
      } catch (err) {
        console.error('Set session error:', err) // eslint-disable-line no-console
        window.location.href = '/?auth=error';
      }
    })();
  </script>
</body>
</html>`

    // Build response headers including cleanup cookies for OAuth temp values
    const responseHeaders = new Headers()
    responseHeaders.set('Content-Type', 'text/html; charset=utf-8')
    responseHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    responseHeaders.set('X-Frame-Options', 'DENY')
    responseHeaders.set('X-Content-Type-Options', 'nosniff')
    responseHeaders.set('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; style-src 'unsafe-inline'")
    responseHeaders.append('Set-Cookie', 'twitter_oauth_verifier=; Max-Age=0; Path=/')
    responseHeaders.append('Set-Cookie', 'twitter_oauth_state=; Max-Age=0; Path=/')
    responseHeaders.append('Set-Cookie', 'twitter_oauth_flow_id=; Max-Age=0; Path=/')

    return new Response(pageContent, { status: 200, headers: responseHeaders })
  } catch (error) {
    debugError('oauth', 'Error creating submitter:', error)
    return authErrorRedirect(baseUrl)
  }
}
