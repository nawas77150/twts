import { NextRequest, NextResponse } from 'next/server'
import {
  exchangeCodeForToken,
  fetchTwitterUser,
  upsertSubmitterFromTwitter,
  createSessionToken,
  getBaseUrl,
  getOAuth2Credentials,
} from '@/lib/twitter-auth'

// Helper: redirect to error page and clear OAuth temp cookies
function authErrorRedirect(baseUrl: string, path: string = '/?auth=error'): NextResponse {
  const response = NextResponse.redirect(new URL(path, baseUrl))
  response.cookies.set('twitter_oauth_state', '', { maxAge: 0, path: '/' })
  response.cookies.set('twitter_oauth_verifier', '', { maxAge: 0, path: '/' })
  return response
}

// GET /api/auth/twitter/callback - Handle Twitter OAuth 2.0 callback
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
    console.warn('OAuth denied:', error, errorDescription)
    return authErrorRedirect(baseUrl, '/?auth=denied')
  }

  if (!code || !state) {
    console.error('OAuth callback missing code or state')
    return authErrorRedirect(baseUrl)
  }

  // Verify state matches (CSRF protection) - use NextRequest cookies API
  const storedState = req.cookies.get('twitter_oauth_state')?.value
  if (state !== storedState) {
    console.error('OAuth state mismatch - possible CSRF attack')
    return authErrorRedirect(baseUrl)
  }

  // Get code verifier from cookie - use NextRequest cookies API
  const codeVerifier = req.cookies.get('twitter_oauth_verifier')?.value
  if (!codeVerifier) {
    console.error('Missing OAuth code verifier cookie - may have expired')
    return authErrorRedirect(baseUrl)
  }

  // Get OAuth2 credentials (supports both OAUTH2_* and TWITTER_* env var names)
  const creds = getOAuth2Credentials()
  if (!creds) {
    console.error('Missing OAuth2 credentials. Set OAUTH2_CLIENT_ID + OAUTH2_CLIENT_SECRET (or TWITTER_CLIENT_ID + TWITTER_CLIENT_SECRET) in Vercel env vars.')
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
    console.error('Failed to exchange code for token - check server logs for details')
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
    console.warn(
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
      refreshToken: tokenData.refresh_token,
    })

    // Create session token
    const sessionToken = createSessionToken(submitter.id)

    // Return an intermediate HTML page that sets the session cookie via fetch,
    // then redirects. This is more reliable on Vercel than setting cookies
    // in redirect responses, which can be stripped by the CDN.
    const html = `<!DOCTYPE html>
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
          console.error('Failed to set session:', await res.text());
          window.location.href = '/?auth=error';
        }
      } catch (err) {
        console.error('Set session error:', err);
        window.location.href = '/?auth=error';
      }
    })();
  </script>
</body>
</html>`

    const response = new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })

    // Clear OAuth temporary cookies
    response.cookies.set('twitter_oauth_verifier', '', { maxAge: 0, path: '/' })
    response.cookies.set('twitter_oauth_state', '', { maxAge: 0, path: '/' })

    return response
  } catch (error) {
    console.error('Error creating submitter:', error)
    return authErrorRedirect(baseUrl)
  }
}
