import { NextRequest, NextResponse } from 'next/server'
import {
  exchangeCodeForToken,
  fetchTwitterUser,
  upsertSubmitterFromTwitter,
  createSessionToken,
  getBaseUrl,
} from '@/lib/twitter-auth'

// GET /api/auth/twitter/callback - Handle Twitter OAuth 2.0 callback
// Returns an intermediate HTML page that sets the session cookie via fetch,
// then redirects to the home page. This is more reliable on Vercel than
// setting cookies in redirect responses (which can be dropped by the CDN).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const baseUrl = getBaseUrl()

  // User denied access
  if (error) {
    return NextResponse.redirect(new URL('/?auth=denied', baseUrl))
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/?auth=error', baseUrl))
  }

  // Verify state matches (CSRF protection) - use NextRequest cookies API
  const storedState = req.cookies.get('twitter_oauth_state')?.value
  if (state !== storedState) {
    console.error('OAuth state mismatch')
    return NextResponse.redirect(new URL('/?auth=error', baseUrl))
  }

  // Get code verifier from cookie - use NextRequest cookies API
  const codeVerifier = req.cookies.get('twitter_oauth_verifier')?.value
  if (!codeVerifier) {
    console.error('Missing OAuth code verifier cookie')
    return NextResponse.redirect(new URL('/?auth=error', baseUrl))
  }

  const clientId = process.env.TWITTER_CLIENT_ID
  const clientSecret = process.env.TWITTER_CLIENT_SECRET // optional - public clients don't need this

  if (!clientId) {
    console.error('Missing TWITTER_CLIENT_ID env var')
    return NextResponse.redirect(new URL('/?auth=error', baseUrl))
  }

  const redirectUri = `${baseUrl}/api/auth/twitter/callback`
  console.log('OAuth callback - baseUrl:', baseUrl, 'redirectUri:', redirectUri)

  // Exchange code for access token
  const tokenData = await exchangeCodeForToken(
    clientId,
    clientSecret,
    code,
    redirectUri,
    codeVerifier
  )

  if (!tokenData?.access_token) {
    console.error('Failed to exchange code for token - check Vercel logs for details')
    return NextResponse.redirect(new URL('/?auth=error', baseUrl))
  }

  // Fetch Twitter user info
  const twitterUser = await fetchTwitterUser(tokenData.access_token)

  if (!twitterUser) {
    console.error('Failed to fetch Twitter user')
    return NextResponse.redirect(new URL('/?auth=error', baseUrl))
  }

  // Create or update submitter in DB
  try {
    const submitter = await upsertSubmitterFromTwitter(twitterUser)

    // Create session token
    const sessionToken = createSessionToken(submitter.id)

    console.log('OAuth success - creating session for user:', twitterUser.username)

    // Return an intermediate HTML page that sets the session cookie via fetch,
    // then redirects. This is more reliable on Vercel than setting cookies
    // in redirect responses, which can be stripped by the CDN.
    const isSecure = process.env.NODE_ENV === 'production'
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
    return NextResponse.redirect(new URL('/?auth=error', baseUrl))
  }
}
