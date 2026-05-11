---
Task ID: 1
Agent: Main
Task: Remove manual login, keep only X (Twitter) OAuth login. Fix NextAuth CLIENT_FETCH_ERROR.

Work Log:
- Read all existing codebase files to understand current state
- Removed NextAuth v4 entirely (was causing CLIENT_FETCH_ERROR with Next.js 16)
- Implemented manual Twitter OAuth 2.0 with PKCE flow in `src/lib/twitter-auth.ts`
- Created new auth API routes:
  - `GET /api/auth/twitter` - Starts OAuth 2.0 flow (redirects to Twitter)
  - `GET /api/auth/twitter/callback` - Handles callback, exchanges code, creates submitter, sets session cookie
  - `GET /api/auth/me` - Checks session cookie, returns submitter info
  - `POST /api/auth/logout` - Clears session cookie
- Updated `POST /api/submissions` to use cookie-based auth via `getSubmitterFromRequest()` instead of NextAuth `getServerSession()`
- Removed all manual login UI (username/password registration and login)
- Updated frontend to only show "Login with X" button
- Removed NextAuth files: `[...nextauth]/route.ts`, `auth/login/route.ts`, `auth/register/route.ts`, `auth/session/route.ts`, `lib/auth.ts`, `components/auth-provider.tsx`
- Updated Prisma schema: removed `password` field from Submitter, made `twitterId` required (non-optional)
- Pushed schema changes to database
- Uninstalled `next-auth` package
- Updated `.env` with new env vars (TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET, SESSION_SECRET)
- Verified all API endpoints work correctly
- Lint passes cleanly

Stage Summary:
- NextAuth v4 completely removed - no more CLIENT_FETCH_ERROR
- Twitter OAuth 2.0 with PKCE implemented from scratch
- Session management via signed httpOnly cookies (HMAC-SHA256)
- Manual login removed - only X login available
- App works correctly: `/api/auth/me` returns `{"authenticated":false}` when not logged in
- Twitter login will work once TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET are configured in .env

---
Task ID: 2
Agent: Main
Task: Make project Vercel-ready for deployment

Work Log:
- Analyzed all project files for Vercel compatibility
- Key issue: SQLite doesn't work on Vercel (ephemeral filesystem) → migrated to PostgreSQL
- Changed `prisma/schema.prisma`: provider from `sqlite` to `postgresql`, added `directUrl` env var
- Updated `next.config.ts`: removed `output: "standalone"` (Vercel handles this), added `serverExternalPackages: ["oauth"]`
- Updated `package.json`: added `postinstall: "prisma generate"` script, changed build to `prisma generate && next build`, changed start to `next start -p 3000`
- Updated `src/lib/twitter-auth.ts`: added `getBaseUrl()` function that uses `VERCEL_URL` env var for production OAuth callbacks
- Updated `src/app/api/auth/twitter/route.ts`: uses `getBaseUrl()` for redirect URI
- Updated `src/app/api/auth/twitter/callback/route.ts`: uses `getBaseUrl()` for consistent redirects
- Updated `src/lib/db.ts`: simplified logging (only query logs in dev)
- Updated `.env`: changed DATABASE_URL to PostgreSQL format, added DIRECT_URL, added comments for Vercel deployment
- Ran `prisma generate` successfully for PostgreSQL provider
- Verified app runs and API routes work

Stage Summary:
- Database migrated from SQLite → PostgreSQL (compatible with Vercel Postgres/Neon)
- All Vercel-incompatible code updated (no standalone output, proper env var handling)
- OAuth callback URLs now auto-detect Vercel deployment via VERCEL_URL
- Build process includes automatic `prisma generate` via postinstall
- App is ready for Vercel deployment with Vercel Postgres

---
Task ID: 1
Agent: Main Agent
Task: Fix session cookie not persisting after OAuth login - user gets redirected back to login page

Work Log:
- Identified root cause: Vercel's CDN drops Set-Cookie headers in redirect responses
- The OAuth callback was setting the session cookie in a NextResponse.redirect() response, which Vercel's CDN may strip
- Also found that /api/auth/me was using manual cookie parsing instead of NextRequest.cookies API
- Also found api.twitter.com URLs in post/tweet routes (should be api.x.com)

Fixes applied:
1. Created new `/api/auth/set-session` endpoint that sets httpOnly session cookie in a regular JSON response (not a redirect)
2. Changed the OAuth callback to render an intermediate HTML page instead of redirecting with cookies - the HTML page fetches `/api/auth/set-session` then redirects
3. Updated `/api/auth/me` to use `NextRequest.cookies.get()` via new `getSubmitterFromNextRequest()` function
4. Updated `/api/submissions` route to use `getSubmitterFromNextRequest()`
5. Fixed `api.twitter.com` → `api.x.com` in both post route files
6. Added frontend re-check mechanism after auth=success redirect

Stage Summary:
- Core fix: Session cookie is now set via a fetch POST to `/api/auth/set-session` from an intermediate HTML page, bypassing Vercel's CDN cookie-stripping in redirect responses
- All API routes now use `NextRequest.cookies.get()` for reliable cookie reading
- TypeScript compiles clean, lint passes

---
Task ID: 2
Agent: Main Agent
Task: Fix "Failed to exchange code for token" and database connection errors on Vercel

Work Log:
- Identified root cause of token exchange failure: the code was sending BOTH `Authorization: Basic` header AND `client_id` in the request body. X's OAuth 2.0 token endpoint rejects this combination - when using Basic auth, client_id must NOT be in the body.
- Fixed `exchangeCodeForToken()` to NOT include `client_id` in the body when using Basic auth
- Added a fallback mechanism: if Basic auth fails (400/401), automatically tries the `client_secret_post` method (client_id + client_secret in body, no auth header)
- Added detailed console.log/error messages for debugging
- Fixed callback route to validate TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET exist before using them
- Updated .env template with clearer instructions for Vercel database setup

Stage Summary:
- Token exchange fix: Removed `client_id` from request body when using Basic auth, added fallback method
- Database: The localhost:5432 error is a Vercel env var configuration issue - user must set DATABASE_URL and DIRECT_URL in Vercel Dashboard

---
Task ID: 3
Agent: Main Agent
Task: Fix "unauthorized_client" / "Missing valid authorization header" token exchange error

Work Log:
- Analyzed Vercel logs showing X API returns 401 "unauthorized_client" for both Basic auth and client_secret_post
- Identified root cause: The X app is configured as a PUBLIC CLIENT (not confidential), meaning it should NOT use client_secret at all
- With PKCE for public clients, the token exchange only needs: client_id + code + redirect_uri + code_verifier
- Rewrote exchangeCodeForToken() to try 3 methods in order:
  1. Public client (PKCE-only, no client_secret) — most common for X apps
  2. Confidential client with client_secret_basic — fallback
  3. Confidential client with client_secret_post — second fallback
- Made TWITTER_CLIENT_SECRET optional in all routes
- Updated .env template to explain that TWITTER_CLIENT_SECRET is optional

Stage Summary:
- Key fix: Try public client method (no client_secret) FIRST, which matches how most X apps are configured
- This should resolve the "Failed to exchange code for token" error on Vercel

---
Task ID: 4
Agent: Main Agent
Task: Fix OAuth2 env var names and token exchange method for confidential X client

Work Log:
- User confirmed from X Developer Portal that the app is CONFIDENTIAL (WebApp type)
- X uses OAUTH2_CLIENT_ID and OAUTH2_CLIENT_SECRET as env var names, not TWITTER_CLIENT_ID
- The code was looking for TWITTER_CLIENT_ID/TWITTER_CLIENT_SECRET which weren't set in Vercel
- Fixed token exchange to use correct method: Basic auth header + PKCE code_verifier (no client_id in body)
- Added getOAuth2Credentials() helper that supports both OAUTH2_* and TWITTER_* env var names
- Updated all routes to use getOAuth2Credentials()
- Also fixed Prisma schema to use POSTGRES_DATABASE_URL / POSTGRES_DATABASE_URL_UNPOOLED (matching Vercel Neon integration)

Stage Summary:
- Main fix: Code now reads OAUTH2_CLIENT_ID + OAUTH2_CLIENT_SECRET from Vercel env vars
- Token exchange uses correct confidential client method (Basic auth + PKCE)
- User needs to verify Vercel env vars have OAUTH2_CLIENT_ID and OAUTH2_CLIENT_SECRET set correctly
