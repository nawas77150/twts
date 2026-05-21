# Hybrid SSR + CSR UI/UX Refactor Plan — v5.4

> **Status**: ✅ Execution-ready — verified through 5 iterations (v2.0 → v5.4), 0 issues found in v5.4  
> **Date**: 2025-01  
> **Commit baseline**: `5e1d411`  
> **Framework**: Next.js ^16.1.1 (App Router, proxy.ts replaces middleware.ts, Node.js runtime)

---

## Table of Contents

1. [Architecture Decisions](#architecture-decisions)
2. [Implementation Phases](#implementation-phases)
3. [Phase 0 — Critical Bug Fixes](#phase-0--critical-bug-fixes)
4. [Phase 1 — Consistency Fixes](#phase-1--consistency-fixes)
5. [Phase 2 — Credits Cache + SEO Quick Wins](#phase-2--credits-cache--seo-quick-wins)
6. [Phase 3 — proxy.ts + Admin SSR Shell](#phase-3--proxyts--admin-ssr-shell)
7. [Phase 4 — Homepage SSR](#phase-4--homepage-ssr)
8. [Phase 5 — Complexity Decomposition](#phase-5--complexity-decomposition)
9. [Bug Catalog](#bug-catalog)
10. [Verification History](#verification-history)

---

## Architecture Decisions

### 1. Next.js 16 proxy.ts (replaces middleware.ts)

- **Runtime**: Node.js (default) — NOT Edge Runtime
- **Why**: `verifyAdmin()` in `src/lib/admin-auth.ts` uses `crypto.createHmac`, `crypto.timingSafeEqual`, `Buffer.from` — all Node-only APIs
- **Deployment**: proxy.ts runs as a Serverless Function on Vercel, covered by Fluid Compute billing; free tier is sufficient
- **File location**: `src/proxy.ts` (Next.js 16 convention)
- **Cookie names**: Admin = `admin_token` (line 32 of admin-auth.ts), Submitter = `menfess_session` (line 247 of twitter-auth.ts)

### 2. Provider Placement

- `AdminAuthProvider` + `AdminStatsProvider` remain in `src/app/admin/layout.tsx` inside `AdminClientShell`
- **Why**: `AdminHeader` (layout-level) needs `pendingCount` from `AdminStatsProvider` for the badge
- Moving providers to page-level would break `AdminHeader`'s access to `pendingCount`
- Current structure verified: layout wraps children with both providers → AdminLayoutInner reads `pendingCount` → passes to `AdminHeader`

### 3. EncryptionBanner Refactor (Task 3.6)

- **Current**: `EncryptionBanner` receives `encryptionEnabled` prop (line 5-7 of encryption-banner.tsx)
- **Target**: Remove prop, component calls `useAdminStats()` directly
- **Impact sites**: 
  - `src/app/admin/page.tsx` line 151: `<EncryptionBanner encryptionEnabled={stats?.encryptionEnabled} />`
  - `src/app/admin/settings/page.tsx` line 118: `<EncryptionBanner encryptionEnabled={stats?.encryptionEnabled} />`
- **Feasibility**: Both usage sites are already inside `AdminStatsProvider` (via layout), so `useAdminStats()` is available

### 4. Proxy Loop Prevention

- `/admin` root path: unconditional pass-through (no redirect check)
- `/admin/*` sub-paths with invalid/expired token → redirect to `/admin` + clear expired `admin_token` cookie
- This prevents infinite redirect loops (invalid token on `/admin/settings` → redirect to `/admin` → pass through without checking)

### 5. B-1 Fix — Empty Setting Value Routing

- **Current bug**: `saveSetting('x_query_id', '', ...)` → API returns 400 because empty value is rejected
- **Fix**: In `usePostingSettings.saveSetting` (line 66-94 of use-posting-settings.ts), detect empty `value` and route to `apiClient.deleteSetting(key)` instead
- `apiClient.deleteSetting` already exists at line 174-176 of api-client.ts

### 6. getSubmitterFromNextRequest Return Type

```typescript
// src/lib/twitter-auth.ts lines 298-305
Promise<{
  id: string
  username: string
  displayName: string | null
  profileImage: string | null
  twitterId: string | null
  customLimits: unknown
} | null>
```

### 7. apiClient.getStats() — Refresh Parameter

- **Current**: `getStats()` takes no parameters (line 159-161 of api-client.ts)
- **Planned**: Add `{ refresh?: boolean }` parameter support for bypassing cache in admin stats endpoint
- Server-side `/api/admin/stats` will check `refresh` query param to skip cached data

### 8. classifyApiError CCN Clarification

- `classifyApiError` (twitter-cookie-api.ts lines 41-73): actual CCN ≈ 11
- lizard parser merges `validateCookieApiPrereqs` (lines 81-125) into the same function scope, reporting CCN ≈ 20 — this is a parser bug, not a real complexity issue
- Both functions are independently decomposable in Phase 5 if desired

---

## Implementation Phases

| Phase | Priority | Risk | Tasks | Est. Changes |
|-------|----------|------|-------|-------------|
| 0 | 🔴 Critical | Zero | 6 surgical bug fixes | ~50 lines |
| 1 | 🟡 High | Low | 11 consistency fixes | ~200 lines |
| 2 | 🟡 High | Zero | Credits cache fix + 7 SEO wins | ~150 lines |
| 3 | 🟡 High | Low-Med | proxy.ts + admin SSR shell + settings layout | ~300 lines |
| 4 | 🟡 Medium | Medium | Homepage SSR (biggest SEO gain) | ~200 lines |
| 5 | 🟡 Medium | Medium | 12 complexity decomposition tasks (CCN ≤ 15) | ~400 lines |

---

## Phase 0 — Critical Bug Fixes

> **Priority**: 🔴 Critical | **Risk**: Zero | **Dependencies**: None

### Task 0.1 — B-1: Clear Query ID Button → 400 Error

**Problem**: `saveSetting('x_query_id', '', ...)` sends empty string to API → 400 rejection

**File**: `src/hooks/use-posting-settings.ts`

**Current code** (line 66-70):
```typescript
const saveSetting = useCallback(async (key: string, value: string, onSuccess?: () => void, onFailure?: () => void) => {
  if (!isAdmin) return
  setSavingKeys(prev => new Set(prev).add(key))
  try {
    const data = await apiClient.saveSetting(key, value)
```

**Fix**: Add empty-value detection before API call:
```typescript
const saveSetting = useCallback(async (key: string, value: string, onSuccess?: () => void, onFailure?: () => void) => {
  if (!isAdmin) return
  setSavingKeys(prev => new Set(prev).add(key))
  try {
    // Empty value → delete the setting instead of saving (API rejects empty values)
    if (!value.trim()) {
      await apiClient.deleteSetting(key)
      toast({ title: `${SETTING_LABELS.get(key) || key} dihapus!` })
      onSuccess?.()
      return
    }
    const data = await apiClient.saveSetting(key, value)
    // ... rest unchanged
```

**Verification**: Clear Query ID button → calls `deleteSetting` → setting removed from DB → no 400

---

### Task 0.2 — M-2: Logout Doesn't Reset State

**Problem**: `logout()` in admin-auth-context.tsx sets `isAdmin = false` but doesn't call `resetState()` on dependent hooks

**File**: `src/contexts/admin-auth-context.tsx`

**Current code** (line 55-59):
```typescript
const logout = useCallback(async () => {
  try { await apiClient.adminLogout() } catch { /* best effort */ }
  setIsAdmin(false)
  toast({ title: 'Logout berhasil' })
}, [toast])
```

**Fix approach**: The admin layout's `AdminStatsProvider` already pauses fetching when `isAdmin` becomes false. The `usePostingSettings().resetState()` and `useFilterSettings()` state will be garbage-collected when the unauthenticated view renders (different component tree). No additional reset needed in the auth context itself.

**Alternative (if stale data flashes on re-login)**: Add a `onLogout` callback prop to the layout that calls resetState on all hooks.

**Decision**: Verify after Phase 0 implementation whether stale data flashes on re-login before adding the callback.

---

### Task 0.3 — L-9: Missing Loading State on Admin Login Button

**Problem**: Login button shows "Memproses..." text but no spinner icon

**File**: `src/app/admin/layout.tsx`

**Current code** (line 89-95):
```typescript
<Button
  onClick={handleLogin}
  disabled={isLoggingIn}
  className="w-full bg-[#0F1419] hover:bg-[#272c30]"
>
  {isLoggingIn ? 'Memproses...' : 'Masuk'}
</Button>
```

**Fix**: Add `Loader2` spinner:
```typescript
<Button
  onClick={handleLogin}
  disabled={isLoggingIn}
  className="w-full bg-[#0F1419] hover:bg-[#272c30]"
>
  {isLoggingIn && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
  {isLoggingIn ? 'Memproses...' : 'Masuk'}
</Button>
```

Add `Loader2` to existing lucide import on line 5: `import { Shield, LogIn, Loader2 } from 'lucide-react'`

---

### Task 0.4 — M-1: ~~Dead Prop~~ `isSavingSetting` — ✅ NO-OP (Code is Correct)

**Original assumption**: `isSavingSetting` was a "dead prop" where consumers treat it as a boolean.

**Actual behavior (verified by audit)**: Consumers use `isSavingSetting` **intentionally as `string | null`** in two correct patterns:

1. **Boolean guard with `!!` coercion** — `disabled={!!isSavingSetting || !apiKeys.trim()}` (correct: any non-null string is truthy)
2. **Per-field spinner key comparison** — `{isSavingSetting === 'x_cookie_string' ? <Loader2 .../> : 'Simpan'}` (intentional: shows spinner only on the specific field being saved)

This is more sophisticated than `isSavingAnySetting` — each Save button gets its own spinner only when *that specific field* is saving, while other fields stay interactive. Prop type is correctly declared as `string | null` in both component interfaces.

**Action**: None required.

---

### Task 0.5 — L-1/L-6: Missing SEO Files

**Problem**: No `not-found.tsx`, `error.tsx`, or dynamic `sitemap.ts`

**Files to create**:
- `src/app/not-found.tsx` — custom 404 page
- `src/app/error.tsx` — global error boundary (client component)
- `src/app/sitemap.ts` — dynamic sitemap generation

**Implementation**:

`src/app/not-found.tsx`:
```typescript
import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F7F9F9] px-4">
      <h1 className="text-4xl font-bold text-[#0F1419] mb-2">404</h1>
      <p className="text-[#536471] mb-6">Halaman tidak ditemukan</p>
      <Link
        href="/"
        className="bg-[#0F1419] hover:bg-[#272c30] text-white px-6 py-2 rounded-lg text-sm font-medium"
      >
        Kembali ke Beranda
      </Link>
    </div>
  )
}
```

`src/app/error.tsx`:
```typescript
'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F7F9F9] px-4">
      <h1 className="text-2xl font-bold text-[#0F1419] mb-2">Terjadi Kesalahan</h1>
      <p className="text-[#536471] mb-6 text-sm">{error.message || 'Sesuatu yang tidak terduga terjadi'}</p>
      <button
        onClick={reset}
        className="bg-[#0F1419] hover:bg-[#272c30] text-white px-6 py-2 rounded-lg text-sm font-medium"
      >
        Coba Lagi
      </button>
    </div>
  )
}
```

`src/app/sitemap.ts`:
```typescript
import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXTAUTH_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${baseUrl}/admin`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ]
}
```

---

### Task 0.6 — L-8: Incomplete OG Metadata

**Problem**: Root layout metadata lacks Open Graph and Twitter Card meta tags

**File**: `src/app/layout.tsx`

**Current** (line 16-23):
```typescript
export const metadata: Metadata = {
  title: "Tweetfess - X Menfess Indonesia",
  description: "Kirim pesan anonim, admin moderasi, otomatis diposting ke X. Menfess gratis untuk komunitas Indonesia.",
  keywords: ["tweetfess", "menfess", "x", "twitter", "confess", "indonesia", "anonim"],
  icons: {
    icon: "/favicon.svg",
  },
};
```

**Fix**: Add `openGraph` and `twitter` fields:
```typescript
export const metadata: Metadata = {
  title: "Tweetfess - X Menfess Indonesia",
  description: "Kirim pesan anonim, admin moderasi, otomatis diposting ke X. Menfess gratis untuk komunitas Indonesia.",
  keywords: ["tweetfess", "menfess", "x", "twitter", "confess", "indonesia", "anonim"],
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "Tweetfess - X Menfess Indonesia",
    description: "Kirim pesan anonim, admin moderasi, otomatis diposting ke X. Menfess gratis untuk komunitas Indonesia.",
    type: "website",
    locale: "id_ID",
    siteName: "Tweetfess",
  },
  twitter: {
    card: "summary",
    title: "Tweetfess - X Menfess Indonesia",
    description: "Kirim pesan anonim, admin moderasi, otomatis diposting ke X. Menfess gratis untuk komunitas Indonesia.",
  },
};
```

---

## Phase 1 — Consistency Fixes

> **Priority**: 🟡 High | **Risk**: Low | **Dependencies**: Phase 0 complete

### Task 1.1 — Spinner + Toast on All Async Actions

**Problem**: Some async actions show toast only, or spinner only. Need consistent pattern: spinner during action + toast on result.

**Files to audit**:
- `src/components/settings/direct-posting-card.tsx` — verify save actions show spinner
- `src/components/settings/api-fallback-card.tsx` — verify save actions show spinner
- `src/components/dashboard/submission-list.tsx` — approve/reject/delete/retry actions
- `src/components/settings/filter-card.tsx` — save filter settings

**Pattern**: Every async action should:
1. Set loading state → show spinner/skeleton
2. Perform action
3. Show success/error toast
4. Clear loading state

---

### Task 1.2 — Auto-Save on Toggle Changes

**Problem**: Toggle switches (auto-approve, Gemini enable, V2 login) require manual save button click

**Files affected**:
- `src/components/settings/filter-card.tsx` — auto-approve toggle
- `src/components/settings/gemini-card.tsx` — Gemini enable toggle
- `src/components/settings/api-fallback-card.tsx` — V2 login toggle

**Fix**: Add `onValueChange` handler that calls save immediately after state update, with debounce for rapid toggles.

---

### Task 1.3 — Mobile Layout Improvements

**Problem**: Some cards/sections have suboptimal mobile layouts

**Files to audit**:
- `src/components/dashboard/stats-grid.tsx` — stats grid on mobile
- `src/components/settings/api-fallback-card.tsx` — settings cards on mobile
- `src/components/dashboard/submission-card.tsx` — action buttons on mobile

**Fix**: Apply responsive breakpoints, stack actions vertically on mobile, ensure 44px touch targets.

---

### Task 1.4 — AlertDialog for Destructive Actions

**Problem**: Delete submission uses `window.confirm` instead of styled AlertDialog

**File**: `src/components/dashboard/submission-list.tsx`

**Fix**: Replace `window.confirm` with shadcn `AlertDialog` component (already available in `src/components/ui/alert-dialog.tsx`).

---

### Task 1.5 — Shared Spinner Component

**Problem**: Multiple components implement their own inline spinner patterns

**Fix**: Create a reusable `InlineSpinner` component or use consistent `Loader2` pattern across all async actions.

---

### Task 1.6 — Toggle `checked` State Consistency

**Problem**: Some Switch components ignore the `checked` prop and rely only on `onCheckedChange`

**Files to audit**:
- `src/components/settings/filter-card.tsx`
- `src/components/settings/gemini-card.tsx`
- `src/components/settings/api-fallback-card.tsx`

**Fix**: Ensure all Switch components have explicit `checked` prop bound to state.

---

### Task 1.7 — M-3: Shared Spinner for Admin Header Actions

**Problem**: Admin header logout button has no loading state

**File**: `src/components/layout/admin-header.tsx`

**Fix**: Add loading spinner to logout button during logout operation.

---

### Task 1.8 — M-4: Toggle Inconsistency

**Problem**: Toggle state can get out of sync with server state

**Fix**: After any toggle save fails, revert the toggle to its previous state.

---

### Task 1.9 — M-5: Connection Banner Mobile Layout

**Problem**: Connection banner may overflow on narrow screens

**File**: `src/components/dashboard/connection-banner.tsx`

**Fix**: Apply responsive layout, truncate long messages on mobile.

---

### Task 1.10 — Credits Timeout Display

**Problem**: API credits show stale data without indicating staleness

**File**: `src/components/settings/api-fallback-card.tsx`

**Fix**: Show "last updated X min ago" or refresh indicator for credits.

---

### Task 1.11 — Unused Return Value from adjustStatsForTransition

**Problem**: Return value of `adjustStatsForTransition` is never used

**File**: `src/contexts/admin-stats-context.tsx`

**Fix**: Change return type to `void` or use the return value for optimistic UI updates.

---

## Phase 2 — Credits Cache + SEO Quick Wins

> **Priority**: 🟡 High | **Risk**: Zero | **Dependencies**: None (independent of Phase 1)

### Task 2.1 — Credits Cache Invalidation After Tweet Post

**Problem**: After a tweet is posted, credits decrease but the admin dashboard may show stale cached credits

**File**: `src/lib/twitter-api-credits.ts`

**Current**: `invalidateCreditsCache()` exists (line 125-128) but may not be called after every successful post

**Fix**: Ensure `invalidateCreditsCache()` is called in `src/lib/execute-post.ts` after successful tweet posting, and in `src/app/api/admin/settings/route.ts` after saving new API keys.

---

### Task 2.2 — Dynamic robots.txt

**Problem**: Current `public/robots.txt` is static and allows all crawlers on all paths

**Current content**:
```
User-agent: Googlebot
Allow: /

User-agent: *
Allow: /
```

**Fix**: Replace with dynamic `src/app/robots.ts` that blocks `/api/` and `/admin/` paths:
```typescript
import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXTAUTH_URL 
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin/'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
```

**Note**: Remove the static `public/robots.txt` after creating `src/app/robots.ts`.

---

### Task 2.3 — Structured Data (JSON-LD)

**File**: `src/app/page.tsx`

**Fix**: Add JSON-LD structured data for the homepage:
```typescript
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'Tweetfess',
  description: 'X Menfess Indonesia — kirim pesan anonim',
  applicationCategory: 'SocialNetworking',
  operatingSystem: 'Web',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'IDR',
  },
}
```

Add to page: `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />`

---

### Task 2.4 — Canonical URL

**File**: `src/app/layout.tsx`

**Fix**: Add `metadataBase` and `alternates.canonical`:
```typescript
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXTAUTH_URL || 'http://localhost:3000'),
  // ... existing fields
  alternates: {
    canonical: '/',
  },
}
```

---

### Task 2.5 — L-2: Unused Return Value from deleteSubmission

**Problem**: Return value from `apiClient.deleteSubmission()` is never used

**Files**: Multiple consumers of deleteSubmission

**Fix**: Either use the return value or change the API to return void explicitly.

---

### Task 2.6 — L-3: window.confirm Replacement

**Problem**: Some components still use `window.confirm` instead of AlertDialog

**Files to audit**: All components with destructive actions

**Fix**: Replace all `window.confirm` calls with shadcn AlertDialog.

---

### Task 2.7 — L-4: robots.txt Dynamic Generation

Covered by Task 2.2.

---

## Phase 3 — proxy.ts + Admin SSR Shell

> **Priority**: 🟡 High | **Risk**: Low-Medium | **Dependencies**: Phase 0 complete

### Task 3.1 — Create proxy.ts

**File to create**: `src/proxy.ts`

**Purpose**: Replace middleware.ts with Next.js 16 proxy.ts for request interception

**Key requirements**:
1. Node.js runtime (default) — no `export const runtime = 'edge'`
2. Admin route protection using `verifyAdmin()` from `src/lib/admin-auth.ts`
3. Submitter session validation using `verifySessionToken()` from `src/lib/twitter-auth.ts`
4. Loop prevention: `/admin` root passes unconditionally; invalid token on sub-paths → redirect to `/admin` + clear cookie

**Implementation outline**:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdmin, getAdminTokenFromRequest } from '@/lib/admin-auth'
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/twitter-auth'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // --- Admin route protection ---
  if (pathname.startsWith('/admin')) {
    // Root /admin path: unconditional pass-through (prevents redirect loops)
    if (pathname === '/admin') {
      return NextResponse.next()
    }

    // Sub-paths: verify admin token
    const token = getAdminTokenFromRequest(request)
    const result = verifyAdmin(token)
    
    if (result.authorized) {
      return NextResponse.next()
    }

    // Invalid/expired token → redirect to /admin + clear cookie
    const response = NextResponse.redirect(new URL('/admin', request.url))
    response.cookies.delete('admin_token')
    return response
  }

  // --- All other routes: pass through ---
  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*'],
}
```

**Important**: `verifyAdmin()` returns `{ authorized: true } | { authorized: false; response: NextResponse }`. In the proxy, we only need the boolean check — we don't use the `response` object from verifyAdmin, we create our own redirect.

---

### Task 3.2 — Admin SSR Shell

**Problem**: Admin pages are 100% CSR — initial load shows loading spinner, no SEO benefit

**File**: `src/app/admin/layout.tsx`

**Current**: Entire layout is a `'use client'` component with `AdminAuthProvider` + `AdminStatsProvider`

**Target**: Split into:
- Server component shell (layout.tsx) — renders static HTML structure
- Client component (`AdminClientShell`) — handles auth state, stats fetching
- Server component can check `admin_token` cookie existence (not validity) to pre-render the appropriate view

**Implementation approach**:
```typescript
// src/app/admin/layout.tsx (server component)
import { cookies } from 'next/headers'
import { AdminClientShell } from './admin-client-shell'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Check if admin_token cookie exists (NOT validity check — that's server-side)
  const cookieStore = await cookies()
  const hasAdminCookie = cookieStore.has('admin_token')

  return <AdminClientShell hasAdminCookie={hasAdminCookie}>{children}</AdminClientShell>
}
```

```typescript
// src/app/admin/admin-client-shell.tsx (client component)
'use client'

// Move existing AdminLayoutInner logic here
// Use hasAdminCookie prop to skip session check if no cookie exists
```

---

### Task 3.3 — Settings Page Layout Optimization

**Problem**: Settings page re-renders all tabs when switching

**File**: `src/app/admin/settings/page.tsx`

**Fix**: Use `lazy` loading for tab panels or ensure `TabsContent` unmounts inactive tabs (check current behavior).

---

### Task 3.4 — Admin Route Metadata

**Files**: `src/app/admin/layout.tsx`, `src/app/admin/page.tsx`, `src/app/admin/settings/page.tsx`

**Fix**: Add `generateMetadata` for admin pages:
```typescript
// admin/layout.tsx
export const metadata: Metadata = {
  title: 'Tweetfess Admin',
  robots: { index: false, follow: false },
}
```

---

### Task 3.5 — Proxy Matcher Configuration

**File**: `src/proxy.ts`

**Config**: Only match `/admin/:path*` routes. Do NOT match API routes or public pages.

---

### Task 3.6 — EncryptionBanner Refactor

**File**: `src/components/dashboard/encryption-banner.tsx`

**Current**:
```typescript
interface EncryptionBannerProps {
  encryptionEnabled: boolean | undefined
}

export function EncryptionBanner({ encryptionEnabled }: EncryptionBannerProps) {
```

**Target**:
```typescript
'use client'

import { ShieldAlert } from 'lucide-react'
import { useAdminStats } from '@/contexts/admin-stats-context'

export function EncryptionBanner() {
  const { stats } = useAdminStats()
  const encryptionEnabled = stats?.encryptionEnabled

  // Show shimmer while loading
  if (encryptionEnabled === undefined) {
    // ... same shimmer
  }
  if (encryptionEnabled === true) return null
  // ... same warning banner
}
```

**Update consumers** — remove `encryptionEnabled` prop:
- `src/app/admin/page.tsx` line 151: Change `<EncryptionBanner encryptionEnabled={stats?.encryptionEnabled} />` → `<EncryptionBanner />`
- `src/app/admin/settings/page.tsx` line 118: Same change

---

## Phase 4 — Homepage SSR

> **Priority**: 🟡 Medium | **Risk**: Medium | **Dependencies**: Phase 3 patterns established

### Task 4.1 — Convert HomePage to SSR Shell

**File**: `src/app/page.tsx`

**Current**: Entire page is `'use client'` with all logic inline

**Target**: Split into:
- Server component shell (page.tsx) — renders static HTML structure, metadata
- Client component (`HomeClient`) — handles auth state, form submission

**Implementation approach**:
```typescript
// src/app/page.tsx (server component)
import type { Metadata } from 'next'
import { HomeClient } from './home-client'

export const metadata: Metadata = {
  title: 'Tweetfess - Kirim Pesan Anonim ke X',
  description: 'Kirim pesan anonim, admin moderasi, otomatis diposting ke X. Menfess gratis untuk komunitas Indonesia.',
  openGraph: {
    title: 'Tweetfess - Kirim Pesan Anonim ke X',
    description: 'Kirim pesan anonim, admin moderasi, otomatis diposting ke X.',
  },
}

export default function HomePage() {
  return <HomeClient />
}
```

**SEO benefit**: Search engines can index the page structure, form, and trust badges immediately without waiting for JavaScript.

---

### Task 4.2 — Homepage Structured Data

**File**: `src/app/page.tsx`

**Add**: JSON-LD WebApplication schema (from Task 2.3) at the server component level.

---

### Task 4.3 — Static Shell Pre-render

**Benefit**: The header, footer, trust badges, and form container can be server-rendered. Only the auth-dependent content (form state, my posts) needs client-side hydration.

---

## Phase 5 — Complexity Decomposition

> **Priority**: 🟡 Medium | **Risk**: Medium | **Dependencies**: Phases 0-4 stable

Goal: Reduce cyclomatic complexity (CCN) to ≤ 15 for all functions.

### Task 5.1 — Decompose twitter-cookie-api.ts

**File**: `src/lib/twitter-cookie-api.ts`

**Functions to decompose**:
- `postViaCookieApi` (lines 138-217) — CCN ~12, extract error handling into helper
- `validateCookieApiPrereqs` (lines 81-125) — already well-structured, minor extraction possible

### Task 5.2 — Decompose content-filter-engine.ts

**File**: `src/lib/content-filter-engine.ts`

Audit CCN and extract filter rule evaluation into separate functions.

### Task 5.3 — Decompose execute-post.ts

**File**: `src/lib/execute-post.ts`

Extract post method selection logic and error classification into separate functions.

### Task 5.4 — Decompose twitter-api-fallback.ts

**File**: `src/lib/twitter-api-fallback.ts`

Extract API key rotation and error handling into separate functions.

### Task 5.5 — Decompose twitter-v2-login.ts

**File**: `src/lib/twitter-v2-login.ts`

Extract login step sequence into separate functions.

### Task 5.6 — Decompose twitter-post-cookie.ts

**File**: `src/lib/twitter-post-cookie.ts`

Extract cookie parsing and validation into separate functions.

### Task 5.7 — Decompose admin/stats/route.ts

**File**: `src/app/api/admin/stats/route.ts`

Extract stats aggregation into a separate service module.

### Task 5.8 — Decompose submissions/route.ts

**File**: `src/app/api/submissions/route.ts`

Extract submission validation and processing into separate functions.

### Task 5.9 — Decompose settings page component

**File**: `src/app/admin/settings/page.tsx`

Extract each tab's content into separate components.

### Task 5.10 — Decompose confession-form.tsx

**File**: `src/components/submit/confession-form.tsx`

Extract form validation and category selection into separate components.

### Task 5.11 — Decompose submission-list.tsx

**File**: `src/components/dashboard/submission-list.tsx`

Extract action buttons into a separate component.

### Task 5.12 — General CCN Audit

Run lizard on all `.ts`/`.tsx` files and ensure no function exceeds CCN 15.

---

## Bug Catalog

### Critical (🔴)

| ID | Summary | File | Task |
|----|---------|------|------|
| B-1 | Clear Query ID → API 400 | `use-posting-settings.ts` | 0.1 |

### Medium (🟡)

| ID | Summary | File | Task |
|----|---------|------|------|
| M-1 | ~~Dead prop~~ `isSavingSetting` — correct as-is | `use-posting-settings.ts` | 0.4 (NO-OP) |
| M-2 | Logout doesn't reset state | `admin-auth-context.tsx` | 0.2 |
| M-3 | No loading on admin header actions | `admin-header.tsx` | 1.7 |
| M-4 | Toggle state can desync | Multiple settings cards | 1.8 |
| M-5 | Connection banner mobile overflow | `connection-banner.tsx` | 1.9 |
| M-6 | Credits show stale data | `api-fallback-card.tsx` | 1.10 |
| M-7 | Shared spinner needed | Multiple components | 1.5 |
| M-8 | 100% CSR — no SSR | All pages | 3.2, 4.1 |

### Low (🟢)

| ID | Summary | File | Task |
|----|---------|------|------|
| L-1 | No not-found.tsx | Missing | 0.5 |
| L-2 | Unused return value | Multiple | 2.5 |
| L-3 | window.confirm usage | Multiple | 2.6 |
| L-4 | Static robots.txt | `public/robots.txt` | 2.2 |
| L-5 | No sitemap.ts | Missing | 0.5 |
| L-6 | No error.tsx | Missing | 0.5 |
| L-7 | Missing AlertDialog for delete | `submission-list.tsx` | 1.4 |
| L-8 | Incomplete OG metadata | `layout.tsx` | 0.6 |
| L-9 | No spinner on login button | `admin/layout.tsx` | 0.3 |
| L-10 | Auto-save on toggles | Multiple settings | 1.2 |
| L-11 | Mobile layout issues | Multiple | 1.3 |
| L-12 | Toggle `checked` not bound | Multiple Switch | 1.6 |
| L-13 | Unused adjustStatsForTransition return | `admin-stats-context.tsx` | 1.11 |
| L-14 | Credits cache invalidation gap | `twitter-api-credits.ts` | 2.1 |

---

## Verification History

| Version | Issues Found | Key Corrections |
|---------|-------------|-----------------|
| v2.0 | 6 factual errors + 2 feasibility gaps | middleware Edge Runtime incompatibility, provider placement breaks AdminHeader, cookie name errors |
| v3.1 | 4 remaining issues | provider placement still wrong, middleware crypto unresolved |
| v5.0 | 6 issues | proxy infinite redirect loop, EncryptionBanner uses prop not context, getSubmitterFromNextRequest return type error, task 2.2 file target error, #7 number contradiction, classifyApiError omitted |
| v5.1 | 2+1 issues | handler count off by 1, B-1 fix feasibility gap, apiClient.getStats() doesn't accept params |
| v5.2 | 2 issues | File modification table inconsistent, classifyApiError CCN 20 is lizard parser merge bug |
| v5.3 | 0 new issues | Documentation-only corrections |
| **v5.4** | **0 new issues** | **✅ Execution-ready** |

---

## Key File Reference

| File | Key Lines | Relevance |
|------|-----------|-----------|
| `src/lib/admin-auth.ts` | 32 (cookie name), 48-53 (deriveAdminToken), 79-151 (verifyAdmin) | proxy.ts depends on verifyAdmin + getAdminTokenFromRequest |
| `src/lib/twitter-auth.ts` | 247 (SESSION_COOKIE_NAME), 298-305 (getSubmitterFromNextRequest return type) | proxy.ts session validation |
| `src/hooks/use-posting-settings.ts` | 66-94 (saveSetting — B-1 fix target) | Empty value → deleteSetting routing |
| `src/components/dashboard/encryption-banner.tsx` | 5-7 (prop interface — refactor target) | Remove prop, use useAdminStats() |
| `src/contexts/admin-auth-context.tsx` | 55-59 (logout — M-2 fix target) | Missing resetState on logout |
| `src/contexts/admin-stats-context.tsx` | 66-152 (AdminStatsProvider) | Provider placement in layout confirmed correct |
| `src/lib/api-client.ts` | 159-161 (getStats no params), 174-176 (deleteSetting exists) | B-1 fix uses existing deleteSetting |
| `src/lib/twitter-api-credits.ts` | 125-128 (invalidateCreditsCache) | Task 2.1 — ensure called after post |
| `src/lib/twitter-cookie-api.ts` | 41-73 (classifyApiError CCN ~11), 81-125 (validateCookieApiPrereqs) | lizard CCN 20 is parser bug |
| `src/app/admin/layout.tsx` | 22-30 (provider wrapping), 110-121 (authenticated view) | Provider placement confirmed correct |
| `src/app/admin/page.tsx` | 151 (EncryptionBanner with prop) | Task 3.6 consumer |
| `src/app/admin/settings/page.tsx` | 118 (EncryptionBanner with prop) | Task 3.6 consumer |
| `src/app/layout.tsx` | 16-23 (metadata — L-8 fix target) | Add OG + Twitter Card meta |
| `next.config.ts` | 48-67 (headers, env, images) | Security headers already configured |
| `prisma/schema.prisma` | PostgreSQL (not SQLite) | Setting model used by B-1 fix |

---

## Execution Notes

1. **Phase 0 is independent and should be executed first** — all 6 tasks are surgical, zero-risk fixes
2. **Phases 1 and 2 can run in parallel** — no dependencies between consistency fixes and SEO work
3. **Phase 3 requires Phase 0 complete** — proxy.ts needs B-1 fix stable
4. **Phase 4 requires Phase 3 patterns** — homepage SSR follows admin SSR patterns
5. **Phase 5 is lowest priority** — complexity decomposition can be done incrementally
6. **After each phase**: run `bun run lint` and verify dev server starts cleanly
