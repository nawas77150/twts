# Tweetfess — Hybrid SSR + CSR UI/UX Refactor Plan

> **Version**: 5.4 — Source Code Verified (v5.3 + 2 Fixes)
> **v5.4 Amendment**: Source code verification found 2 issues in v5.3: (1) Files Modified table incorrectly listed `direct-posting-card.tsx` for task 0.1 (B-1 fix) — with the new approach the component doesn't change at all; the fix is entirely in the hook. Replaced with `src/hooks/use-posting-settings.ts`. (2) `classifyApiError` CCN 20 is a Lizard parser merge bug — it merges `classifyApiError` (lines 41-73, actual CCN ~11) with `validateCookieApiPrereqs` (lines 81-125) into one reported function. Added note to task 5.12 specifying the workaround.
> **v5.3 Amendment**: Source code verification found 2 issues in v5.2: (1) Handler count overcounted by 1 — plan said "19 non-login endpoint handlers" and "20 total" but actual count is **18 non-login** + 1 login = **19 total** (across 15 admin route files). The core claim (only login lacks `verifyAdmin()`) is correct. (2) Task 0.1 (B-1 fix) has a feasibility gap — `DirectPostingCard` only receives a `saveSetting` prop, not `deleteSetting`. The hook `usePostingSettings` doesn't expose `apiClient.deleteSetting()`. Fixed: task 0.1 now specifies modifying the hook's `saveSetting` to detect empty values and route to `apiClient.deleteSetting()` internally — fewer prop changes, centralized logic.
> **v5.2 Amendment**: Source code verification found 2 issues + 1 minor note in v5.1: (1) Proxy loop prevention had a gap — `/admin` root with an **expired** cookie still redirected infinitely (Rule 1 only passed through "no token", not "expired token"). Fixed: Rule 1 is now unconditional on `/admin` root regardless of token state. Proxy also clears expired cookies on sub-path redirects. (2) Correction #7 incorrectly stated `POST /api/admin/logout` lacks `verifyAdmin()` — it **does** have it (line 6). Only `POST /api/admin/login` lacks it. Counts corrected: 1 handler without auth (not 2), 14 non-login route files with auth (not 13). (3) Minor: `apiClient.getStats()` doesn't accept params — plumbing for `?refresh=true` noted in task 2.2.
> **v5.1 Amendment**: Source code verification found 6 issues in v5.0: (1) Proxy redirect creates infinite loop — added loop prevention logic, (2) `EncryptionBanner` receives `encryptionEnabled` as a **prop**, not from context — added task 3.6 to refactor it to read context directly, (3) `getSubmitterFromNextRequest` returns `{ id, username, displayName, profileImage, twitterId, customLimits }` not `{ submitterId, username }` — fixed in Phase 4 and Appendix D, (4) Task 2.2 file target was wrong — `invalidateCreditsCache()` already exists; fix is calling it from the stats API route, (5) Correction #7 had contradictory numbers (14 vs 13 non-login route files) — fixed to 13, (6) `classifyApiError` (CCN 20) listed in Appendix B but missing from Phase 5 tasks — added task 5.12.
> **v5.0 Breaking Update**: Internet research revealed that **Next.js 16 replaced `middleware.ts` with `proxy.ts`** which runs on **Node.js runtime by default** (not Edge). This eliminates the entire Edge Runtime crypto limitation — `verifyAdmin()` can be called directly in `proxy.ts`. Plan updated: (1) `middleware.ts` → `proxy.ts` with `proxy` export function, (2) Full `verifyAdmin()` HMAC verification now possible in proxy (not just cookie-existence), (3) Phase 3 Option B upgraded to **Option A: Full verification in proxy**, (4) All provider/layout/hydration patterns confirmed by official docs, (5) `robots.ts`/`sitemap.ts` signatures confirmed.
> **Date**: 2025-07-10
> **Scope**: Full application — `/`, `/admin`, `/admin/settings`
> **Constraints**: Cherry-pick rewrite OK · No layout changes · Low file complexity (CCN ≤ 15) · All bugs fixed · Consistent patterns · **No backward-compat shims**

---

## Table of Contents

1. [Audit Corrections — What the Original Report Got Wrong](#1-audit-corrections)
2. [Architecture Vision — Hybrid SSR + CSR](#2-architecture-vision)
3. [Verified Bug & Issue Inventory](#3-verified-bug--issue-inventory)
4. [Complexity Reduction Plan](#4-complexity-reduction-plan)
5. [Consistency Fixes — Unified Patterns](#5-consistency-fixes)
6. [Implementation Phases](#6-implementation-phases)
7. [File Map — Before & After](#7-file-map)
8. [Verification Checklist](#8-verification-checklist)
9. [Clean Up — Dead Code, Unused Exports & Files](#9-clean-up--dead-code-unused-exports--files)

---

## 1. Audit Corrections

The original `UI_FUNCTIONAL_AUDIT_REPORT.md` contained factual errors and outdated claims discovered during code validation. These corrections change the scope and approach of some fixes.

| # | Original Claim | Actual Code | Impact on Plan |
|---|---|---|---|
| M-6 | "`getKeyCredits()` has no timeout/AbortSignal" | **Has 10s timeout** — `AbortSignal.timeout(10_000)` at `twitter-api-credits.ts:29` | Root cause of "credits always timeout" is NOT missing timeout — it's that the external API is genuinely unreachable from the server + error results get cached. Fix shifts to: don't cache errors, add cache-bypass for refresh. |
| Cookie name | "Admin auth uses `tweetfess_admin` cookie" | **Cookie is `admin_token`** — `admin-auth.ts:32` reads `req.cookies.get('admin_token')?.value` | Middleware must read `admin_token`, not `tweetfess_admin`. The cookie is HttpOnly (set by `/api/admin/login`), server-readable via `cookies()`. |
| #3 | "package.json leak — Turbopack embeds project metadata (module 4730). No config option prevents this." | **Already fixed in codebase.** `constants.ts:5` now uses `process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev'` — injected at build time via `next.config.ts`, no package.json import. | **No action needed.** Task 0.7 removed from plan. |
| #7 | "Admin API endpoints in client — Inherent to SPAs, not fixable without moving to SSR." | **All 18 non-login endpoint handlers (all except `POST /api/admin/login`) across 14 non-login route files already have server-side `verifyAdmin()` auth** with HMAC-SHA256 tokens + HttpOnly cookies + timing-safe comparison. Total: 19 handlers across 15 admin route files (14 non-login + 1 login). The only handler without `verifyAdmin()` is `POST /api/admin/login` (intentional — it's the auth endpoint itself). Even `POST /api/admin/logout` has `verifyAdmin()` (line 6 — ensures only authenticated admins can clear the cookie). Knowing the path gives zero access without a valid token. SSR would be security theater — DevTools Network tab reveals paths anyway. | Not a security issue. **No SSR needed to fix this.** API-level auth is already the correct solution and is fully implemented. One minor finding: `gemini-card.tsx:63` calls `/api/admin/gemini-status` via raw `fetch()` bypassing `apiClient` — code hygiene issue only, not security. |
| L-2 | "Unused `isSaving` alias, `DEFAULT_BLOCKED_WORDS`, `DEFAULT_NSFW_WORDS` exports" | **Already fixed in codebase.** `isSaving` alias doesn't exist — hook returns `isSavingFilter` (line 191) and `isSavingRateLimits` (line 192). `DEFAULT_BLOCKED_WORDS`/`DEFAULT_NSFW_WORDS` live in `content-filter-blocked.ts` (not `use-filter-settings.ts`) and are **actively used** by `content-filter.ts`, `filter-settings.ts`, and 3 API route files. The hook receives them via API response as `defaultBlockedWords`/`defaultNsfwWords` (lines 28-29, 44-45). | **No action needed.** L-2 removed from plan. These are NOT dead code. |
| L-5 | "UserListCard add/remove no loading feedback" | **Already fixed in codebase.** `isAdding` + `removingUser` states exist with `Loader2` spinners and `disabled` states at `user-list-card.tsx:39-40,111-117,131-141`. | **No action needed.** L-5 removed from plan. |
| Audit file ref | Audit references `twitter-api-fallback.ts` for `getKeyCredits()` | **`twitter-api-fallback.ts` is a barrel re-export.** The actual implementation lives in `twitter-api-credits.ts:25`. The fallback file re-exports it at line 49. | Refactor must target `twitter-api-credits.ts`, not the barrel. |

**All other findings from the audit are confirmed accurate.**

---

## 2. Architecture Vision — Hybrid SSR + CSR

### Current State (100% CSR)

```
Browser → empty HTML shell + JS bundle → loading skeletons → useEffect → fetch /api/... → data renders
```

Every page is `'use client'`. Zero server-rendered data. Every fetch goes through an API route that could be a direct DB query.

### Target State (Hybrid SSR + CSR)

```
┌─────────────────────────────────────────────────────────────┐
│  Server Components (DEFAULT)                                 │
│  ─────────────────────────────                                │
│  • Layout shell + metadata + SEO                             │
│  • Auth gate (read cookies, redirect unauthenticated)        │
│  • Initial data fetch (direct DB via Prisma, no API route)   │
│  • Static HTML that search engines can index                 │
│  • robots.ts, sitemap.ts, not-found.tsx, error.tsx          │
│  • No 'use client' — runs on server only                     │
├─────────────────────────────────────────────────────────────┤
│  Client Components (OPT-IN via 'use client')                 │
│  ─────────────────────────────────────────                    │
│  • Interactive UI (forms, dialogs, toggles, polls)           │
│  • Real-time features (15s auto-refresh, countdowns)         │
│  • Browser APIs (window, document, localStorage)             │
│  • Framer Motion animations                                  │
│  • Accepts initialData props → skips first fetch if provided │
│  • Takes over after hydration — seamless                     │
└─────────────────────────────────────────────────────────────┘
```

### Rendering Flow — Per Page

#### `/` (Public Home — Biggest SEO Win)

```
page.tsx (SERVER)
  ├─ Read submitter session cookie → initialAuth state
  ├─ Query DB for initial limits (Prisma, no API route)
  ├─ <h2>Kirim Pesan Anonim</h2>           ← SEO, server-rendered
  ├─ <p>Tulis pesanmu...</p>                ← SEO, server-rendered
  ├─ <TrustBadges />                        ← server component
  ├─ <Footer />                             ← server component
  │
  ├─ <HomeClient initialSubmitter={...} initialLimits={...} />  ← CLIENT
  │   ├─ <PublicHeader />                  ← login/logout buttons
  │   ├─ <AuthGate>                        ← auth check UI
  │   │   └─ <ConfessionForm />            ← interactive form
  │   └─ <MyPosts />                       ← interactive list + 30s poll
  │
  └─ metadata export (title, OG, twitter card)
```

**What changes for the user**: No loading flash on first visit. SEO crawlers see full HTML. Logged-in users see form instantly.

**What doesn't change**: Form interaction, polling, countdowns — all client-side, unchanged.

#### `/admin` (Dashboard) — Layout Shell

The admin layout shell is the **single biggest speed win** in this plan. Currently the entire layout is `'use client'` — nothing renders until JS loads, hydrates, and runs the auth check. The layout shell streams HTML immediately.

```
proxy.ts (SERVER — Node.js runtime)
  └─ Read admin_token cookie → verifyAdmin()
     - /admin root → ALWAYS let through (login card renders regardless of token)
     - /admin/* sub-paths + valid token → let through
     - /admin/* sub-paths + invalid/expired/missing token → redirect to /admin + clear expired cookie
     NOTE: proxy.ts runs on Node.js runtime (not Edge), so crypto.createHmac +
     crypto.timingSafeEqual work natively. Full HMAC verification possible.

admin/layout.tsx (SERVER) — Layout Shell
  ├─ metadata: { robots: { index: false } }  ← no search indexing
  └─ <AdminClientShell>{children}</AdminClientShell>

admin/_client-shell.tsx ('use client')
  ├─ <AdminAuthProvider>
  ├─ <AdminStatsProvider>
  │   ├─ <div className="min-h-screen flex flex-col bg-[#F7F9F9]">
  │   │   ├─ <AdminHeader />            ← CLIENT (has both contexts: auth + stats)
  │   │   ├─ <main>{children}</main>
  │   │   └─ <footer>...</footer>        ← CLIENT (instant paint, no data dep)
  │   └─ </div>
  └─ </AdminStatsProvider>
  └─ </AdminAuthProvider>

admin/page.tsx → admin/dashboard-client.tsx (CLIENT)
  ├─ <StatsGrid />        + 15s auto-refresh
  ├─ <EncryptionBanner /> ← CLIENT (calls useAdminStats() directly after task 3.6 refactor)
  ├─ <ConnectionBanner />
  ├─ <PostMethodRates />
  ├─ <SubmissionFilters />
  ├─ <SubmissionList />
  └─ <UsersDialog />
```

**Speed impact**:

| Metric | Current (client layout) | Layout Shell (server) |
|---|---|---|
| First Contentful Paint | Waits for: JS bundle → hydrate → auth fetch → render | Metadata + layout boundary stream immediately. Client shell renders in one tick after hydration |
| Layout shift | None (auth gate blocks everything) | None (client shell handles auth gate internally) |
| Navigation `/admin` ↔ `/admin/settings` | Fast (layout preserved by Next.js) | Fast (same — layout + providers preserved, no re-fetch) |
| Login redirect | Client-side conditional render | Proxy lets `/admin` root through unconditionally (login card renders); redirects sub-paths + clears expired cookies — no infinite loop even with expired tokens |

**What changes**: No login flash on sub-pages — proxy redirects `/admin/settings` (etc.) to `/admin` (login) before JS loads, and clears expired cookies on redirect. On `/admin` root, proxy **always** lets the request through (even with expired tokens) — `AdminClientShell` renders the login card when `isAdmin=false`, preventing infinite redirect loops. Admin layout is a server component (can export metadata). Header + footer are client-rendered but instant (no data dependency — `pendingCount` loads asynchronously via context).

**What doesn't change**: All dashboard interactivity — same hooks, same components. Navigation between admin pages preserves providers (single instance, no re-fetch). `AdminHeader` continues to access `pendingCount` from `AdminStatsProvider`.

#### `/admin/settings` (Settings) — Nested Layout Shell

Settings currently has no `layout.tsx`. The settings header ("Settings" + "Manage autobase configuration") and tab navigation are rendered inside `page.tsx`, which means they remount on every navigation. A nested layout shell fixes this.

```
admin/settings/layout.tsx (SERVER) — Nested Layout Shell
  ├─ <div>
  │   ├─ <div className="mb-6">
  │   │   ├─ <h2 className="text-lg font-bold text-[#0F1419]">Settings</h2>
  │   │   └─ <p className="text-xs text-[#536471]">Manage autobase configuration</p>
  │   ├─ <EncryptionBanner />       ← CLIENT (reads encryptionEnabled via useAdminStats() — refactored in task 3.6)
  │   └─ {children}                 ← tab content below
  │   </div>
  └─ </div>

admin/settings/page.tsx → admin/settings-client.tsx (CLIENT)
  ├─ <Tabs defaultValue="posting">
  │   ├─ <TabsList>  ← persistent tab navigation
  │   └─ <TabsContent> ← each tab's settings cards
  │       ├─ Posting: <DirectPostingCard />, <ApiFallbackCard />
  │       ├─ Filter:  <FilterCard />, <GeminiCard />
  │       ├─ Users:   <WhitelistCard />, <BlocklistCard />
  │       └─ Limits:  <LimitHealthCard />, <RateLimitCard />, <CircuitBreakerCard />
  └─ </Tabs>
```

**Why a nested layout**: If settings is ever split into sub-routes (`/admin/settings/posting`, `/admin/settings/filter`, etc.), the layout shell already holds the header + tabs, and only `{children}` swaps. Even with current single-page structure, the layout shell provides:
- Consistent rendering boundary (header doesn't remount)
- Speed: settings header + encryption banner stream immediately
- Future-proof: sub-route split is a one-line change

**What changes**: Settings header (`<h2>`, `<p>`) extracted into server layout — instant paint without JS. `EncryptionBanner` stays a client component but is refactored (task 3.6) to call `useAdminStats()` directly instead of receiving `encryptionEnabled` as a prop — this is necessary because the settings layout is a server component that can't pass client context as a prop.

**What doesn't change**: All settings interactivity — tabs, cards, auto-save toggles.

---

## 3. Verified Bug & Issue Inventory

Every item below has been traced to exact line numbers in the current source code (commit `5e1d411`). Status reflects actual code state.

### 🔴 Critical Bugs

| ID | Issue | File:Line | Verified | Root Cause |
|---|---|---|---|---|
| B-1 | "Clear Query ID" button broken — sends empty string, API rejects with 400 | `direct-posting-card.tsx:198` | ✅ | Uses `saveSetting('x_query_id', '', ...)` instead of `apiClient.deleteSetting('x_query_id')` (exists at `api-client.ts:174`). **Fix**: modify hook's `saveSetting` to route empty values to `apiClient.deleteSetting()` (see task 0.1). |

### 🟡 Medium Issues

| ID | Issue | File:Line | Verified | Root Cause |
|---|---|---|---|---|
| M-1 | `setFilterRules` prop dead code | `filter-card.tsx:27,61` | ✅ | Destructured but never called — `toggleRule` used instead |
| M-2 | `resetState()` never called on logout | `admin-auth-context.tsx:55-59` | ✅ | Logout only sets `isAdmin=false`, doesn't reset settings hooks. **Both** `use-filter-settings.ts:170-184` and `use-posting-settings.ts:161-173` have `resetState()` callbacks that are never wired to logout |
| M-3 | Gemini Save Key/Model buttons lack loading states | `gemini-card.tsx:137-145, 168-176` | ✅ | No spinner, no disabled-during-save |
| M-4 | RateLimit + CircuitBreaker share `isSavingRateLimits` | `settings/page.tsx:248,258` | ✅ | Both cards receive same boolean — both spinners activate |
| M-5 | Toggle save behaviors inconsistent | `use-filter-settings.ts:48-54` (local) vs `:58-78` (API) + `api-fallback-card.tsx:87-93,123-129` | ✅ | Gemini/PostMethod/V2 auto-save; AutoApprove/FilterRules local-only |
| M-6 | API Credits show timeout error + Refresh doesn't fix | `twitter-api-credits.ts:29,90-103` | ✅ (corrected) | Timeout exists (10s) but external API is unreachable. Error results cached. `getApiCreditsNonBlocking()` returns cached errors. |
| M-7 | Pengguna dialog broken on mobile | `users-dialog.tsx:363` | ✅ | `grid-cols-2` on small screens, buttons show full text, padding too large |
| M-8 | 100% client-side rendering | `page.tsx:1`, `admin/page.tsx:1`, `admin/layout.tsx:1`, `admin/settings/page.tsx:1` | ✅ | All pages have `'use client'` on line 1 |

### 🟢 Low Issues / UX Gaps

| ID | Issue | File:Line | Verified | Status |
|---|---|---|---|---|
| L-1 | `loadMore` / `total` unused returns | `use-submissions.ts:268,278` | ✅ | Open |
| ~~L-2~~ | ~~Unused `isSaving` alias, `DEFAULT_*` exports~~ | — | — | **Already fixed** — removed from plan |
| L-3 | `window.confirm()` for delete | `submission-card.tsx:171` | ✅ | Open |
| L-4 | Gemini toggle ignores `checked` parameter | `gemini-card.tsx:104` | ✅ | Open |
| ~~L-5~~ | ~~UserListCard add/remove no loading feedback~~ | — | — | **Already fixed** — loading states exist with spinners |
| L-6 | `search`/`setSearch` unused from `use-submitters.ts` | `use-submitters.ts:88,93` | ✅ | Open |
| L-7 | (merged with L-1) | — | — | — |
| L-8 | UsersDialog RefreshCw → Loader2 swap | `users-dialog.tsx:217-221` | ✅ | Open |
| L-9 | `handleRefreshCredits` no try/finally | `settings/page.tsx:102-106` | ✅ | Open |
| L-10 | Missing `robots.ts` | File doesn't exist | ✅ | Open |
| L-11 | Missing `sitemap.ts` | File doesn't exist | ✅ | Open |
| L-12 | Missing `not-found.tsx` | File doesn't exist | ✅ | Open |
| L-13 | Missing `error.tsx` | File doesn't exist | ✅ | Open |
| L-14 | Incomplete OG/Twitter metadata | `layout.tsx:16-23` | ✅ | Open |

### Architecture Gaps

| ID | Gap | Verified |
|---|---|---|
| A-1 | No `robots.ts` | ✅ |
| A-2 | No `sitemap.ts` | ✅ |
| A-3 | No `not-found.tsx` | ✅ |
| A-4 | No `error.tsx` | ✅ |
| A-5 | Incomplete OG metadata | ✅ |
| A-6 | No proxy auth — admin login flash | ✅ |
| A-7 | Home page not SSR'd — poor SEO | ✅ |
| A-8 | Admin pages missing `robots: noindex` | ✅ |
| A-9 | Admin layout `'use client'` unnecessarily | ✅ |
| A-10 | No `admin/settings/layout.tsx` — settings header remounts on every navigation | ✅ |

---

## 4. Complexity Reduction Plan

### Current Complexity (Lizard Results)

17 functions exceed CCN 15. Top offenders:

| File | Function | CCN | NLOC | Plan |
|---|---|---|---|---|
| `app/api/submissions/route.ts` | `GET` | **36** | 258 | Extract: `buildWhereClause()`, `computePagination()`, `formatResponse()` |
| `app/api/admin/settings/route.ts` | `POST` | **36** | 141 | Extract: per-setting handler map (`settingHandlers[key]`) |
| `components/settings/api-fallback-card.tsx` | `ApiFallbackCard` | **26** | 214 | Extract: `<PostMethodSection />`, `<V2LoginSection />`, `<CredentialFields />`, `<ApiKeySection />` |
| `components/dashboard/connection-banner.tsx` | `ConnectionBanner` | **25** | 124 | Extract: `<CookieStatusBanner />`, `<ApiLoginBanner />` |
| `lib/content-filter-checks.ts` | `checkJualan` | **23** | 91 | Extract: sub-checks as pure functions |
| `components/dashboard/submission-card.tsx` | `SubmissionCard` | **20** | 157 | Extract: `<CardActions />`, `<StatusIndicator />` |
| `app/api/auth/twitter/callback/route.ts` | `GET` | **21** | 149 | Extract: `exchangeOAuthCode()`, `createOrUpdateSubmitter()` |
| `app/api/autopost/route.ts` | `GET` | **22** | 134 | Extract: `selectPostMethod()`, `executeAndRecord()` |
| `lib/twitter-v2-login.ts` | 3 functions ≥ 20 | 20-46 | Module-level refactor needed |
| `components/settings/gemini-card.tsx` | `GeminiCard` | **18** | 166 | Extract: `<GeminiToggle />`, `<GeminiKeyInput />`, `<GeminiModelInput />` |

### Complexity Budget

**Target**: No function exceeds **CCN 15**. Each extracted function should be ≤ 60 NLOC.

**Strategy**:
1. **API routes**: Extract business logic into named helper functions in the same file (no new files needed for route helpers).
2. **UI components**: Extract sub-sections into small client components in the same directory.
3. **Library functions**: Extract decision trees into lookup maps or strategy patterns.

### Detailed Decomposition

#### 4.1 `api/submissions/route.ts` (GET — CCN 36 → target ≤ 12)

```
Current: One 258-line function with 7+ branching paths
Target: 3-4 composed functions

Extract:
├── buildWhereClause(status, search) → Prisma.WhereInput  [~15 lines, CCN ~5]
├── computePagination(page, limit, total) → { skip, take, totalPages }  [~8 lines, CCN ~2]
├── formatSubmissionsResponse(submissions, pagination) → JSON  [~10 lines, CCN ~2]
└── GET handler → orchestrates the above  [~30 lines, CCN ~5]
```

#### 4.2 `api/admin/settings/route.ts` (POST — CCN 36 → target ≤ 10)

```
Current: Giant if/else chain handling ~15 different setting keys
Target: Handler map pattern

Extract:
├── settingHandlers: Record<string, (value: string) => Promise<...>>
│   ├── 'x_cookie_string' → parseCookie, validate, save
│   ├── 'x_bearer_token' → validate, save
│   ├── 'x_query_id' → validate, save
│   ├── 'post_method' → validate enum, save
│   ├── ... etc.
│   └── default → reject unknown key
└── POST handler → lookup handler, call it  [~15 lines, CCN ~3]
```

#### 4.3 `api-fallback-card.tsx` (CCN 26 → target ≤ 12)

```
Current: One 316-line component with 8 sections
Target: 4 focused sub-components + thin shell

Extract (all 'use client'):
├── <PostMethodSection />      — 3-button toggle + save  [~40 lines]
├── <V2LoginSection />         — switch + save           [~30 lines]
├── <CredentialFields />       — username/email/password/2FA + save-all  [~50 lines]
├── <ApiKeySection />          — API keys + proxy + credits  [~50 lines]
└── <ApiFallbackCard />        — shell composing the above  [~40 lines]
```

#### 4.4 `connection-banner.tsx` (CCN 25 → target ≤ 10)

```
Current: One 124-line component with 2 distinct banner types
Target: 2 small components + shell

Extract (all 'use client'):
├── <CookieStatusBanner />     — cookie connection status  [~30 lines]
├── <ApiLoginBanner />         — API login status          [~30 lines]
└── <ConnectionBanner />       — shell composing the above  [~15 lines]
```

#### 4.5 `gemini-card.tsx` (CCN 18 → target ≤ 10)

```
Current: One 166-line component with 3 distinct sections
Target: 3 small components + shell

Extract (all 'use client'):
├── <GeminiToggle />           — switch + spinner + save   [~25 lines]
├── <GeminiKeyInput />         — API key input + save      [~30 lines]
├── <GeminiModelInput />       — model input + save        [~25 lines]
└── <GeminiCard />             — shell composing the above  [~20 lines]
```

#### 4.6 `submission-card.tsx` (CCN 20 → target ≤ 12)

```
Current: One 157-line component with action buttons + status display
Target: 2 sub-components + shell

Extract (all 'use client'):
├── <CardActions />            — approve/reject/retry/delete buttons  [~40 lines]
├── <StatusBadge />            — status indicator with color logic     [~20 lines]
└── <SubmissionCard />         — shell + layout                        [~50 lines]
```

#### 4.7 Backend route decompositions (no UI changes)

| Route | Current CCN | Target | Strategy |
|---|---|---|---|
| `autopost/route.ts` GET | 22 | ≤ 12 | Extract `selectPostMethod()`, `executeAndRecord()` |
| `auth/twitter/callback/route.ts` GET | 21 | ≤ 12 | Extract `exchangeOAuthCode()`, `createOrUpdateSubmitter()` |
| `admin/submitters/limits/route.ts` PATCH | 21 | ≤ 12 | Extract per-limit validation + update helpers |
| `admin/filter-settings/route.ts` POST | 18 | ≤ 12 | Extract field validation map |
| `content-filter-checks.ts` `checkJualan` | 23 | ≤ 12 | Extract sub-check pure functions |
| `twitter-v2-login.ts` (3 functions) | 17-20 | ≤ 12 each | Extract common retry/error logic |

---

## 5. Consistency Fixes — Unified Patterns

### 5.1 Write Action Pattern: Spinner + Toast (Canonical)

**Decision**: ALL write actions use spinner + toast. No optimistic updates. No revert logic. Simpler, consistent, no visual glitch on failure.

**Canonical implementation** (every write action follows this exactly):

```typescript
async function handleAction() {
  setIsSaving(true)
  try {
    const result = await apiClient.someAction()
    // Update UI only on success
    setSomeState(result.newValue)
    toast({ title: 'Success message' })
  } catch (err) {
    // UI state unchanged — no revert needed
    const message = err instanceof ApiError ? err.message : 'Gagal'
    toast({ title: 'Gagal', description: message, variant: 'destructive' })
  } finally {
    setIsSaving(false)
  }
}
```

**Actions that need migration** (currently optimistic + revert):

| Action | File | Current Pattern | Migration |
|---|---|---|---|
| Post Method toggle (3 buttons) | `api-fallback-card.tsx:123-129` | Optimistic + `onFailure` revert | → spinner + toast |
| V2 Login toggle | `api-fallback-card.tsx:87-93` | Optimistic + `onFailure` revert | → spinner + toast |
| Gemini toggle | `use-filter-settings.ts:58-78` | Optimistic + revert on catch | → spinner + toast |

**Actions already following the pattern** (no migration needed):

- Approve, Reject, Delete, Retry Post — `use-submissions.ts`
- Circuit Breaker reset — `use-circuit-breaker.ts`
- All Save buttons — already await API then update
- UserListCard add/remove — already has `isAdding` + `removingUser` with Loader2 spinners

### 5.2 Toggle Save Behavior: All Auto-Save

**Decision**: ALL toggles auto-save immediately with spinner + toast. No more "Save Filter Settings" button for toggles. The button remains only for textareas (blocked words, NSFW words).

**Changes**:

| Toggle | Current | Target |
|---|---|---|
| Auto-Approve | Local state only (requires "Save Filter Settings") | Auto-save with spinner + toast via `saveFilterSettings({ autoApprove: !autoApprove })` |
| 7 Filter Rule toggles | Local state only | Auto-save with spinner + toast via `saveFilterSettings({ filterRules: updated })` |
| Gemini | Auto-save (optimistic) | Auto-save (spinner + toast — already auto-saves, just change pattern) |
| Post Method | Auto-save (optimistic) | Auto-save (spinner + toast — already auto-saves, just change pattern) |
| V2 Login | Auto-save (optimistic) | Auto-save (spinner + toast — already auto-saves, just change pattern) |

**"Save Filter Settings" button**: Remains for textareas only (blocked words, NSFW words). Rename to "Save Words & Text Settings" for clarity.

### 5.3 RefreshCw Animation: Counterclockwise Everywhere

**Decision**: All refresh buttons use `<RefreshCw className={isLoading ? 'animate-spin-reverse' : ''} />`. Never swap to `Loader2`.

**Files that need fix**:

| File | Current | Target |
|---|---|---|
| `users-dialog.tsx:217-221` | Swaps `RefreshCw` → `Loader2 + animate-spin` | Use `RefreshCw` with `animate-spin-reverse` only |

### 5.4 Delete Confirmation: AlertDialog

**Decision**: Replace all `window.confirm()` with shadcn/ui `AlertDialog`.

**Files**:

| File | Current | Target |
|---|---|---|
| `submission-card.tsx:171` | `window.confirm('Hapus pesan ini?')` | `<AlertDialog>` component |

### 5.5 Loading States: Every Button Shows Spinner

**Decision**: Every save/action button shows a spinner (Loader2 or RefreshCw animate-spin-reverse) during its API call, and is disabled.

**Files that need fix**:

| File | Button | Current | Target |
|---|---|---|---|
| `gemini-card.tsx:137-145` | "Save Key" | No spinner, no disabled | Add spinner + disabled |
| `gemini-card.tsx:168-176` | Model "Save" | No spinner, no disabled | Add spinner + disabled |
| `settings/page.tsx:102-106` | Credit Refresh | No try/finally → can get stuck | Add try/finally |

Note: `user-list-card.tsx` already has proper loading states (`isAdding` + `removingUser` with Loader2) — no fix needed.

### 5.6 Rate Limits + Circuit Breaker: Separate Loading States

**Decision**: Track which card initiated the save. Each card shows its own spinner independently.

**Implementation**:
```typescript
// In settings page state:
const [savingSource, setSavingSource] = useState<'rate-limit' | 'circuit-breaker' | null>(null)

const filterSaveRateLimits = useCallback(async (source: 'rate-limit' | 'circuit-breaker') => {
  setSavingSource(source)
  try {
    await filterSettings.saveRateLimits()
    void refetchAdminStats()
  } finally {
    setSavingSource(null)
  }
}, [filterSettings, refetchAdminStats])

// Pass to cards:
<RateLimitCard isSaving={savingSource === 'rate-limit'} saveRateLimits={() => filterSaveRateLimits('rate-limit')} />
<CircuitBreakerCard isSaving={savingSource === 'circuit-breaker'} saveRateLimits={() => filterSaveRateLimits('circuit-breaker')} />
```

### 5.7 Mobile Responsive: Pengguna Dialog

**Decision**: Responsive dialog that works on 375px phones.

**Changes** (no structural changes, CSS-only):

| Element | Current | Target |
|---|---|---|
| DialogContent padding | Default `p-6` (48px) | `p-4 sm:p-6` |
| Action button text (Limits, Block, Unblock) | Always icon + text | Icon-only on mobile, icon+text on `sm:` — wrap text in `<span className="hidden sm:inline">` |
| Limits editor grid | `grid-cols-2` | `grid-cols-1 sm:grid-cols-2` |
| Avatar | `w-8 h-8` | `w-7 h-7 sm:w-8 sm:h-8` |

---

## 6. Implementation Phases

### Phase 0: Audit Corrections & Bug Fixes (Priority: 🔴 Critical)

**Duration**: ~1 hour
**Risk**: Zero — surgical fixes to specific lines
**No new files** — only edit existing files

| # | Task | ID | File | Change | Lines Changed |
|---|---|---|---|---|---|
| 0.1 | Fix "Clear Query ID" button | B-1 | `use-posting-settings.ts:66-94` + `direct-posting-card.tsx:198` | **Feasibility note**: `DirectPostingCard` only has `saveSetting` prop — no `deleteSetting`. The hook doesn't expose `apiClient.deleteSetting()`. **Fix**: modify the hook's `saveSetting` to detect empty values — when `value.trim() === ''`, call `apiClient.deleteSetting(key)` instead of `apiClient.saveSetting(key, value)`. This centralizes the logic in the hook (fewer prop changes) and the component code at line 198 doesn't need to change at all (`saveSetting('x_query_id', '', ...)` will route to DELETE automatically). | ~5 |
| 0.2 | Wire `resetState` to logout (both hooks) | M-2 | `admin-auth-context.tsx:55-59` | Accept `onResetState` callbacks from both `use-filter-settings` and `use-posting-settings`, call both in logout | ~8 |
| 0.3 | Add try/finally to refresh credits | L-9 | `settings/page.tsx:102-106` | Wrap `handleRefreshCredits` in try/finally so spinner doesn't get stuck on error. After task 2.2, pass `{ refresh: true }` to `refetchAdminStats()` to bypass cache (requires `apiClient.getStats()` plumbing from task 2.2). | ~4 |
| 0.4 | Remove dead `setFilterRules` prop | M-1 | `filter-card.tsx` + `settings/page.tsx` | Remove from props interface and pass-through | ~4 |
| 0.5 | Clean unused hook returns | L-1, L-6 | `use-submissions.ts`, `use-submitters.ts` | Remove `loadMore`, `total`, `search`, `setSearch` | ~8 |
| 0.6 | Fix UsersDialog RefreshCw animation | L-8 | `users-dialog.tsx:217-221` | Replace `Loader2` with `RefreshCw + animate-spin-reverse` | ~3 |

**Verification**: Run `bun run lint` after each change. Test B-1 by clicking "Clear Query ID" button — should now delete successfully with toast.

---

### Phase 1: Consistency Fixes (Priority: 🟡 High)

**Duration**: ~2-3 hours
**Risk**: Low — no architecture changes, only pattern unification

| # | Task | ID | File(s) | Change | Lines Changed |
|---|---|---|---|---|---|
| 1.1 | Migrate Post Method toggle to spinner+toast | M-5 | `api-fallback-card.tsx:123-129` | Replace optimistic+revert with spinner+toast | ~12 |
| 1.2 | Migrate V2 Login toggle to spinner+toast | M-5 | `api-fallback-card.tsx:87-93` | Replace optimistic+revert with spinner+toast | ~12 |
| 1.3 | Migrate Gemini toggle to spinner+toast | M-5 | `use-filter-settings.ts:58-78` | Remove optimistic set, only update on success | ~8 |
| 1.4 | Make Auto-Approve toggle auto-save | M-5 | `use-filter-settings.ts:48-50` + `filter-card.tsx` | Call `saveFilterSettings` with spinner+toast | ~10 |
| 1.5 | Make Filter Rule toggles auto-save | M-5 | `use-filter-settings.ts:52-54` + `filter-card.tsx` | Call `saveFilterSettings` with spinner+toast | ~10 |
| 1.6 | Add loading states to Gemini Save buttons | M-3 | `gemini-card.tsx:137-145,168-176` + `use-filter-settings.ts` | Add `geminiKeySaving`, `geminiModelSaving` states | ~15 |
| 1.7 | Separate RateLimits + CB loading states | M-4 | `settings/page.tsx` | Track `savingSource` instead of shared boolean | ~10 |
| 1.8 | Fix Pengguna dialog mobile responsive | M-7 | `users-dialog.tsx` | CSS-only: padding, button text, grid cols | ~12 |
| 1.9 | Replace `window.confirm` with AlertDialog | L-3 | `submission-card.tsx:171` | Add AlertDialog component | ~20 |
| 1.10 | Fix Gemini toggle to use canonical value | L-4 | `gemini-card.tsx:104` | Use `checked` param from Switch | ~2 |
| 1.11 | Move raw fetch to apiClient | #7 | `gemini-card.tsx:63` + `api-client.ts` | Add `getGeminiStatus()` to apiClient, replace raw `fetch('/api/admin/gemini-status')` | ~6 |

**Verification**:
- All toggles auto-save: toggle any switch → toast appears → refresh page → state persisted
- No optimistic updates: disconnect network → toggle → stays in old state + error toast
- Mobile: open Pengguna dialog on 375px viewport → buttons icon-only, grid single-column
- Delete: click × → AlertDialog appears (not browser confirm)

---

### Phase 2: API Credits Fix + SEO Quick Wins (Priority: 🟡 High)

**Duration**: ~2 hours
**Risk**: Zero — new files only, no existing file changes (except layout metadata)

| # | Task | ID | File(s) | Change | Lines Changed |
|---|---|---|---|---|---|
| 2.1 | Don't cache error results in credits | M-6 | `twitter-api-credits.ts` | Only update `creditsCache` if all entries have no `error` | ~5 |
| 2.2 | Add cache-bypass for credit refresh | M-6 | `api/admin/stats/route.ts` + `api-client.ts` | `invalidateCreditsCache()` already exists at `twitter-api-credits.ts:125-128` — it just isn't called from the refresh flow. **Server-side** (stats route): add `?refresh=true` query param support — when present, call `invalidateCreditsCache()` before `getApiCreditsNonBlocking()`. **Client-side** (api-client.ts): add `getStats(options?: { refresh?: boolean })` — when `refresh: true`, append `?refresh=true` to URL. **Wiring**: `handleRefreshCredits` in settings page passes `{ refresh: true }` to `refetchAdminStats()`. ~8 lines total across 2 files. |
| 2.3 | Create `src/app/robots.ts` | A-1 | New file | `export default function robots(): MetadataRoute.Robots` — Allow `/`, disallow `/admin` and `/api` | ~12 |
| 2.4 | Create `src/app/sitemap.ts` | A-2 | New file | `export default function sitemap(): MetadataRoute.Sitemap` — List `https://{domain}/` with daily frequency | ~10 |
| 2.5 | Create `src/app/not-found.tsx` | A-3 | New file | Server component, branded 404 with "Kembali ke beranda" | ~20 |
| 2.6 | Create `src/app/error.tsx` | A-4 | New file | `'use client'`, "Terjadi kesalahan" + "Coba Lagi" button | ~18 |
| 2.7 | Add OG + Twitter Card metadata | A-5 | `layout.tsx:16-23` | Add `openGraph` and `twitter` fields to metadata | ~15 |

**Verification**:
- `GET /robots.txt` → shows allow/disallow rules
- `GET /sitemap.xml` → shows URL with lastmod
- Visit `/nonexistent` → branded 404 page
- Share URL on WhatsApp/Discord → rich card preview
- Credits refresh → calls `invalidateCreditsCache()` first via `?refresh=true` param on stats API, then fetches fresh

---

### Phase 3: Proxy Auth + Admin SSR Shell (Priority: 🟡 High)

**Duration**: ~2-3 hours
**Risk**: Low-Medium — changes admin layout structure, but proxy auth is straightforward with Node.js runtime

#### ✅ Next.js 16 Proxy.ts — No Edge Runtime Limitation

**Critical finding (v5.0)**: This project uses Next.js ^16.1.1. In Next.js 16, `middleware.ts` is **deprecated** and replaced by **`proxy.ts`**, which runs on **Node.js runtime by default** (not Edge Runtime). This eliminates the entire Edge Runtime crypto limitation that previous plan versions were built around.

| Aspect | `middleware.ts` (deprecated) | `proxy.ts` (Next.js 16+) |
|--------|---------------------------|--------------------------|
| Default runtime | Edge Runtime | **Node.js runtime** |
| `crypto.createHmac()` | ❌ Not available | ✅ Available |
| `crypto.timingSafeEqual()` | ❌ Not available | ✅ Available |
| `Buffer.from()` | ⚠️ Partial | ✅ Available |
| `verifyAdmin()` direct import | ❌ Crashes | ✅ Works natively |
| Setting `runtime` config | Supported in 15.5+ | **Throws error** (always Node.js) |
| Export function name | `middleware` | `proxy` |

**Sources**: [Next.js 16 Blog](https://nextjs.org/blog/next-16), [Proxy API Reference](https://nextjs.org/docs/app/api-reference/file-conventions/proxy), [Next.js 15.5 Blog](https://nextjs.org/blog/next-15-5)

**Decision: Full `verifyAdmin()` in proxy.ts**

Since `proxy.ts` runs on Node.js runtime, we can import and call `verifyAdmin()` directly. No need for cookie-existence-only checks or Web Crypto API rewrites. The proxy provides **true server-side auth gating** — unauthenticated users never see the admin shell.

**Comparison with previous plan versions**:

| Option | Effort | Security | Status |
|--------|--------|----------|--------|
| ~~A: Rewrite crypto for Edge~~ | ~~1-2 hours~~ | ~~Strong~~ | ~~Obsolete — proxy.ts uses Node.js~~ |
| ~~B: Cookie-existence check~~ | ~~30 min~~ | ~~Weaker (forged tokens pass)~~ | ~~Superseded — full verify now possible~~ |
| **C: Full verifyAdmin() in proxy.ts** | **~15 min** | **Strongest** | **✅ Chosen — simple, secure, no trade-offs** |

**Official Next.js guidance** — The [authentication guide](https://nextjs.org/docs/app/guides/authentication) calls this "optimistic checks with Proxy" and recommends:
- Proxy checks session cookie for **UI redirects** (optimistic)
- Route handlers / DAL perform **secure checks** (full verification)
- Our approach goes further: proxy does full HMAC verification too, since Node.js runtime makes it cheap

| # | Task | ID | File(s) | Change |
|---|---|---|---|---|
| 3.1 | Create `src/proxy.ts` | A-6 | New file | Export `proxy` function (not `middleware`). Read `admin_token` cookie → call `verifyAdmin()` directly → redirect unauthenticated on `/admin/*`. **Full HMAC verification** — `crypto.createHmac`, `crypto.timingSafeEqual`, `Buffer.from` all work natively in Node.js runtime. No Edge Runtime limitation. **Loop prevention**: `/admin` root → `NextResponse.next()` **ALWAYS** (regardless of token — login card renders via `AdminClientShell` when `isAdmin=false`); `/admin/*` sub-paths with invalid/expired/missing token → redirect to `/admin` + clear expired cookie (`maxAge: 0`). This prevents infinite loops even with expired tokens (common after 7-day TTL). |
| 3.2 | Split admin layout into server shell + client shell | A-9 | `admin/layout.tsx` | Server layout exports metadata + wraps `<AdminClientShell>{children}</AdminClientShell>`. Client shell (`admin/_client-shell.tsx`) wraps `AdminAuthProvider` + `AdminStatsProvider` + renders `AdminHeader` + footer + `{children}`. **Providers stay in layout** (not page-level) so `AdminHeader` can access `pendingCount` from context and stats don't re-fetch on navigation. |
| 3.3 | Add `robots: noindex` to admin layout | A-8 | `admin/layout.tsx` | `export const metadata = { robots: { index: false } }` — now possible because layout is server component |
| 3.4 | Extract admin login dialog | — | New `admin/admin-login-dialog.tsx` | Client component: the current "Akses Terbatas" card + login dialog |
| 3.5 | Create `admin/settings/layout.tsx` | A-10 | New file | Server component — settings header (`<h2>`, `<p>`) streams immediately as server HTML. `<EncryptionBanner />` is a **CLIENT** component. `{children}` contains tab content |
| 3.6 | Refactor `EncryptionBanner` to read context directly | — | `encryption-banner.tsx` | **Current code receives `encryptionEnabled` as a prop** (line 5-7: `interface EncryptionBannerProps { encryptionEnabled: boolean | undefined }`). In the settings layout (server component), it can't receive props from client context. Refactor: remove the prop interface, import and call `useAdminStats()` directly inside the component to read `encryptionEnabled` from context. Update both call sites (`admin/page.tsx:151` and `admin/settings/page.tsx:118`) — remove `encryptionEnabled={stats?.encryptionEnabled}` prop since the component now reads context internally. |

**Architecture after Phase 3**:

```
proxy.ts (SERVER — Node.js runtime)
  │ Reads admin_token cookie on /admin/* routes
  │ Calls verifyAdmin() — FULL HMAC verification (Node.js runtime, no Edge limitation)
  │
  │ Loop prevention logic:
  │   1. If pathname === '/admin' → NextResponse.next() (ALWAYS, regardless of token)
  │      (login card renders on /admin root — AdminClientShell handles login flow when isAdmin=false)
  │   2. If pathname.startsWith('/admin') and token valid → NextResponse.next()
  │   3. If pathname.startsWith('/admin') and token invalid/expired/missing →
  │      redirect to /admin + clear expired cookie (maxAge=0)
  │      (forces back to login card — no loop because step 1 lets /admin through unconditionally)
  │
  ▼
admin/layout.tsx (SERVER) — LAYOUT SHELL, no 'use client'
  ├─ export const metadata = { robots: { index: false } }
  └─ <AdminClientShell>{children}</AdminClientShell>

admin/_client-shell.tsx ('use client')
  ├─ <AdminAuthProvider>                 ← stays in layout (not page-level)
  │   <AdminStatsProvider>               ← stays in layout (shared across pages)
  │     ├─ <div className="min-h-screen flex flex-col bg-[#F7F9F9]">
  │     │   ├─ <AdminHeader />           ← CLIENT (has access to both contexts)
  │     │   │   ↑ pendingCount loads asynchronously via context. Nav links instant.
  │     │   ├─ <main>{children}</main>   ← page content (dashboard or settings)
  │     │   └─ <footer>...</footer>       ← CLIENT (instant paint, no data dep)
  │     └─ </div>
  │   </AdminStatsProvider>
  └─ </AdminAuthProvider>

admin/settings/layout.tsx (SERVER) — NESTED LAYOUT SHELL
  ├─ <div className="mb-6">
  │   ├─ <h2>Settings</h2>              ← SERVER — streams immediately
  │   ├─ <p>Manage autobase configuration</p> ← SERVER — streams immediately
  │   ├─ <EncryptionBanner />           ← CLIENT (calls useAdminStats() directly — refactored in task 3.6 to read context internally instead of receiving prop)
  │   └─ {children}                     ← settings-client.tsx (tabs + cards)
  └─ </div>
```

**Key decision**: `AdminAuthProvider` and `AdminStatsProvider` must remain client components (they use `useState`, `useEffect`, `useCallback`). They **stay in the layout** inside `AdminClientShell` — NOT moved to page-level wrappers. Moving them to page-level would break:
1. `AdminHeader` can't access `pendingCount` (it's outside the provider tree)
2. `AdminStatsProvider` re-fetches on every `/admin` ↔ `/admin/settings` navigation (different provider instances)
3. `AdminAuthProvider` state doesn't persist across pages

The server layout shell provides: metadata export, layout boundary for Next.js navigation, and the proxy auth gate. The client shell renders header + footer instantly after hydration (no data dependency for initial paint).

#### Phase 3 Architecture Decision Record

| Decision | Choice | Rationale | Source |
|---|---|---|---|
| Auth file convention | **`proxy.ts`** (not `middleware.ts`) | Next.js 16 deprecated `middleware.ts`. `proxy.ts` runs on Node.js runtime by default. Export function is `proxy` (not `middleware`). Setting `runtime` config throws an error — always Node.js. | [Next.js 16 Blog](https://nextjs.org/blog/next-16), [Proxy API](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) |
| Proxy auth strength | **Full `verifyAdmin()` HMAC verification** | Since `proxy.ts` runs on Node.js runtime, `crypto.createHmac`, `crypto.timingSafeEqual`, `Buffer.from` all work natively. No need for cookie-existence-only checks. This provides true server-side auth gating — unauthenticated users never see the admin shell. | [Next.js Auth Guide](https://nextjs.org/docs/app/guides/authentication) |
| Provider placement | **Stay in layout** (`AdminClientShell`) | `AdminHeader` needs `pendingCount` from `AdminStatsProvider`. Stats must persist across `/admin` ↔ `/admin/settings` navigation (single provider instance, 15s auto-refresh, no re-fetch). Official Next.js docs recommend this pattern: server layout imports client shell with providers. | [Next.js Composition Patterns](https://nextjs.org/docs/app/building-your-application/rendering/composition-patterns#using-context-providers) |
| `EncryptionBanner` in settings layout | **CLIENT component, reads context directly** | **Must be refactored** (task 3.6): current code receives `encryptionEnabled` as a prop from parent, but the settings layout is a server component that can't pass client context as a prop. Refactor: component calls `useAdminStats()` directly to read `encryptionEnabled` from context. **Context propagation confirmed**: `AdminClientShell` → providers → `{children}` (includes settings layout) → `EncryptionBanner` reads context. Provider is ancestor in render tree. | [Next.js Interleaving](https://nextjs.org/docs/app/getting-started/server-and-client-components#interleaving-server-and-client-components) |
| Proxy redirect strategy | **`/admin` root ALWAYS passes through + sub-path redirect + cookie cleanup** | If proxy redirects ALL `/admin/*` without auth, visiting `/admin` creates an infinite redirect loop — especially with expired tokens (7-day TTL). Fix: `/admin` root → `NextResponse.next()` **unconditionally** (login card renders via `AdminClientShell`); `/admin/*` sub-paths without valid token → redirect to `/admin` + clear expired cookie (`maxAge: 0`). Cookie cleanup prevents the client-side auth check from seeing a bad cookie. | Source code verification |
| What server layout provides | **Metadata + layout boundary + proxy auth gate** | The server layout exports `robots: noindex`, provides the layout boundary for Next.js navigation preservation, and the proxy prevents login flash with full HMAC verification. | [Next.js Layouts](https://nextjs.org/docs/app/building-your-application/routing/layouts-and-templates) |
| Hydration mismatch prevention | **`initialData` props from server** | Pass server-fetched auth state as props to client components so initial client render matches server render. Officially documented as the canonical pattern. | [Next.js Server-to-Client Props](https://nextjs.org/docs/app/building-your-application/rendering/composition-patterns#passing-props-from-server-to-client-components) |

**Verification**:
- Visit `/admin` without cookie → login card renders (proxy lets `/admin` root through unconditionally — no redirect loop)
- Visit `/admin` with expired cookie → login card renders (proxy lets `/admin` root through unconditionally — expired cookie cleared by client-side auth)
- Visit `/admin/settings` without cookie → redirect to `/admin` (login card) + expired cookie cleared
- Login → cookie set → visit `/admin` → dashboard renders
- View page source → `<meta name="robots" content="noindex">` present
- Logout → `admin_token` cookie cleared → visit `/admin` → login card renders again
- Admin layout is a server component (no `'use client'` on first line of `admin/layout.tsx`)
- View page source of `/admin` → metadata visible without JS. Header/footer are client-rendered (AdminClientShell).
- View page source of `/admin/settings` → `<h2>Settings</h2>` visible without JS (nested layout shell)
- Navigate `/admin` ↔ `/admin/settings` → layout shell preserved, no remount flicker
- `proxy.ts` uses `verifyAdmin()` directly (Node.js runtime, no Edge limitation)

---

### Phase 4: Home Page SSR (Priority: 🟡 Medium)

**Duration**: ~3-4 hours
**Risk**: Medium — splits the home page, hydration mismatch risk

#### ⚠️ Submitter Session Cookie & Hydration Strategy

**Cookie name**: `menfess_session` (defined in `twitter-auth.ts:247` as `SESSION_COOKIE_NAME`)

**Server component reads it via**:
```typescript
import { cookies } from 'next/headers'
import { verifySessionToken, getSubmitterFromNextRequest } from '@/lib/twitter-auth'

const submitterInfo = await getSubmitterFromNextRequest(request)
// Returns { id, username, displayName, profileImage, twitterId, customLimits } | null
// Note: field is `id` (not `submitterId`), plus 4 additional fields beyond just id/username
```

**`verifySessionToken` uses Node-only APIs** (`crypto.createHmac`, `crypto.timingSafeEqual`, `Buffer.from`) — this is fine because server components run in Node runtime (not Edge). No Edge Runtime concern here.

**Hydration mismatch prevention**: If the server renders authenticated UI but the client starts with `isChecking: true`, you get a flash. The canonical solution:
1. Server renders the authenticated UI (form visible)
2. Client component receives `initialSubmitter` prop
3. `useSubmitterAuth` **immediately sets** its internal state to match (no `isChecking` phase)
4. First `checkAuth()` call is skipped when `initialSubmitter` is provided

| # | Task | ID | File(s) | Change |
|---|---|---|---|---|
| 4.1 | Convert `page.tsx` to server component | A-7, M-8 | `src/app/page.tsx` | Remove `'use client'`. Read `menfess_session` cookie via `getSubmitterFromNextRequest()` — returns `{ id, username, displayName, profileImage, twitterId, customLimits } | null` (note: field is `id`, not `submitterId`). Fetch initial limits from DB. Render SEO content server-side. |
| 4.2 | Extract `home-client.tsx` | — | New `src/app/home-client.tsx` | `'use client'` — contains all current interactive logic. Accepts `initialSubmitter`, `initialLimits` props. |
| 4.3 | Update `useSubmitterAuth` to accept `initialData` | — | `use-submitter-auth.ts` | If `initialSubmitter` provided, skip first `checkAuth()` call. **Immediately set** `isChecking=false`, `submitter=initialSubmitter` — no hydration flash |
| 4.4 | Update `useMyPosts` to accept `initialData` | — | `use-my-posts.ts` | If `initialLimits` provided, use as initial state — skip first fetch |
| 4.5 | Move `<motion.div>` from page to client | — | `page.tsx` → `home-client.tsx` | Framer Motion requires `'use client'` |

**Architecture after Phase 4**:

```
page.tsx (SERVER) — no 'use client'
  ├─ import { cookies } from 'next/headers'
  ├─ import { db } from '@/lib/db'
  ├─ import { getSubmitterFromNextRequest } from '@/lib/twitter-auth'
  │
  ├─ Read menfess_session cookie → getSubmitterFromNextRequest()
  │   → returns { id, username, displayName, profileImage, twitterId, customLimits } | null
  ├─ If authenticated: query DB for user's limits
  │
  ├─ Render SEO content (server-rendered HTML):
  │   <div className="min-h-screen flex flex-col bg-[#F7F9F9]">
  │     <h2 className="text-2xl font-bold ...">Kirim Pesan Anonim</h2>
  │     <p className="text-[#536471]">Tulis pesanmu...</p>
  │
  ├─ <HomeClient
  │     initialSubmitter={submitterInfo}
  │     initialLimits={limits}
  │   />
  │
  ├─ <TrustBadges />  ← server component
  └─ <Footer />       ← server component

metadata export:
  title, description, openGraph, twitter card
```

**What search engines see**: Full HTML with heading, description, trust badges, footer. No JS required for content.

**What logged-in users see**: Instant form (no loading flash) because `initialSubmitter` is pre-populated and `useSubmitterAuth` skips `isChecking`.

**What changes for interaction**: Nothing. Client takes over after hydration. Same hooks, same polling, same countdowns.

**Verification**:
- `curl http://localhost:3000/` → full HTML with `<h2>Kirim Pesan Anonim</h2>` visible (no JS needed)
- Lighthouse SEO score improvement (check with Chrome DevTools)
- Logged-in user → form visible immediately, no skeleton flash
- `useSubmitterAuth` → if `initialSubmitter` provided, `isChecking` starts as `false`
- My posts → if `initialLimits` provided, cooldown countdown starts immediately

---

### Phase 5: Complexity Reduction (Priority: 🟡 Medium)

**Duration**: ~4-6 hours
**Risk**: 🟡 Medium — structural decomposition of high-CCN components involves significant inter-component communication changes (shared state, callbacks). While behavior doesn't change, the structural changes are non-trivial for components like `ApiFallbackCard` (CCN 26, 316 lines → 4 sub-components).
**Prerequisite**: Phases 0-1 should be done first (they change some of the same files)

| # | Task | File | Current CCN | Target CCN | Strategy |
|---|---|---|---|---|---|
| 5.1 | Decompose `GET /api/submissions` | `submissions/route.ts` | 36 | ≤ 12 | Extract `buildWhereClause`, `computePagination`, `formatResponse` |
| 5.2 | Decompose `POST /api/admin/settings` | `settings/route.ts` | 36 | ≤ 10 | Handler map pattern — `settingHandlers[key]` |
| 5.3 | Decompose `ApiFallbackCard` | `api-fallback-card.tsx` | 26 | ≤ 12 | Extract `<PostMethodSection>`, `<V2LoginSection>`, `<CredentialFields>`, `<ApiKeySection>` |
| 5.4 | Decompose `ConnectionBanner` | `connection-banner.tsx` | 25 | ≤ 10 | Extract `<CookieStatusBanner>`, `<ApiLoginBanner>` |
| 5.5 | Decompose `GeminiCard` | `gemini-card.tsx` | 18 | ≤ 10 | Extract `<GeminiToggle>`, `<GeminiKeyInput>`, `<GeminiModelInput>` |
| 5.6 | Decompose `SubmissionCard` | `submission-card.tsx` | 20 | ≤ 12 | Extract `<CardActions>`, `<StatusBadge>` |
| 5.7 | Decompose `checkJualan` | `content-filter-checks.ts` | 23 | ≤ 12 | Extract sub-check pure functions |
| 5.8 | Decompose `autopost/route.ts` GET | `autopost/route.ts` | 22 | ≤ 12 | Extract `selectPostMethod`, `executeAndRecord` |
| 5.9 | Decompose `auth/twitter/callback` GET | `callback/route.ts` | 21 | ≤ 12 | Extract `exchangeOAuthCode`, `createOrUpdateSubmitter` |
| 5.10 | Decompose `submitters/limits` PATCH | `limits/route.ts` | 21 | ≤ 12 | Extract per-limit validation + update helpers |
| 5.11 | Refactor `twitter-v2-login.ts` | `twitter-v2-login.ts` | 17-20 (3 fns) | ≤ 12 each | Extract common retry/error logic |
| 5.12 | Decompose `classifyApiError` | `twitter-cookie-api.ts` | 20 | ≤ 12 | Error type lookup map — replace if/else chain with `Map<string, ApiErrorClass>` or object literal. **Lizard parser merge bug**: Lizard merges `classifyApiError` (lines 41-73, actual CCN ~11) with `validateCookieApiPrereqs` (lines 81-125) into one reported function with CCN 20. The actual `classifyApiError` CCN is ~11 (already under 15). The decomposition must reduce the **merged** report to ≤ 15. Approach: either (a) add explicit return type annotation or `export` to help Lizard detect function boundaries, or (b) decompose both functions so that even the merged CCN drops below 15. |

**Rules for decomposition**:
1. Extracted functions live in the **same file** unless they're shared across files
2. Extracted UI components live in the **same directory** as the parent
3. Each extracted function/component: **≤ 60 NLOC, CCN ≤ 15**
4. No new directories — keep flat structure
5. Run `lizard` after each decomposition to verify CCN target met
6. **No backward-compat shims** — when renaming/removing an export, update all consumers immediately. Do not add aliases, deprecated wrappers, or compat layers. If a prop/hook return/component name changes, every import site changes in the same PR.

---

## 7. File Map — Before & After

### New Files Created

| File | Phase | Type | Lines (est.) | Purpose |
|---|---|---|---|---|
| `src/app/robots.ts` | 2 | Server | ~12 | Crawl directives |
| `src/app/sitemap.ts` | 2 | Server | ~10 | Sitemap for search engines |
| `src/app/not-found.tsx` | 2 | Server | ~20 | Branded 404 page |
| `src/app/error.tsx` | 2 | Client | ~18 | Global error boundary |
| `src/proxy.ts` | 3 | Server (Node.js) | ~20 | Auth gate for `/admin/*` — full verifyAdmin() HMAC check |
| `src/app/admin/_client-shell.tsx` | 3 | Client | ~80 | `AdminClientShell` — providers + header + footer, wraps `{children}` |
| `src/app/admin/admin-login-dialog.tsx` | 3 | Client | ~60 | Extracted login gate |
| `src/app/admin/settings/layout.tsx` | 3 | Server | ~25 | Settings header (server HTML) + EncryptionBanner (client island) — nested layout shell |
| `src/app/home-client.tsx` | 4 | Client | ~100 | Extracted from current `page.tsx` |

### Files Modified

| File | Phase | Changes |
|---|---|---|
| `src/hooks/use-posting-settings.ts` | 0 | Route empty values to `apiClient.deleteSetting()` in `saveSetting` (~5 lines) |
| `src/contexts/admin-auth-context.tsx` | 0 | Wire resetState (5 lines) |
| `src/app/admin/settings/page.tsx` | 0+1 | try/finally (4 lines), separate loading states (10 lines) |
| `src/components/settings/filter-card.tsx` | 0+1 | Remove setFilterRules prop (4 lines), auto-save toggles (10 lines) |
| `src/hooks/use-submissions.ts` | 0 | Remove unused `loadMore`, `total` returns (3 lines) |
| `src/hooks/use-submitters.ts` | 0 | Remove unused `search`, `setSearch` returns (3 lines) |
| `src/components/dashboard/users-dialog.tsx` | 0+1 | Fix animation (3 lines), mobile responsive (12 lines) |
| `src/components/settings/api-fallback-card.tsx` | 1+5 | Migrate toggles to spinner+toast (24 lines), then decompose |
| `src/components/settings/gemini-card.tsx` | 1+5 | Add loading states (15 lines), then decompose |
| `src/components/dashboard/submission-card.tsx` | 1+5 | AlertDialog (20 lines), then decompose |
| `src/lib/twitter-api-credits.ts` | 2 | Don't cache errors (5 lines) |
| `src/app/api/admin/stats/route.ts` | 2 | Add `?refresh=true` param → call `invalidateCreditsCache()` before `getApiCreditsNonBlocking()` (5 lines) |
| `src/lib/api-client.ts` | 2 | Add `getStats(options?: { refresh?: boolean })` — append `?refresh=true` when `refresh: true` (3 lines) |
| `src/app/layout.tsx` | 2 | Add OG + Twitter metadata (15 lines) |
| `src/app/admin/layout.tsx` | 3 | Convert to server component layout shell + `AdminClientShell` wrapper, add metadata |
| `src/components/dashboard/encryption-banner.tsx` | 3 | Remove `encryptionEnabled` prop, call `useAdminStats()` directly (task 3.6) |
| `src/app/admin/settings/page.tsx` | 3 | Extract header/encryption banner into settings layout, remove `encryptionEnabled` prop from `<EncryptionBanner />` |
| `src/app/admin/page.tsx` | 3 | Remove `encryptionEnabled` prop from `<EncryptionBanner />` (task 3.6) |
| `src/app/page.tsx` | 4 | Convert to server component, add DB fetch |
| `src/hooks/use-submitter-auth.ts` | 4 | Accept initialData param |
| `src/hooks/use-my-posts.ts` | 4 | Accept initialData param |

### Files NOT Changed (Layout Preservation)

The following are explicitly **not changed** — they maintain their current visual layout:

- All CSS class names for layout structure
- Color palette (`#0F1419`, `#536471`, `#F7F9F9`, etc.)
- Footer content and structure
- Header component APIs (props in/out)
- Card component boundaries (which settings go in which card)
- Tab structure (Posting, Filter, Users, Limits)
- Dialog structure (Users dialog keeps same content, just responsive fixes)
- `user-list-card.tsx` — already has proper loading states, no changes needed

---

## 8. Verification Checklist

### Per-Phase Verification

#### Phase 0 — Bug Fixes
- [ ] B-1: Click "Clear Query ID" ↺ button → toast "Setting deleted" → input clears → DB entry removed
- [ ] M-2: Login as admin → go to settings → change some settings → logout → login as different admin → no stale values flash
- [ ] L-9: Click Credit Refresh → if API fails, spinner stops (not stuck)
- [ ] M-1: `setFilterRules` removed from FilterCardProps — no TypeScript errors
- [ ] L-1/L-6: No unused returns — `bun run lint` passes
- [ ] L-8: UsersDialog refresh button shows RefreshCw spinning counterclockwise (not Loader2)
- [ ] `bun run lint` — zero errors
- [ ] `lizard /home/z/my-project/src -l tsx -l ts -w` — no new warnings

#### Phase 1 — Consistency
- [ ] All toggles auto-save: toggle any switch → toast appears → refresh page → state persisted
- [ ] No optimistic updates: disconnect network → toggle switch → stays in old state + error toast
- [ ] Gemini Save Key: click while saving → spinner shown → button disabled → no double-submit
- [ ] Rate Limit save: click "Simpan" on RateLimitCard → only that card's button spins, CircuitBreaker unaffected
- [ ] Mobile responsive: open Pengguna dialog on 375px → buttons icon-only, grid single-column, no overflow
- [ ] Delete: click × → AlertDialog appears → confirm → submission deleted → toast
- [ ] Gemini toggle: uses canonical `checked` value, not `!geminiEnabled`
- [ ] 1.11: `rg "fetch.*api/admin" src/components/` → 0 raw fetch calls
- [ ] `lizard` — no new warnings from refactored files

#### Phase 2 — Credits + SEO
- [ ] Credits: if external API unreachable → error shown → click Refresh → cache cleared → fresh fetch attempted
- [ ] Credits: if fetch succeeds → result cached → next load instant from cache
- [ ] Credits: error results NOT cached → next load re-fetches
- [ ] `GET /robots.txt` → Allow: /, Disallow: /admin, Disallow: /api
- [ ] `GET /sitemap.xml` → valid XML with `<url><loc>https://...</loc></url>`
- [ ] Visit `/nonexistent` → branded 404 with "Kembali ke beranda" link
- [ ] Trigger React error → error boundary shows "Terjadi kesalahan" + "Coba Lagi" button
- [ ] Share URL on WhatsApp → rich card with title, description, image
- [ ] `bun run lint` — zero errors

#### Phase 3 — Proxy Auth + Layout Shells
- [ ] Visit `/admin` without cookie → login card renders (no redirect loop — proxy lets `/admin` root through unconditionally)
- [ ] Visit `/admin` with **expired** cookie → login card renders (proxy lets `/admin` root through — expired cookie NOT in redirect response, client-side auth clears it)
- [ ] Visit `/admin/settings` without cookie → redirect to `/admin` (login card) + expired cookie cleared
- [ ] Visit `/admin/settings` with expired cookie → redirect to `/admin` + expired cookie cleared (`maxAge: 0`)
- [ ] Login → cookie set → visit `/admin` → dashboard renders
- [ ] View page source → `<meta name="robots" content="noindex, nofollow">` present
- [ ] Logout → cookie cleared → visit `/admin` → login card renders again (no loop)
- [ ] Admin layout is a server component (no `'use client'` on first line) — metadata streams in HTML
- [ ] View page source of `/admin` → `<meta name="robots" content="noindex">` visible without JS. Header/footer are client-rendered (in `AdminClientShell`).
- [ ] View page source of `/admin/settings` → `<h2>Settings</h2>` visible without JS (nested layout shell streams header)
- [ ] Navigate `/admin` ↔ `/admin/settings` → layout shell preserved, no remount flicker
- [ ] `AdminAuthProvider` and `AdminStatsProvider` stay in layout via `AdminClientShell` (not page-level) — `AdminHeader` can access `pendingCount`
- [ ] `admin/settings/layout.tsx` is a server component (no `'use client'`) — `<h2>`/`<p>` stream as server HTML
- [ ] `<EncryptionBanner />` calls `useAdminStats()` directly (no `encryptionEnabled` prop) — verified in both dashboard and settings views
- [ ] `bun run lint` — zero errors
- [ ] `lizard` — no new warnings

#### Phase 4 — Home Page SSR
- [ ] `curl http://localhost:3000/` → HTML contains `<h2>Kirim Pesan Anonim</h2>` (no JS needed)
- [ ] `curl` → HTML contains `<p>Tulis pesanmu` text
- [ ] `curl` → HTML contains trust badges and footer
- [ ] Lighthouse SEO audit → score ≥ 90
- [ ] Logged-in user → visit `/` → form visible immediately (no skeleton flash)
- [ ] `isChecking` starts as `false` when `initialSubmitter` provided
- [ ] Polling still works (30s auto-refresh for non-terminal posts)
- [ ] Countdown still works (live seconds countdown)
- [ ] `page.tsx` is a server component (no `'use client'`)
- [ ] `home-client.tsx` has `'use client'`
- [ ] `bun run lint` — zero errors
- [ ] `lizard` — no new warnings

#### Phase 5 — Complexity Reduction
- [ ] `lizard /home/z/my-project/src -l tsx -l ts -C 15 -w` → **0 warnings** (was 17)
- [ ] No function exceeds CCN 15
- [ ] No function exceeds 60 NLOC
- [ ] All existing tests still pass (if any)
- [ ] Visual regression: all pages look identical to before
- [ ] `bun run lint` — zero errors

### Final Validation

- [ ] All items from audit report addressed
- [ ] All bugs fixed (B-1 ✅)
- [ ] All medium issues resolved (M-1 through M-8 ✅)
- [ ] All remaining low issues resolved (L-1, L-3, L-4, L-6, L-8, L-9, L-10–L-14 ✅)
- [ ] Already-fixed items verified (L-2, L-5 ✅)
- [ ] All architecture gaps closed (A-1 through A-10 ✅)
- [ ] All write actions use spinner + toast (no optimistic updates)
- [ ] All toggles auto-save consistently
- [ ] All refresh buttons use RefreshCw + animate-spin-reverse
- [ ] Mobile responsive on all dialogs
- [ ] Server components used where possible (home page, admin layout)
- [ ] Lizard complexity: 0 warnings (CCN ≤ 15 everywhere)
- [ ] `bun run lint` — zero errors
- [ ] No layout changes — visual appearance identical

---

## 9. Clean Up — Dead Code, Unused Exports & Files

Everything below is dead, unused, or unnecessary code found during source-code validation. Removing it reduces bundle size, eliminates confusion, and keeps lint clean.

### 9.1 Dead Props

| What | File | Line | Notes |
|---|---|---|---|
| `setFilterRules` prop | `filter-card.tsx` | 27, 61 | Destructured but never called — `toggleRule` is used instead. Remove from props interface + pass-through in `settings/page.tsx`. (M-1) |

### 9.2 Unused Hook Returns

| What | File | Line | Notes |
|---|---|---|---|
| `loadMore` | `use-submissions.ts` | 268 | Returned but never consumed by any component. (L-1) |
| `total` | `use-submissions.ts` | 278 | Returned but never consumed. (L-1/L-7) |
| `search` | `use-submitters.ts` | 88 | Returned but never consumed. (L-6) |
| `setSearch` | `use-submitters.ts` | 93 | Returned but never consumed. (L-6) |

### 9.3 Unused API Methods

| What | File | Line | Notes |
|---|---|---|---|
| `deleteSetting()` | `api-client.ts` | 174 | Exists but never called from frontend — however it IS the correct fix for B-1 (should replace `saveSetting('x_query_id', '', ...)`). After B-1 fix, this method will be in use, so **do not remove**. |

### 9.3.1 Rogue fetch() bypassing apiClient

| What | File | Line | Notes |
|---|---|---|---|
| Raw `fetch('/api/admin/gemini-status')` | `gemini-card.tsx` | 63 | Bypasses `apiClient` — no centralized error handling, no `validateApiPath()` guard. Should use `apiClient.getGeminiStatus()` (or add the method). Not a security issue (server-side `verifyAdmin` still protects the route), but a code hygiene / consistency issue. |

### 9.4 Potentially Unused Files

These files exist in `src/` but may not be imported by any page/component. Verify with `grep` before deleting.

| File | Suspected Dead | Verify |
|---|---|---|
| `src/lib/twitter-api-fallback.ts` | Barrel re-export file — 5 consumers import from it | Keep — active coupling point. Refactor target is `twitter-api-credits.ts` (the actual implementation). |
| `src/hooks/use-circuit-breaker.ts` | Used by `settings/page.tsx` | Keep |
| `src/components/ui/*` | shadcn/ui primitives | Keep all — used by various components |

> **Rule**: Before deleting any file, run `rg <filename-stem> src/` to confirm zero references. If references exist, keep the file.

### 9.5 Cleanup Execution Plan

Cleanups are folded into existing phases to avoid a separate phase:

| Cleanup | Phase | Task # | Action |
|---|---|---|---|
| Remove `setFilterRules` prop | 0 | 0.4 | Delete from props interface + pass-through |
| Remove `loadMore`, `total` from `use-submissions` | 0 | 0.5 | Stop returning them from the hook |
| Remove `search`, `setSearch` from `use-submitters` | 0 | 0.5 | Stop returning them from the hook |
| Move `gemini-card.tsx:63` raw `fetch()` to `apiClient` method | 1 | 1.11 | Add `getGeminiStatus()` to apiClient, replace raw fetch — consistency + centralized error handling |
| Verify & delete any truly unused files | 5 | 5.12 | `rg` sweep before final merge |

### 9.6 Verification

- [ ] `rg 'setFilterRules' src/` → 0 results (after Phase 0)
- [ ] `rg 'loadMore' src/` → 0 results (after Phase 0)
- [ ] `rg 'setSearch' src/hooks/` → 0 results (after Phase 0)
- [ ] `rg "fetch.*api/admin" src/components/` → 0 raw fetch calls (after Phase 1)
- [ ] `bun run lint` — zero unused-variable warnings
- [ ] No orphan files in `src/` (verified by `rg` sweep in Phase 5)

---

## Appendix A: Pattern Reference

### A.1 Spinner + Toast (Canonical Write Pattern)

```typescript
// Use this for EVERY write action (save, toggle, delete, etc.)
const [isSaving, setIsSaving] = useState(false)

const handleSave = useCallback(async () => {
  setIsSaving(true)
  try {
    const result = await apiClient.someAction()
    setSomeState(result.newValue)  // Update UI only on success
    toast({ title: 'Berhasil!' })
  } catch (err) {
    const message = err instanceof ApiError ? err.message : 'Gagal'
    toast({ title: 'Gagal', description: message, variant: 'destructive' })
    // UI state unchanged — no revert needed
  } finally {
    setIsSaving(false)
  }
}, [/* deps */])

// Button
<Button onClick={handleSave} disabled={isSaving}>
  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Simpan'}
</Button>
```

### A.2 Auto-Save Toggle (Canonical Pattern)

```typescript
const [isSaving, setIsSaving] = useState(false)

const handleToggle = useCallback(async (checked: boolean) => {
  setIsSaving(true)
  try {
    await apiClient.saveFilterSettings({ someToggle: checked })
    setSomeToggle(checked)  // Update UI only on success
    toast({ title: `Setting: ${checked ? 'ON' : 'OFF'}` })
  } catch {
    toast({ title: 'Gagal', description: 'Failed to update', variant: 'destructive' })
    // someToggle unchanged
  } finally {
    setIsSaving(false)
  }
}, [/* deps */])

// Switch
<Switch
  checked={someToggle}
  onCheckedChange={handleToggle}
  disabled={isSaving}
/>
{isSaving && <Loader2 className="w-3 h-3 animate-spin" />}
```

### A.3 RefreshCw Animation (Canonical Pattern)

```tsx
// Use this for EVERY refresh button — never swap to Loader2
<RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin-reverse' : ''}`} />
```

### A.4 Server Component Page (Canonical Pattern)

```tsx
// page.tsx — SERVER COMPONENT (no 'use client')
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { HomeClient } from './home-client'

export const metadata = {
  title: '...',
  openGraph: { ... },
}

export default async function Page() {
  // Read auth from cookie — no API route needed
  const sessionCookie = (await cookies()).get('session')?.value
  let initialSubmitter = null
  let initialLimits = null

  if (sessionCookie) {
    // Direct DB query — no API route needed
    const session = await verifySession(sessionCookie)
    if (session) {
      initialSubmitter = await getSubmitterInfo(session.userId)
      initialLimits = await getLimitsForUser(session.userId)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F9F9]">
      {/* SEO content — server-rendered, no JS needed */}
      <h2 className="text-2xl font-bold ...">Kirim Pesan Anonim</h2>
      <p className="text-[#536471]">Tulis pesanmu...</p>

      {/* Client island — takes over after hydration */}
      <HomeClient initialSubmitter={initialSubmitter} initialLimits={initialLimits} />

      <TrustBadges />
      <Footer />
    </div>
  )
}
```

### A.5 Delete Confirmation (Canonical Pattern)

```tsx
// Replace window.confirm() with AlertDialog
<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button variant="ghost" size="sm"><X className="w-4 h-4" /></Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Hapus pesan ini?</AlertDialogTitle>
      <AlertDialogDescription>Pesan akan dihapus permanen.</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Batal</AlertDialogCancel>
      <AlertDialogAction onClick={() => onDelete(id)} className="bg-red-600">Hapus</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

---

## Appendix B: Complexity Targets

### Before (17 warnings)

```
Total NLOC: 13,750 | Avg CCN: 2.9 | Warnings: 17
```

### After (target: 0 warnings)

| File | Function | Before CCN | After CCN | Decomposition |
|---|---|---|---|---|
| `submissions/route.ts` | GET | 36 | ≤ 12 | 3 helpers extracted |
| `settings/route.ts` | POST | 36 | ≤ 10 | Handler map pattern |
| `api-fallback-card.tsx` | ApiFallbackCard | 26 | ≤ 12 | 4 sub-components |
| `connection-banner.tsx` | ConnectionBanner | 25 | ≤ 10 | 2 sub-components |
| `content-filter-checks.ts` | checkJualan | 23 | ≤ 12 | Sub-check functions |
| `submitters/limits/route.ts` | PATCH | 21 | ≤ 12 | Validation helpers |
| `auth/twitter/callback/route.ts` | GET | 21 | ≤ 12 | OAuth + user helpers |
| `autopost/route.ts` | GET | 22 | ≤ 12 | Post method + execution helpers |
| `submission-card.tsx` | SubmissionCard | 20 | ≤ 12 | Actions + badge sub-components |
| `twitter-v2-login.ts` | loginViaTwitterApi | 20 | ≤ 12 | Common retry/error logic |
| `twitter-cookie-api.ts` | classifyApiError | 20 | ≤ 12 | Error type map |
| `twitter-v2-login.ts` | getApiLoginStatus | 20 | ≤ 12 | Status check helpers |
| `gemini-card.tsx` | GeminiCard | 18 | ≤ 10 | 3 sub-components |
| `execute-post.ts` | executePostAndRecord | 18 | ≤ 12 | Execution + recording helpers |
| `filter-settings/route.ts` | POST | 18 | ≤ 12 | Field validation map |
| `twitter-v2-login.ts` | postViaTwitterApi | 17 | ≤ 12 | Common retry/error logic |
| `page.tsx` | (anonymous) | 19 | ≤ 10 | Server component + client child |

**Verification command**: `lizard /home/z/my-project/src -l tsx -l ts -C 15 -w`

---

## Appendix C: Risk Assessment

| Phase | Risk Level | Revert Difficulty | What Could Go Wrong |
|---|---|---|---|
| Phase 0 | 🟢 Zero | Trivial — 3-line edits | Wrong variable name — caught by TypeScript |
| Phase 1 | 🟢 Low | Easy — pattern changes only | Toggle doesn't save — caught by manual testing |
| Phase 2 | 🟢 Zero | Trivial — new files + metadata | Wrong metadata format — caught by `bun run lint` |
| Phase 3 | 🟢 Low | Easy — proxy + layout split | Proxy misconfig blocks access or creates redirect loop (especially with expired tokens after 7-day TTL) — test with: no cookie, valid cookie, expired cookie, on both `/admin` root and `/admin/settings`. Loop prevention built into task 3.1 (root pass-through unconditional + cookie cleanup on redirect). Risk lower than expected because proxy.ts runs on Node.js runtime (no Edge Runtime gotchas). |
| Phase 4 | 🟡 Medium | Moderate — page split | initialData not passed correctly — form shows skeleton when it shouldn't |
| Phase 5 | 🟡 Medium | Moderate — structural decomposition | Decomposing high-CCN components (e.g. `ApiFallbackCard` CCN 26 → 4 sub-components) involves non-trivial inter-component communication changes (shared state, callbacks). While behavior doesn't change, the structural refactoring is significant. Risk mitigated by: each decomposition is independent, TypeScript catches interface mismatches, visual regression testing confirms no UI changes. |

**Mitigation**: Each phase is independently deployable. If a phase causes issues, it can be reverted without affecting previous phases. No phase depends on a later phase for correctness.

---

## Appendix D: Cookie Auth Architecture (Verified)

### Admin Auth

| Aspect | Value |
|---|---|
| Cookie name | `admin_token` |
| Type | HttpOnly (set by server) |
| Set by | `POST /api/admin/login` → `res.cookies.set('admin_token', token, { httpOnly: true, ... })` |
| Verified by | `verifyAdmin(token)` in `admin-auth.ts` — HMAC + timing-safe comparison |
| TTL | 7 days (`ADMIN_TOKEN_TTL = 7 * 24 * 60 * 60`) |
| Server-readable | ✅ `cookies().get('admin_token')?.value` |
| Middleware-ready | ✅ `proxy.ts` runs on **Node.js runtime** (Next.js 16+) — `verifyAdmin()` works natively. No Edge Runtime limitation. |

### Submitter Auth

| Aspect | Value |
|---|---|
| Cookie name | `menfess_session` (defined as `SESSION_COOKIE_NAME` in `twitter-auth.ts:247`) |
| Type | HttpOnly (set by server) |
| Set by | `/api/auth/set-session` (called after OAuth callback at `twitter-auth.ts`) |
| Server-readable | ✅ `cookies().get('menfess_session')?.value` |
| Verified by | `verifySessionToken(token)` in `twitter-auth.ts` — HMAC + timing-safe comparison (Node-only, NOT Edge Runtime compatible — fine for server components which run in Node) |
| Helper function | `getSubmitterFromNextRequest(request)` — reads cookie + verifies + returns `{ id, username, displayName, profileImage, twitterId, customLimits }` or `null` (note: field is `id`, not `submitterId`) |

**Key insight**: No cookie migration is needed. Both auth flows are already cookie-based and server-readable. This was incorrectly stated in the original audit as a blocker for SSR — it is not. The `menfess_session` cookie name was incorrectly documented as `session` in v4.0 — corrected in v4.1.

**⚠️ Hydration flash trap**: `verifySessionToken` uses Node-only APIs (`crypto.createHmac`, `crypto.timingSafeEqual`, `Buffer.from`), same as `verifyAdmin`. However, unlike the old Edge Runtime middleware, **server components run in Node runtime** — so this is NOT a problem for Phase 4 home page SSR. (And in Next.js 16, `proxy.ts` also runs on Node.js runtime, so even proxy-side session verification is possible.) The hydration mismatch risk is mitigated by passing `initialSubmitter` prop to `HomeClient` so `useSubmitterAuth` skips its `isChecking` phase (see Phase 4 tasks 4.2-4.3).

---

*End of plan. All findings verified against source code as of commit `5e1d411`. Architecture decisions verified against Next.js 16 official documentation (nextjs.org/blog/next-16, nextjs.org/docs/app/api-reference/file-conventions/proxy, nextjs.org/docs/app/guides/authentication). v5.3 fixes handler count (19 total, not 20) and B-1 feasibility gap (hook routes empty values to deleteSetting). v5.2 fixed proxy expired-token loop and logout verifyAdmin claim. v5.1 added 6 source-code-verified corrections to v5.0.*
