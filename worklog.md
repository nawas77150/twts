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
