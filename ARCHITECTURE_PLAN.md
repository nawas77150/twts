# Tweetfess Architecture Refactoring Plan
## Verified & Validated Against Codebase (commit f735570)

---

## STANDING RULES
1. **Never edit without user permission**
2. **Never edit eslint.config.mjs**
3. **Verify diffs before committing**
4. **No regressions — every batch must pass `bun run lint`**

---

## BATCH DEPENDENCY GRAPH

```
Batch 1 ──→ Batch 2 ──→ Batch 3 ──→ Batch 4 ──→ Batch 5 ──→ Batch 6 ──→ Batch 7
(types)     (dead      (cast       (DB         (session    (contexts)  (adminToken
            deps)      fixes)      perf)       endpoint)               removal)

Batch 8 (submissions _lib) ── independent, can run after Batch 1
Batch 9 (debug upgrade)     ── independent, can run anytime
Batch 10 (CI/tooling)       ── independent, can run anytime
```

---

## BATCH 1: Types Cleanup (Steps 1+2+7 Combined)
**Why combined:** All three touch `src/types/index.ts` — must be one atomic commit.

### 1A. Split `PostMethod` into `PostMethodSetting` + `PostMethodResult`

**File: `src/types/index.ts`**

Current (line 9):
```ts
export type PostMethod = 'direct' | 'api' | 'auto'
```

Replace with:
```ts
/** Admin-configured posting mode (stored in Setting table as post_method) */
export type PostMethodSetting = 'direct' | 'api' | 'auto'

/** Actual method used to post a tweet (stored in Submission.postMethod) */
export type PostMethodResult = 'direct' | 'retry' | 'fallback' | 'fallback_cookie' | 'fallback_login'
```

**Backward compat shim** (add below the new types):
```ts
/** @deprecated Use PostMethodSetting or PostMethodResult instead */
export type PostMethod = PostMethodSetting
```

**Update `Stats.postMethodSetting`** (line 132):
```ts
// Before:
postMethodSetting?: PostMethod
// After:
postMethodSetting?: PostMethodSetting
```

**Update `Submission.postMethod`** (line 26):
```ts
// Before:
postMethod: string | null
// After:
postMethod: PostMethodResult | null
```

**Verified consumers that need updating:**

| File | Line | Change |
|------|------|--------|
| `use-stats-summary.ts` | 4 | `import type { ... PostMethod } from '@/types'` → `PostMethodSetting` |
| `use-stats-summary.ts` | 36 | `as PostMethod` → `as PostMethodSetting` |
| `use-posting-settings.ts` | 4 | `import type { PostMethod } from '@/types'` → `PostMethodSetting` |
| `use-posting-settings.ts` | 37 | `useState<PostMethod>('auto')` → `useState<PostMethodSetting>('auto')` |
| `api-fallback-card.tsx` | 22 | `import type { PostMethod, ... } from '@/types'` → `PostMethodSetting` |
| `api-fallback-card.tsx` | 83-85 | `as PostMethod` → `as PostMethodSetting` (3 casts) |
| `api-fallback-card.tsx` | 25-26 | `postMethodSetting: PostMethod` → `PostMethodSetting` in props |
| `submission-card.tsx` | 69-88 | Runtime checks like `sub.postMethod === 'fallback'` — now type-safe with `PostMethodResult` |

**No changes needed in:**
- `stats/route.ts:111` — Already uses string literals, will be type-safe via `PostMethodResult`
- `use-stats.ts:4` — Imports `PostMethodStats`, not `PostMethod`
- `post-method-rates.tsx:5` — Imports `PostMethodStats`, not `PostMethod`

### 1B. Remove FilterRules + DEFAULT_FILTER_RULES Duplication

**File: `src/types/index.ts`**

- **DELETE** lines 75-86 (duplicate `FilterRules` interface)
- **DELETE** lines 257-268 (duplicate `DEFAULT_FILTER_RULES` const)
- **ADD** re-exports from content-filter-engine (already safe — no circular import):
```ts
// Re-exported from @/lib/content-filter-engine (canonical source)
export type { FilterRules } from '@/lib/content-filter-engine'
export { DEFAULT_FILTER_RULES } from '@/lib/content-filter-engine'
```

**Verified consumers:**

| File | Current Import | After Change |
|------|---------------|-------------|
| `use-filter-settings.ts:4` | `import type { FilterRules, ... } from '@/types'` | ✅ Still works (re-exported) |
| `use-filter-settings.ts:5` | `import { DEFAULT_FILTER_RULES } from '@/types'` | ✅ Still works (re-exported) |
| `filter-card.tsx:17` | `import type { FilterRules } from '@/types'` | ✅ Still works |

### 1C. Move Non-Type Exports from `types/index.ts`

Move to `src/lib/format.ts` (new file):

```ts
// src/lib/format.ts — Formatting and display helpers extracted from @/types

/** Status label + color configuration for UI rendering */
export const STATUS_CONFIG = {
  pending: { label: 'Menunggu', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  censored: { label: 'Disensor', color: 'bg-orange-100 text-orange-800 border-orange-300' },
  posting: { label: 'Posting', color: 'bg-blue-100 text-blue-800 border-blue-300' },
  post_failed: { label: 'Gagal', color: 'bg-red-100 text-red-800 border-red-300' },
  rejected: { label: 'Ditolak', color: 'bg-gray-100 text-gray-600 border-gray-300' },
  posted: { label: 'Diposting', color: 'bg-green-100 text-green-800 border-green-300' },
} as const

/** Get a human-readable label for a filter reason code */
export function getFilterReasonLabel(reason: string): string {
  if (reason.startsWith('blocked_word:')) {
    const word = reason.replace('blocked_word:', '')
    const masked = word.length > 2 ? word[0] + '*'.repeat(word.length - 2) + word[word.length - 1] : '**'
    return `Blocked: "${masked}"`
  }
  if (reason.startsWith('nsfw_word:')) {
    const word = reason.replace('nsfw_word:', '')
    const masked = word.length > 2 ? word[0] + '*'.repeat(word.length - 2) + word[word.length - 1] : '**'
    return `NSFW: "${masked}"`
  }
  if (reason === 'ai:skipped_error') return 'AI: Skipped (error)'
  if (reason.startsWith('ai:')) return `AI: ${reason.replace('ai:', '')}`
  if (reason.startsWith('jualan:')) return `Marketplace (${reason.replace('jualan:', '')})`
  if (reason === 'contains_url') return 'Link'
  if (reason.startsWith('contains_mention')) return '@Mention'
  if (reason === 'contains_phone_number') return 'No. HP'
  if (reason === 'caps_spam') return 'ALL CAPS'
  if (reason === 'repeated_characters') return 'Spam chars'
  if (reason === 'too_short') return 'Terlalu pendek'
  if (reason === 'duplicate_24h') return 'Duplikat (24j)'
  return reason
}

/** Parse a JSON filterReasons string into an array */
export function parseFilterReasons(filterReasons: string | null): string[] {
  if (!filterReasons) return []
  try {
    const parsed = JSON.parse(filterReasons)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Format a date string for display in the UI */
export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
```

**Update `src/types/index.ts`** — Replace the moved code with re-exports:
```ts
// Re-exported from @/lib/format (canonical source)
export { STATUS_CONFIG, getFilterReasonLabel, parseFilterReasons, formatDate } from '@/lib/format'
```

**Verified consumers that need import path updates:**

| File | Current | After |
|------|---------|-------|
| `submission-filters.tsx:7` | `from '@/types'` | ✅ Still works (re-exported) |
| `status-badge.tsx:4` | `from '@/types'` | ✅ Still works (re-exported) |
| `filter-reasons.tsx:5` | `from '@/types'` | ✅ Still works (re-exported) |
| `submission-card.tsx:12` | `from '@/types'` | ✅ Still works (re-exported) |
| `my-posts.tsx:8` | `from '@/types'` | ✅ Still works (re-exported) |

All consumers import from `@/types`, which will re-export from `@/lib/format`. Zero consumer changes needed.

### 1D. Keep in `types/index.ts`
- `PER_USER_LIMIT_KEYS` (line 168) — type-adjacent, used with `keyof PerUserLimits`
- `PER_USER_LIMIT_LABELS` (line 175) — type-adjacent
- `DEFAULT_RATE_LIMITS` re-export (line 271) — already a re-export from filter-settings

### Batch 1 Verification Checklist
- [ ] `bun run lint` passes
- [ ] `grep -r "as PostMethod" src/` returns 0 results (all renamed)
- [ ] `grep -r "PostMethodResult" src/` returns matches in types/index.ts + submission-card.tsx
- [ ] `grep -r "PostMethodSetting" src/` returns matches in types/index.ts + hooks + api-fallback-card
- [ ] `grep -r "interface FilterRules" src/` returns only 1 definition (content-filter-engine.ts)
- [ ] `grep -r "const DEFAULT_FILTER_RULES" src/` returns only 1 definition (content-filter-engine.ts)
- [ ] `grep -r "from '@/types'" src/components/` all still resolve (re-exports work)
- [ ] No circular imports: `grep -r "from '@/types'" src/lib/content-filter-engine.ts` returns 0 results
- [ ] TypeScript compiles without errors

### Commit Message
```
refactor: split PostMethod type, deduplicate FilterRules, extract format helpers

- PostMethod → PostMethodSetting + PostMethodResult (backward compat shim kept)
- FilterRules + DEFAULT_FILTER_RULES: remove duplicate from types/index.ts,
  re-export from content-filter-engine.ts (canonical source)
- Move STATUS_CONFIG, getFilterReasonLabel, parseFilterReasons, formatDate
  to lib/format.ts (re-exported from types/index.ts for backward compat)
- Fix 4 `as PostMethod` casts → `as PostMethodSetting`
- Submission.postMethod: string | null → PostMethodResult | null
```

---

## BATCH 2: Remove Dead Dependencies

### Changes

**File: `package.json`**
- Remove `"sonner": "^2.0.6"` from dependencies
- Remove `"@tanstack/react-query": "^5.82.0"` from dependencies
- Keep `z-ai-web-dev-sdk` per user instruction

### Verification
- [ ] `bun install` succeeds
- [ ] `bun run lint` passes
- [ ] `grep -r "from 'sonner'" src/` returns 0 results (already verified)
- [ ] `grep -r "from '@tanstack/react-query'" src/` returns 0 results (already verified)

### Commit Message
```
chore: remove unused dependencies (sonner, @tanstack/react-query)

Zero imports found in src/ for either package. z-ai-web-dev-sdk retained.
```

---

## BATCH 3: Fix `as PostMethod` Casts (Post-Type-Split Cleanup)

> This is actually done as part of Batch 1 above. If Batch 1 is applied correctly,
> these casts will already be fixed. This batch exists as a **verification gate** —
> confirm that no `as PostMethod` casts remain after Batch 1.

### Verification
- [ ] `grep -rn "as PostMethod" src/` returns 0 results
- [ ] `grep -rn "as PostMethodSetting" src/` returns 4 results (the renamed casts)
- [ ] `grep -rn "PostMethod[^SR]" src/` — only the deprecated shim and comments should remain

---

## BATCH 4: Database Performance Optimizations

### 4A. Add Missing Compound Index

**File: `prisma/schema.prisma`**

Add to Submission model (after existing indexes, around line 52):
```prisma
  @@index([status, createdAt])              // globalPostCount: WHERE status='posted' AND createdAt >= today
```

**Run:** `bun run db:push`

### 4B. Circuit Breaker — Batch Read

**File: `src/lib/circuit-breaker.ts`**

Replace `getCircuitBreakerStatus()` (lines 104-129) with batched read:

```ts
export async function getCircuitBreakerStatus(rateLimits?: CircuitBreakerConfigInput): Promise<{
  paused: boolean
  failCount: number
  pausedUntil: number | null
  remainingMinutes: number
  threshold: number
}> {
  const config = getConfig(rateLimits)

  // Single findMany instead of 2 separate findUnique calls
  const settings = await db.setting.findMany({
    where: { key: { in: [FAIL_COUNT_KEY, PAUSED_UNTIL_KEY] } },
  })
  const getValue = (key: string): string | null =>
    settings.find(s => s.key === key)?.value ?? null

  const failCount = parseInt(getValue(FAIL_COUNT_KEY) || '0', 10) || 0
  const pausedUntilStr = getValue(PAUSED_UNTIL_KEY)
  const pausedUntil = pausedUntilStr && pausedUntilStr !== '0' ? parseInt(pausedUntilStr, 10) : null

  let remainingMinutes = 0
  if (pausedUntil && Date.now() < pausedUntil) {
    remainingMinutes = Math.ceil((pausedUntil - Date.now()) / 60000)
  }

  return {
    paused: pausedUntil ? Date.now() < pausedUntil : false,
    failCount,
    pausedUntil,
    remainingMinutes,
    threshold: config.threshold,
  }
}
```

### 4C. Filter Settings — 30s TTL Cache + Absorb Gemini Calls

**File: `src/lib/filter-settings.ts`**

Add cache at top of file:
```ts
let cachedSettings: { data: Awaited<ReturnType<typeof getFilterSettings>>; ts: number } | null = null
const CACHE_TTL_MS = 30_000 // 30 seconds

function isCacheValid(): boolean {
  return cachedSettings !== null && (Date.now() - cachedSettings.ts) < CACHE_TTL_MS
}

export function invalidateFilterSettingsCache(): void {
  cachedSettings = null
}
```

Wrap `getFilterSettings()` return with cache check:
```ts
export async function getFilterSettings(): Promise<{ ... }> {
  if (isCacheValid()) return cachedSettings!.data

  // ... existing logic ...

  const result = { autoApprove, blockedWords, nsfwWords, filterRules, geminiEnabled, geminiApiKeySet, geminiModel, rateLimits, whitelistUsernames, blockedUsernames }
  cachedSettings = { data: result, ts: Date.now() }
  return result
}
```

**Absorb Gemini API key into getFilterSettings return:**

Add to `FILTER_SETTING_KEYS` (already includes `gemini_api_key` and `gemini_model`).

Add to return type and return value:
```ts
// In the return type, add:
geminiApiKey: string | null  // The actual key (for server-side use only)

// In the return value, add:
geminiApiKey: geminiApiKey?.trim() || null,
```

**Deprecate standalone functions:**
```ts
/** @deprecated Use getFilterSettings() instead — geminiApiKey is now included */
export async function getGeminiApiKey(): Promise<string | null> {
  const settings = await getFilterSettings()
  return settings.geminiApiKey
}

/** @deprecated Use getFilterSettings() instead — geminiModel is already included */
export async function getGeminiModel(): Promise<string> {
  const settings = await getFilterSettings()
  return settings.geminiModel
}
```

**Update callers:**

`src/app/api/submissions/route.ts` (lines 255-258):
```ts
// Before:
const geminiApiKey = await getGeminiApiKey()
if (geminiApiKey) {
  const geminiModel = await getGeminiModel()
  const geminiResult = await runGeminiFilter(trimmedMessage, geminiApiKey, geminiModel)

// After:
const geminiApiKey = filterSettings.geminiApiKey  // Already loaded above
if (geminiApiKey) {
  const geminiResult = await runGeminiFilter(trimmedMessage, geminiApiKey, filterSettings.geminiModel)
```

This eliminates **2 extra DB roundtrips** per submission POST.

**Invalidate cache on mutations:** Add `invalidateFilterSettingsCache()` calls in:
- `src/app/api/admin/filter-settings/route.ts` — after save
- `src/app/api/admin/settings/route.ts` — after save

### 4D. LimitHit + OAuthFlow Cleanup (Optional)

Add to `prisma/schema.prisma` or create a cleanup script. Not urgent — these tables grow slowly.

### Batch 4 Verification Checklist
- [ ] `bun run db:push` succeeds (new index created)
- [ ] `bun run lint` passes
- [ ] `getFilterSettings` is called once per submission POST (not 3x)
- [ ] Cache invalidation works: save settings → next getFilterSettings returns fresh data
- [ ] Circuit breaker status uses 1 findMany instead of 2 findUnique calls
- [ ] `grep -rn "await getGeminiApiKey()" src/` returns 0 results (or only the deprecated shim)

### Commit Message
```
perf: add [status, createdAt] index, batch circuit-breaker reads, cache filter settings

- Add @@index([status, createdAt]) for globalPostCount query
- getCircuitBreakerStatus: 2 findUnique → 1 findMany
- getFilterSettings: 30s TTL cache, absorb geminiApiKey/geminiModel
- Deprecate getGeminiApiKey() and getGeminiModel() standalone functions
- Invalidate cache on settings mutations
```

---

## BATCH 5: Lightweight Session Endpoint

### New File: `src/app/api/admin/session/route.ts`

```ts
import { verifyAdmin, getAdminTokenFromRequest } from '@/lib/admin-auth'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/admin/session — Lightweight session check (no DB queries)
// Returns 200 if the HttpOnly admin cookie is valid, 401 otherwise.
// Use this instead of /api/admin/stats for session validation.
export async function GET(req: NextRequest) {
  const auth = verifyAdmin(getAdminTokenFromRequest(req))
  if (!auth.authorized) return auth.response
  return NextResponse.json({ authenticated: true })
}
```

**Verification:** This endpoint only calls `verifyAdmin()` which checks the cookie — **zero DB queries**.

### Update `src/lib/api-client.ts`

Add method:
```ts
async checkSession(): Promise<{ authenticated: boolean }> {
  return this.request('/api/admin/session')
}
```

### Update `src/hooks/use-admin-auth.ts`

Replace lines 22-26:
```ts
// Before:
apiClient.getStats().then(() => {
  setIsAdmin(true)
  setAdminToken('session')
}).catch(() => {
  // Not authenticated or session expired
}).finally(() => {
  setIsChecking(false)
})

// After:
apiClient.checkSession().then(() => {
  setIsAdmin(true)
  setAdminToken('session')
}).catch(() => {
  // Not authenticated or session expired
}).finally(() => {
  setIsChecking(false)
})
```

### Batch 5 Verification Checklist
- [ ] `/api/admin/session` returns 200 when admin cookie is valid
- [ ] `/api/admin/session` returns 401 when no cookie / invalid cookie
- [ ] Admin login flow still works (login → redirect → session check)
- [ ] `bun run lint` passes
- [ ] No `getStats()` call in use-admin-auth.ts anymore

### Commit Message
```
feat: add lightweight /api/admin/session endpoint

- New GET /api/admin/session — cookie-only auth check, zero DB queries
- use-admin-auth: use checkSession() instead of getStats() for validation
- Reduces initial load from heaviest endpoint to lightest
```

---

## BATCH 6: AdminAuthContext + AdminStatsContext

### 6A. New File: `src/contexts/admin-auth-context.tsx`

```tsx
'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { apiClient, ApiError } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'

interface AdminAuthState {
  isAdmin: boolean
  isChecking: boolean
  login: (password: string) => Promise<boolean>
  logout: () => Promise<void>
  loginPassword: string
  setLoginPassword: (v: string) => void
  loginOpen: boolean
  setLoginOpen: (v: boolean) => void
  /** @deprecated Use isAdmin instead — auth is via HttpOnly cookie */
  adminToken: string
}

const AdminAuthContext = createContext<AdminAuthState | null>(null)

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false)
  const [isChecking, setIsChecking] = useState(true)
  const [adminToken, setAdminToken] = useState('') // backward compat sentinel
  const [loginPassword, setLoginPassword] = useState('')
  const [loginOpen, setLoginOpen] = useState(false)
  const { toast } = useToast()
  const initialCheckDone = useRef(false)

  useEffect(() => {
    if (initialCheckDone.current) return
    initialCheckDone.current = true
    apiClient.checkSession().then(() => {
      setIsAdmin(true)
      setAdminToken('session')
    }).catch(() => {
      // Not authenticated
    }).finally(() => {
      setIsChecking(false)
    })
  }, [])

  const login = useCallback(async (password: string) => {
    try {
      await apiClient.adminLogin(password)
      setIsAdmin(true)
      setAdminToken('session')
      setLoginOpen(false)
      setLoginPassword('')
      toast({ title: 'Login berhasil!', description: 'Selamat datang, Admin.' })
      return true
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : (err instanceof Error ? err.message : 'Login gagal')
      toast({ title: 'Login gagal', description: message, variant: 'destructive' })
      return false
    }
  }, [toast])

  const logout = useCallback(async () => {
    try { await apiClient.adminLogout() } catch { /* best effort */ }
    setIsAdmin(false)
    setAdminToken('')
    toast({ title: 'Logout berhasil' })
  }, [toast])

  return (
    <AdminAuthContext.Provider value={{ isAdmin, isChecking, login, logout, loginPassword, setLoginPassword, loginOpen, setLoginOpen, adminToken }}>
      {children}
    </AdminAuthContext.Provider>
  )
}

export function useAdminAuth(): AdminAuthState {
  const ctx = useContext(AdminAuthContext)
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider')
  return ctx
}
```

### 6B. New File: `src/contexts/admin-stats-context.tsx`

```tsx
'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { Stats, CookieAuthStatus, PostMethodStats, KeyCredits, ApiLoginStatus } from '@/types'
import { apiClient } from '@/lib/api-client'
import { useAdminAuth } from './admin-auth-context'

interface AdminStatsState {
  stats: Stats | null
  cookieStatus: CookieAuthStatus | null
  postMethodStats: PostMethodStats | null
  apiCredits: KeyCredits[]
  apiLoginStatus: ApiLoginStatus | null
  pendingCount: number
  fetchStats: () => Promise<void>
  refetch: () => Promise<void>
}

const AdminStatsContext = createContext<AdminStatsState | null>(null)

export function AdminStatsProvider({ children }: { children: ReactNode }) {
  const { isAdmin } = useAdminAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [cookieStatus, setCookieStatus] = useState<CookieAuthStatus | null>(null)
  const [postMethodStats, setPostMethodStats] = useState<PostMethodStats | null>(null)
  const [apiCredits, setApiCredits] = useState<KeyCredits[]>([])
  const [apiLoginStatus, setApiLoginStatus] = useState<ApiLoginStatus | null>(null)
  const [pendingCount, setPendingCount] = useState(0)

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiClient.getStats()
      setStats(data)
      setPendingCount(data.pending)
      if (data.cookieAuthStatus !== undefined) setCookieStatus(data.cookieAuthStatus)
      if (data.apiCredits !== undefined) setApiCredits(data.apiCredits ?? [])
      if (data.apiLoginStatus !== undefined) setApiLoginStatus(data.apiLoginStatus)
      if (data.postMethodStats) setPostMethodStats(data.postMethodStats)
    } catch {
      // silently fail — next fetch will retry
    }
  }, [])

  const refetch = useCallback(async () => { await fetchStats() }, [fetchStats])

  // Fetch on auth change
  useEffect(() => {
    if (isAdmin) void fetchStats()
  }, [isAdmin, fetchStats])

  return (
    <AdminStatsContext.Provider value={{ stats, cookieStatus, postMethodStats, apiCredits, apiLoginStatus, pendingCount, fetchStats, refetch }}>
      {children}
    </AdminStatsContext.Provider>
  )
}

export function useAdminStats(): AdminStatsState {
  const ctx = useContext(AdminStatsContext)
  if (!ctx) throw new Error('useAdminStats must be used within AdminStatsProvider')
  return ctx
}
```

### 6C. Update `src/app/admin/layout.tsx`

```tsx
// Before:
import { useAdminAuth } from '@/hooks/use-admin-auth'
// After:
import { AdminAuthProvider, useAdminAuth } from '@/contexts/admin-auth-context'
import { AdminStatsProvider, useAdminStats } from '@/contexts/admin-stats-context'
```

Wrap with providers:
```tsx
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminAuthProvider>
      <AdminStatsProvider>
        <AdminLayoutInner>{children}</AdminLayoutInner>
      </AdminStatsProvider>
    </AdminAuthProvider>
  )
}

function AdminLayoutInner({ children }: { children: React.ReactNode }) {
  const { isAdmin, isChecking, login, logout, loginPassword, setLoginPassword, loginOpen, setLoginOpen } = useAdminAuth()
  const { pendingCount } = useAdminStats()
  // ... rest of layout using pendingCount from context instead of separate fetch
}
```

**Remove:** The separate `apiClient.getStats()` fetch and the `stats-update` custom event listener. The `pendingCount` from context replaces both.

### 6D. Update `src/app/admin/page.tsx`

```tsx
// Before:
const { isAdmin, adminToken } = useAdminAuth()
const { stats, cookieStatus, ... } = useStats({ adminToken })

// After:
const { isAdmin } = useAdminAuth()
const { stats, cookieStatus, postMethodStats, apiCredits, apiLoginStatus, fetchStats, refetch: refetchStats } = useAdminStats()
```

**Remove:** `useStats()` import — replaced by `useAdminStats()`.
**Remove:** `window.dispatchEvent(new CustomEvent('stats-update', ...))` — no longer needed.
**Remove:** Separate 15s auto-refresh (move to AdminStatsProvider or keep here with `fetchStats` from context).

### 6E. Update `src/app/admin/settings/page.tsx`

```tsx
// Before:
const { adminToken } = useAdminAuth()
const stats = useStatsSummary({ adminToken })

// After:
const { adminToken } = useAdminAuth()  // temporarily still needed for hooks
const stats = useStatsSummary({ adminToken })
```

**Badge fix:** The layout now gets `pendingCount` from `AdminStatsProvider`, which fetches on auth change. Settings page mutations can call `useAdminStats().refetch()` to update the badge.

### Batch 6 Verification Checklist
- [ ] Admin login/logout works via context
- [ ] Dashboard page shows stats from context
- [ ] Layout header badge shows pendingCount from context (no separate fetch)
- [ ] Settings page badge stays in sync after mutations (call refetch)
- [ ] No `window.dispatchEvent('stats-update', ...)` anywhere
- [ ] No separate `apiClient.getStats()` in layout.tsx
- [ ] `bun run lint` passes

### Commit Message
```
feat: add AdminAuthContext + AdminStatsContext

- AdminAuthProvider: session check, login/logout, isAdmin state
- AdminStatsProvider: shared stats, pendingCount, fetchStats/refetch
- Layout: use pendingCount from context instead of separate fetch
- Dashboard: use useAdminStats() instead of useStats({ adminToken })
- Remove stats-update custom event pattern (replaced by context)
- Fix settings page badge staleness (context refetch on mutation)
```

---

## BATCH 7: Remove adminToken Prop Drilling

### 7A. Update All Hooks to Remove `adminToken` Param

Since all API calls use HttpOnly cookies (no bearer token needed), the `adminToken` param is just a boolean guard. Replace with the auth context's `isAdmin`.

**Pattern: Every hook changes from:**
```ts
// Before:
interface UseFooParams { adminToken: string; onStatsRefresh?: () => void }
export function useFoo({ adminToken, onStatsRefresh }: UseFooParams) {
  const fetchFoo = useCallback(async () => {
    if (!adminToken) return
    // ...
  }, [adminToken])
}
```

```ts
// After:
export function useFoo() {
  const { isAdmin } = useAdminAuth()
  const { refetch } = useAdminStats()
  const fetchFoo = useCallback(async () => {
    if (!isAdmin) return
    // ...
  }, [isAdmin])
}
```

**Files to update (7 hooks):**

| Hook | adminToken uses | onStatsRefresh uses | Change |
|------|----------------|--------------------|----|
| `use-stats.ts` | 1 guard | 0 | Remove param, use `isAdmin` from context |
| `use-stats-summary.ts` | 1 guard | 0 | Remove param, use `isAdmin` from context |
| `use-submissions.ts` | 2 guards (line 43, 98 dual) | 4 calls | Remove param, use `isAdmin`, replace `onStatsRefresh` with `refetch` from stats context |
| `use-filter-settings.ts` | 5 guards | 4 calls | Remove param, use `isAdmin`, replace `onStatsRefresh` with `refetch` |
| `use-posting-settings.ts` | 0 guards (uses it indirectly) | 3 calls | Remove param, replace `onStatsRefresh` with `refetch` |
| `use-circuit-breaker.ts` | 1 guard | 0 | Remove param, use `isAdmin` |
| `use-submitters.ts` | 4 guards | 0 | Remove param, use `isAdmin` |

**Special case — `use-submissions.ts` line 98 dual guard:**
```ts
// Before:
if (isAdmin && adminToken) {
// After:
if (isAdmin) {
```

### 7B. Update All Pages/Components That Pass adminToken

**`admin/page.tsx`:**
```ts
// Before:
const { isAdmin, adminToken } = useAdminAuth()
const { ... } = useStats({ adminToken })
const { ... } = useSubmissions({ isAdmin, adminToken, onStatsRefresh: fetchStats })
const { ... } = useSubmitters({ adminToken })

// After:
const { isAdmin } = useAdminAuth()
const { ... } = useAdminStats()
const { ... } = useSubmissions({ isAdmin })
const { ... } = useSubmitters()
```

**`admin/settings/page.tsx`:**
```ts
// Before:
const { adminToken } = useAdminAuth()
const posting = usePostingSettings({ adminToken })
const filterSettings = useFilterSettings({ adminToken })
const circuitBreaker = useCircuitBreaker({ adminToken })
const stats = useStatsSummary({ adminToken })

// After:
const posting = usePostingSettings()
const filterSettings = useFilterSettings()
const circuitBreaker = useCircuitBreaker()
const stats = useStatsSummary()
```

**`onStatsRefresh` replacement in settings page:**
The settings page currently wraps save actions with `stats.refetch()`. After this batch, `useAdminStats().refetch()` is available in every hook via context. So the page-level wrappers can be simplified.

### 7C. Delete `use-stats.ts`

After AdminStatsContext is in place and `use-stats.ts` has zero consumers:
- `admin/page.tsx` now uses `useAdminStats()` from context
- No other file imports `use-stats`

Delete the file and verify nothing breaks.

### Batch 7 Verification Checklist
- [ ] `grep -rn "adminToken" src/hooks/` returns 0 results (all removed)
- [ ] `grep -rn "onStatsRefresh" src/` returns 0 results (all replaced with context refetch)
- [ ] Dashboard: approve/reject/delete/retry still triggers stats refresh
- [ ] Settings: save still triggers stats refresh
- [ ] Settings page badge updates after mutations
- [ ] `use-stats.ts` is deleted
- [ ] `bun run lint` passes

### Commit Message
```
refactor: remove adminToken prop drilling, replace with auth context

- All 7 hooks: remove adminToken param, use useAdminAuth().isAdmin
- All 7 hooks: remove onStatsRefresh param, use useAdminStats().refetch()
- Collapse use-submissions dual guard to single isAdmin check
- Delete use-stats.ts (replaced by AdminStatsContext)
- Update admin/page.tsx and admin/settings/page.tsx call sites
```

---

## BATCH 8: Submissions _lib.ts Extraction

### File: `src/app/api/submissions/_lib.ts`

Extract the 5 pipeline helpers already defined inline in `submissions/route.ts`:

| Function | Lines | Description |
|----------|-------|-------------|
| `getCensoredReason()` | 16-21 | Classify filter reasons |
| `logLimitHit()` | 24-28 | Fire-and-forget limit hit logging |
| `validateSubmission()` | 54-97 | Input validation + submitter auth |
| `checkSubmissionRateLimits()` | 99-209 | Rate limit checks (cooldown, caps, whitelist) |
| `runFilterPipeline()` | 211-305 | Content filter + Gemini AI pipeline |
| `createQueuedSubmission()` | 307-327 | Create submission with "queued" response |

Also extract the shared types:
```ts
interface ValidatedInput { ... }
interface RateLimitContext { ... }
interface FilterPipelineResult { ... }
```

**`submissions/route.ts`** becomes a thin router:
```ts
import { validateSubmission, checkSubmissionRateLimits, runFilterPipeline, createQueuedSubmission, getCensoredReason, logLimitHit } from './_lib'
// ... just the GET and POST handlers, calling the extracted functions
```

### Batch 8 Verification Checklist
- [ ] `submissions/route.ts` is under 150 lines (just GET + POST handlers)
- [ ] `submissions/_lib.ts` contains all pipeline logic
- [ ] Submission flow still works: submit → filter → auto-post
- [ ] `bun run lint` passes

### Commit Message
```
refactor: extract submission pipeline to _lib.ts

Move validateSubmission, checkSubmissionRateLimits, runFilterPipeline,
createQueuedSubmission, getCensoredReason, logLimitHit, and shared
types to submissions/_lib.ts. Route file becomes thin GET/POST handler.
```

---

## BATCH 9: Debug System Upgrade

### File: `src/lib/debug.ts`

```ts
/**
 * Namespaced debug logging with timestamps.
 *
 * Set DEBUG=1 or DEBUG=direct,execute-post in .env or Vercel env vars.
 * Namespaces: comma-separated list. If DEBUG=1 or DEBUG=*, all namespaces pass.
 * Timestamps are always included in ISO format.
 */

const DEBUG_ENV = process.env.DEBUG ?? ''

const isDebugEnabled = !!DEBUG_ENV

// Parse namespaces from DEBUG env var
const namespaces: Set<string> | null = DEBUG_ENV === '1' || DEBUG_ENV === '*' || DEBUG_ENV === 'true'
  ? null  // null = all namespaces pass
  : new Set(DEBUG_ENV.split(',').map(ns => ns.trim()).filter(Boolean))

function shouldLog(namespace: string): boolean {
  if (!isDebugEnabled) return false
  if (namespaces === null) return true  // DEBUG=1 or DEBUG=*
  return namespaces.has(namespace)
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 23) // HH:mm:ss.SSS
}

export function debug(namespace: string, ...args: unknown[]): void {
  if (shouldLog(namespace)) {
    console.log(`[${timestamp()}] [debug:${namespace}]`, ...args)
  }
}

export function debugError(namespace: string, ...args: unknown[]): void {
  if (shouldLog(namespace)) {
    console.error(`[${timestamp()}] [debug:${namespace}]`, ...args)
  }
}
```

### Update All `debug()` Callers

**Current pattern:** `debug('[submit] All filters passed')`
**New pattern:** `debug('submit', 'All filters passed')`

This requires updating all ~50 `debug()` calls across the codebase. Files:

| File | Namespace | Approximate Call Count |
|------|-----------|----------------------|
| `circuit-breaker.ts` | `circuit-breaker` | 5 |
| `submissions/route.ts` | `submit` | 10 |
| `submissions/[id]/route.ts` | `approve` | 3 |
| `submissions/[id]/post/route.ts` | `retry` | 3 |
| `autopost/route.ts` | `autopost` | 8 |
| `twitter-post-cookie.ts` | `cookie` | 5 |
| `twitter-api-fallback.ts` | `fallback` | 5 |
| `execute-post.ts` | `execute-post` | 8 |
| `posting-lock.ts` | `lock` | 3 |
| `test-x/route.ts` | `test-x` | 2 |
| `stale-posting.ts` | `stale` | 2 |

### 9B. DB Query Duration Logging

**File: `src/lib/db.ts`**

```ts
import { PrismaClient } from '@prisma/client'

const DEBUG_DB = !!process.env.DEBUG_DB

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: DEBUG_DB
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'stdout', level: 'error' },
        ]
      : process.env.NODE_ENV === 'development'
        ? ['query']
        : ['error'],
  })

if (DEBUG_DB) {
  db.$on('query', (e) => {
    console.log(`[db] ${e.query} — ${e.duration}ms (${e.params})`)
  })
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
```

### Batch 9 Verification Checklist
- [ ] `DEBUG=1 bun run dev` — all debug messages show with timestamps
- [ ] `DEBUG=submit bun run dev` — only submit namespace messages show
- [ ] `DEBUG_DB=1 bun run dev` — query duration logs appear
- [ ] `bun run lint` passes
- [ ] No `debug('[namespace]')` pattern remains (all use two-arg form)

### Commit Message
```
feat: namespaced debug logging with timestamps, DB query duration

- debug(): now takes (namespace, ...args) instead of (...args)
- Supports DEBUG=1 (all), DEBUG=direct,execute-post (specific namespaces)
- Always includes ISO timestamp in output
- DEBUG_DB=1 enables Prisma query duration logging
- Update ~50 debug() call sites with namespace separation
```

---

## BATCH 10: CI/Tooling

### File: `package.json`

Add scripts:
```json
{
  "scripts": {
    "typecheck": "prisma generate && tsc --noEmit",
    "ci": "bun run typecheck && bun run lint",
    "db:studio": "prisma studio"
  }
}
```

### File: `tsconfig.json`

Add compiler options:
```json
{
  "compilerOptions": {
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

### File: `.env.development` (new)

```
DEBUG=1
# DEBUG_DB=1
```

### Batch 10 Verification Checklist
- [ ] `bun run typecheck` passes
- [ ] `bun run ci` passes (typecheck + lint)
- [ ] `bun run db:studio` launches Prisma Studio
- [ ] tsconfig: `noImplicitReturns` catches missing returns
- [ ] tsconfig: `noFallthroughCasesInSwitch` catches switch fallthroughs
- [ ] `.env.development` loaded by Next.js in dev mode

### Commit Message
```
chore: add typecheck/ci scripts, tsconfig strictness, dev env file

- Add typecheck (prisma generate + tsc --noEmit), ci, db:studio scripts
- Add noImplicitReturns, noFallthroughCasesInSwitch to tsconfig
- Add .env.development with DEBUG=1
```

---

## EXECUTION ORDER SUMMARY

| Batch | Risk | Effort | Files Changed | Depends On |
|-------|------|--------|---------------|------------|
| **1** Types cleanup | Medium | High | ~8 files | None |
| **2** Dead deps | Low | Low | 1 file | None |
| **3** Cast verification | Low | Low | 0 files (verification only) | Batch 1 |
| **4** DB perf | Medium | Medium | ~5 files | None |
| **5** Session endpoint | Low | Low | 3 files | None |
| **6** Contexts | High | High | ~5 files + 2 new | Batch 5 |
| **7** Remove adminToken | High | High | ~10 files | Batch 6 |
| **8** Submissions _lib | Low | Medium | 2 files | Batch 1 |
| **9** Debug upgrade | Low | Medium | ~12 files | None |
| **10** CI/tooling | Low | Low | 3 files | None |

**Recommended order:** 1 → 2 → 4 → 5 → 10 → 8 → 9 → 6 → 7

(Batches 6 & 7 are highest risk and most disruptive — do them last when everything else is stable.)

---

## ROLLBACK STRATEGY

Each batch is a **single atomic commit**. If a batch causes regression:
1. `git revert HEAD` to undo the last commit
2. Fix the issue
3. Re-commit with the fix

No batch should leave the codebase in a broken state. Every commit must pass `bun run lint`.
