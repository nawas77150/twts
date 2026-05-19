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
- [x] `bun run lint` passes
- [x] `grep -r "as PostMethod" src/` returns 0 results (all renamed)
- [x] `grep -r "PostMethodResult" src/` returns matches in types/index.ts + submission-card.tsx
- [x] `grep -r "PostMethodSetting" src/` returns matches in types/index.ts + hooks + api-fallback-card
- [x] `grep -r "interface FilterRules" src/` returns only 1 definition (content-filter-engine.ts)
- [x] `grep -r "const DEFAULT_FILTER_RULES" src/` returns only 1 definition (content-filter-engine.ts)
- [x] `grep -r "from '@/types'" src/components/` all still resolve (re-exports work)
- [x] No circular imports: `grep -r "from '@/types'" src/lib/content-filter-engine.ts` returns 0 results
- [x] TypeScript compiles without errors

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
- [x] `bun install` succeeds
- [x] `bun run lint` passes
- [x] `grep -r "from 'sonner'" src/` returns 0 results (already verified)
- [x] `grep -r "from '@tanstack/react-query'" src/` returns 0 results (already verified)

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
- [x] `grep -rn "as PostMethod" src/` returns 0 results
- [x] `grep -rn "as PostMethodSetting" src/` returns 4 results (the renamed casts)
- [x] `grep -rn "PostMethod[^SR]" src/` — only the deprecated shim and comments should remain

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
- [x] `bun run db:push` succeeds (new index created)
- [x] `bun run lint` passes
- [x] `getFilterSettings` is called once per submission POST (not 3x)
- [x] Cache invalidation works: save settings → next getFilterSettings returns fresh data
- [x] Circuit breaker status uses 1 findMany instead of 2 findUnique calls
- [x] `grep -rn "await getGeminiApiKey()" src/` returns 0 results (or only the deprecated shim)

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
- [x] `/api/admin/session` returns 200 when admin cookie is valid
- [x] `/api/admin/session` returns 401 when no cookie / invalid cookie
- [x] Admin login flow still works (login → redirect → session check)
- [x] `bun run lint` passes
- [x] No `getStats()` call in use-admin-auth.ts anymore

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

  // Fetch on auth change + 15s auto-refresh (keeps pendingCount badge fresh on all pages)
  useEffect(() => {
    if (!isAdmin) return
    void fetchStats()
    const interval = setInterval(() => { void fetchStats() }, 15000)
    return () => { clearInterval(interval) }
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

// After (Batch 6 intermediate — adminToken still needed for hooks that haven't been updated yet):
const { isAdmin, adminToken } = useAdminAuth()
const { stats, cookieStatus, postMethodStats, apiCredits, apiLoginStatus, fetchStats, refetch: refetchStats } = useAdminStats()
```

**Note:** `adminToken` is kept in the destructure for Batch 6 because `useSubmissions` and `useSubmitters` still need it (Batch 7 removes it). `useStats()` is fully replaced by `useAdminStats()` though — `adminToken` is no longer passed to a stats hook.

**Remove:** `useStats()` import — replaced by `useAdminStats()`.
**Remove:** `window.dispatchEvent(new CustomEvent('stats-update', ...))` — no longer needed.
**Remove:** Separate 15s auto-refresh on dashboard — moved into `AdminStatsProvider` so all pages benefit.

### 6E. Update `src/app/admin/settings/page.tsx`

```tsx
// Before:
const { adminToken } = useAdminAuth()
const stats = useStatsSummary({ adminToken })

// After:
const { adminToken } = useAdminAuth()  // temporarily still needed for hooks (Batch 7 removes it)
const stats = useStatsSummary({ adminToken })
const { refetch: refetchAdminStats } = useAdminStats()  // for badge sync
```

**Badge fix (temporary double-call — eliminated in Batch 7):** The layout now gets `pendingCount` from `AdminStatsProvider`, which auto-refreshes every 15s. For immediate badge updates after settings mutations, call `refetchAdminStats()` alongside `stats.refetch()` in the wrapper callbacks. This creates a temporary double API call per save (`getSummary()` + `getStats()`), which is acceptable as an intermediate state — Batch 7 eliminates it by replacing `useStatsSummary()` with `useAdminStats()` (Option B, single stats source).

```tsx
// Example — update all wrapper actions to also refresh admin stats:
const postingSaveSetting = useCallback(async (key: string, value: string, onSuccess?: () => void, onFailure?: () => void) => {
  await posting.saveSetting(key, value, () => {
    onSuccess?.()
    stats.refetch()
    refetchAdminStats()  // ← keeps badge in sync immediately (temporary, Batch 7 removes this double-call)
  }, onFailure)
}, [posting, stats, refetchAdminStats])
```

Apply the same `refetchAdminStats()` addition to all wrapper callbacks: `postingClearCache`, `postingSaveAllCredentials`, `filterSaveFilterSettings`, `filterSaveGeminiKey`, `handleRefreshCredits`.

**Bug fix — `useStatsSummary` drops `encryptionEnabled`:** The `buildStatsFromSummary()` helper in `use-stats-summary.ts` doesn't include `encryptionEnabled` in its return, even though the summary API returns it. This means `stats.stats?.encryptionEnabled` on the settings page is always `undefined` → the `EncryptionBanner` never shows. Fix by adding to `buildStatsFromSummary`:

```ts
// In buildStatsFromSummary(), add to the return object:
encryptionEnabled: data.encryptionEnabled ?? prev?.encryptionEnabled ?? undefined,
```

And add `'encryptionEnabled'` to the `Pick<Stats, ...>` in the `SummaryData` type.

### Batch 6 Verification Checklist
- [ ] Admin login/logout works via context
- [ ] Dashboard page shows stats from context
- [ ] Layout header badge shows pendingCount from context (no separate fetch)
- [ ] Settings page badge stays in sync after mutations (refetchAdminStats alongside stats.refetch — temporary double-call, Batch 7 eliminates)
- [ ] No `window.dispatchEvent('stats-update', ...)` anywhere
- [ ] No separate `apiClient.getStats()` in layout.tsx
- [ ] AdminStatsProvider has 15s auto-refresh interval
- [ ] `encryptionEnabled` flows through `buildStatsFromSummary` (EncryptionBanner shows on settings page)
- [ ] `bun run lint` passes

### Commit Message
```
feat: add AdminAuthContext + AdminStatsContext

- AdminAuthProvider: session check, login/logout, isAdmin state
- AdminStatsProvider: shared stats, pendingCount, fetchStats/refetch + 15s auto-refresh
- Layout: use pendingCount from context instead of separate fetch
- Dashboard: use useAdminStats() instead of useStats({ adminToken })
- Settings: add refetchAdminStats() after mutations for badge sync (temporary double-call, Batch 7 eliminates via Option B)
- Remove stats-update custom event pattern (replaced by context)
- Fix encryptionEnabled missing from buildStatsFromSummary
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
  const fetchFoo = useCallback(async () => {
    if (!isAdmin) return
    // ...
  }, [isAdmin])
}
```

**⚠️ Design decision — `onStatsRefresh` replacement + single stats source (Option B):**

Hooks do NOT call `useAdminStats().refetch()` internally — that would cause double API calls. Instead, pages call `useAdminStats().refetch()` explicitly where needed.

The settings page previously used `useStatsSummary()` (lightweight `getSummary()`) alongside `useAdminStats()` (heavy `getStats()`), which caused double API calls on every save. This is eliminated by adopting **Option B**: the settings page reads from `useAdminStats()` only, making it the single source of truth for all stats. This means:
- `useStatsSummary()` is deleted (not updated) — no second stats source
- `apiClient.getSummary()` has zero client-side consumers after this
- `/api/admin/summary/route.ts` can optionally be deleted (server-side endpoint, no clients)
- Every save triggers exactly 1 API call (`refetchAdminStats()` → `getStats()`) instead of 2
- The "heavier data" concern is a red herring: `getStats()` only adds ~5ms of cheap SQL queries (submission GROUP BY, post method GROUP BY, submitter count) on top of what `getSummary()` already fetches. The expensive parts (`getCookieAuthStatus`, `getApiLoginStatus`, `getFilterSettings`) are identical in both endpoints.
- Badge is instantly synced — no stale badge or 15s delay

**Files to update (5 hooks) + 2 deletions:**

| Hook | adminToken uses | onStatsRefresh uses | Change |
|------|----------------|--------------------|----|
| `use-stats.ts` | 1 guard | 0 | **DELETE** — replaced by AdminStatsContext |
| `use-stats-summary.ts` | 1 guard | 0 | **DELETE** — replaced by AdminStatsContext (Option B) |
| `use-submissions.ts` | 2 guards (lines 43, 99) | 4 calls (lines 137, 151, 165, 183) | Remove param, use `isAdmin`, remove `onStatsRefresh` (dashboard page handles refresh) |
| `use-filter-settings.ts` | 4 guards (lines 57, 80, 97, 113) | 4 calls (lines 65, 87, 103, 143) | Remove param, use `isAdmin`, remove `onStatsRefresh` (settings page handles refresh) |
| `use-posting-settings.ts` | 0 guards (`adminToken` is destructured but unused) | 2 calls (lines 83, 132) | Remove param, remove `onStatsRefresh` (settings page handles refresh) |
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

**Dashboard `onStatsRefresh` replacement:** `useSubmissions` no longer calls `onStatsRefresh` after approve/reject/delete/retry. The dashboard must call `refetchStats()` (from `useAdminStats()`) explicitly after these actions. The easiest approach: wrap the action callbacks at the page level:

```tsx
const { approve: rawApprove, reject: rawReject, delete: rawDelete, retryPost: rawRetryPost } = useSubmissions({ isAdmin })
const approve = useCallback(async (id: string) => { await rawApprove(id); refetchStats() }, [rawApprove, refetchStats])
const reject = useCallback(async (id: string) => { await rawReject(id); refetchStats() }, [rawReject, refetchStats])
const deleteSubmission = useCallback(async (id: string) => { await rawDelete(id); refetchStats() }, [rawDelete, refetchStats])
const retryPost = useCallback(async (id: string) => { await rawRetryPost(id); refetchStats() }, [rawRetryPost, refetchStats])
```

**`admin/settings/page.tsx` (Option B — single stats source):**
```ts
// Before:
const { adminToken } = useAdminAuth()
const posting = usePostingSettings({ adminToken })
const filterSettings = useFilterSettings({ adminToken })
const circuitBreaker = useCircuitBreaker({ adminToken })
const stats = useStatsSummary({ adminToken })

// After (Option B — useAdminStats() replaces useStatsSummary() entirely):
const posting = usePostingSettings()
const filterSettings = useFilterSettings()
const circuitBreaker = useCircuitBreaker()
const { stats, cookieStatus, apiCredits, apiLoginStatus, refetch: refetchAdminStats } = useAdminStats()
```

**Single-call save pattern (no double API calls):**
The settings page no longer uses `useStatsSummary()`. All stats come from `useAdminStats()`. Every save action calls only `refetchAdminStats()` — one API call (`getStats()`) that refreshes both the settings page data AND the layout badge `pendingCount`.

The hooks themselves no longer call `onStatsRefresh?.()` — they simply remove it.

```tsx
const { stats, cookieStatus, apiCredits, apiLoginStatus, refetch: refetchAdminStats } = useAdminStats()

// In each wrapper callback — single call, handles both settings data + badge:
const postingSaveSetting = useCallback(async (key: string, value: string, onSuccess?: () => void, onFailure?: () => void) => {
  await posting.saveSetting(key, value, () => {
    onSuccess?.()
    refetchAdminStats()    // single call — refreshes settings + badge
  }, onFailure)
}, [posting, refetchAdminStats])
```

Apply this pattern to all wrapper callbacks: `postingSaveSetting`, `postingClearCache`, `postingSaveAllCredentials`, `filterSaveFilterSettings`, `filterSaveGeminiKey`, `handleRefreshCredits`.

**Settings page useEffect adjustments:**
Since `useStatsSummary()` returns `{ stats, cookieStatus, ... }` and `useAdminStats()` returns the same shape (`{ stats, cookieStatus, ... }`), the destructuring changes from:
```ts
// Before: stats is the hook object, stats.stats is the Stats value
const stats = useStatsSummary({ adminToken })
if (!stats.stats) return

// After: stats is the Stats value directly from context
const { stats, cookieStatus, ... } = useAdminStats()
if (!stats) return
```
All `stats.stats` references become `stats`, `stats.cookieStatus` becomes `cookieStatus`, etc.

### 7C. Remove `adminToken` from `AdminAuthContext`

After all hooks stop using `adminToken`, remove it from the context entirely:

```tsx
// In admin-auth-context.tsx:
interface AdminAuthState {
  isAdmin: boolean
  isChecking: boolean
  login: (password: string) => Promise<boolean>
  logout: () => Promise<void>
  loginPassword: string
  setLoginPassword: (v: string) => void
  loginOpen: boolean
  setLoginOpen: (v: boolean) => void
  // adminToken removed — no longer needed by any consumer
}
```

Remove `adminToken` state, `setAdminToken('session')` calls, and the `adminToken` prop from the Provider value. The `login` and `logout` callbacks no longer need to set it.

### 7D. Delete `use-stats.ts` + `use-stats-summary.ts`

After AdminStatsContext is in place and both stats hooks have zero consumers:
- `admin/page.tsx` uses `useAdminStats()` from context (Batch 6)
- `admin/settings/page.tsx` uses `useAdminStats()` from context (this batch, Option B)
- No other file imports `use-stats` or `use-stats-summary`

**Delete:**
- `src/hooks/use-stats.ts`
- `src/hooks/use-stats-summary.ts`

**Optionally delete (no more client-side consumers):**
- `src/app/api/admin/summary/route.ts` — the lightweight summary endpoint has no callers after `useStatsSummary` is removed. Can be deleted or kept as a dead endpoint for future use. Recommend deleting to avoid maintenance burden.
- `apiClient.getSummary()` method — no longer called by any client code

Verify nothing breaks after deletion.

### Batch 7 Verification Checklist
- [ ] `grep -rn "adminToken" src/hooks/` returns 0 results (all removed)
- [ ] `grep -rn "onStatsRefresh" src/` returns 0 results (all removed from hooks)
- [ ] `grep -rn "adminToken" src/contexts/` returns 0 results (removed from AdminAuthContext)
- [ ] Dashboard: approve/reject/delete/retry still triggers stats refresh (page-level wrappers call refetchStats)
- [ ] Settings: save triggers single `refetchAdminStats()` call (no double API calls)
- [ ] Settings page badge updates after mutations
- [ ] `use-stats.ts` is deleted
- [ ] `use-stats-summary.ts` is deleted
- [ ] No remaining imports of `useStatsSummary` or `useStats` anywhere in `src/`
- [ ] No remaining calls to `apiClient.getSummary()` in client code
- [ ] `bun run lint` passes

### Commit Message
```
refactor: remove adminToken prop drilling, replace with auth context

- 5 hooks: remove adminToken param, use useAdminAuth().isAdmin
- 5 hooks: remove onStatsRefresh param (pages call useAdminStats().refetch() explicitly)
- Remove adminToken from AdminAuthContext (no longer needed)
- Collapse use-submissions dual guard to single isAdmin check
- Delete use-stats.ts (replaced by AdminStatsContext)
- Delete use-stats-summary.ts (Option B: single stats source via useAdminStats)
- Settings page: replace useStatsSummary() with useAdminStats() — no double API calls
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
- [x] `submissions/route.ts` is under 150 lines (just GET + POST handlers)
- [x] `submissions/_lib.ts` contains all pipeline logic
- [x] Submission flow still works: submit → filter → auto-post
- [x] `bun run lint` passes

### Commit Message
```
refactor: extract submission pipeline to _lib.ts

Move validateSubmission, checkSubmissionRateLimits, runFilterPipeline,
createQueuedSubmission, getCensoredReason, logLimitHit, and shared
types to submissions/_lib.ts. Route file becomes thin GET/POST handler.
```

---

## BATCH 9: Debug System Upgrade

### 9A. `debug.ts` Signature Change

**File: `src/lib/debug.ts`**

```ts
/**
 * Namespaced debug logging with timestamps.
 *
 * Set DEBUG=1 or DEBUG=* to enable all namespaces.
 * Set DEBUG=submit,direct to enable specific namespaces (comma-separated).
 * Unset or empty to disable (production-clean logs).
 *
 * Usage:
 *   import { debug } from '@/lib/debug'
 *   debug('submit', 'Post succeeded! tweetId:', tweetId)
 *   debug('direct', 'Attempt', attempt, 'failed')
 */

const DEBUG_ENV = process.env.DEBUG || ''
const DEBUG_ALL = DEBUG_ENV === '1' || DEBUG_ENV === '*' || DEBUG_ENV === 'true'
const ENABLED_NAMESPACES = DEBUG_ALL ? null : new Set(DEBUG_ENV.split(',').map(s => s.trim()).filter(Boolean))

function isNamespaceEnabled(namespace: string): boolean {
  if (!DEBUG_ENV) return false
  if (DEBUG_ALL) return true
  return ENABLED_NAMESPACES!.has(namespace)
}

function timestamp(): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

export function debug(namespace: string, ...args: unknown[]): void {
  if (isNamespaceEnabled(namespace)) {
    console.log(`${timestamp()} [${namespace}]`, ...args)
  }
}

export function debugError(namespace: string, ...args: unknown[]): void {
  if (isNamespaceEnabled(namespace)) {
    console.error(`${timestamp()} [${namespace}]`, ...args)
  }
}
```

**Key design decisions:**
- `DEBUG=1`, `DEBUG=*`, `DEBUG=true` → all namespaces enabled (backward compatible)
- `DEBUG=submit,direct` → only those namespaces
- Empty/undefined `DEBUG` → nothing logs (production-safe)
- Timestamp format `HH:mm:ss.SSS` in every line
- Namespace printed as `[namespace]` replacing the old `['[namespace] message']` pattern
- `debugError` matches the new signature exactly

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
      ? [{ emit: 'event', level: 'query' }]
      : process.env.NODE_ENV === 'development'
        ? ['query']
        : ['error'],
  })

if (DEBUG_DB && !globalForPrisma.prisma) {
  db.$on('query', (e) => {
    console.log(`[db] ${e.query} — ${e.duration}ms`)
  })
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
```

**Key decisions:**
- `DEBUG_DB=1` → switches from `log: ['query']` to `log: [{ emit: 'event', level: 'query' }]` so we get duration
- `$on('query')` handler logs query + duration in ms
- Guard `!globalForPrisma.prisma` prevents duplicate listeners on Next.js hot reload
- Without `DEBUG_DB`, behavior is unchanged from current

**Also update `.env.example`** — add `# DEBUG_DB=1` in the OPTIONAL section (near `# DEBUG=`).

### 9C. Migrate All 84 Old-Style Calls + 6 Variable Calls

**Current pattern:** `debug('[submit] All filters passed')`
**New pattern:** `debug('submit', 'All filters passed')`

The namespace is extracted by removing the `[` `]` brackets and keeping only the namespace part (not the message after it).

**Category A — Old-style embedded-label calls (84 total) — need migration**

| File | Calls | Current embedded label | Correct namespace |
|------|------:|----------------------|-------------------|
| `submissions/route.ts` | 12 | `[submit]` | `submit` |
| `submissions/_lib.ts` | 12 | `[submit]` | `submit` |
| `twitter-post-cookie.ts` | 15 | `[direct]` | `direct` |
| `circuit-breaker.ts` | 7 | `[circuit-breaker]` | `circuit-breaker` |
| `gemini-filter.ts` | 7 | `[gemini-filter]` | `gemini-filter` |
| `execute-post.ts` | 6 | `[execute-post]` | `execute-post` |
| `autopost/route.ts` | 6 | `[autopost]` | `autopost` |
| `twitter-v2-login.ts` | 4 | `[twitterapi]` | `twitterapi` |
| `twitter-cookie-api.ts` | 3 | `[cookie-api]` | `cookie-api` |
| `x-transaction-id-pair.ts` | 3 | `[pair-dict]` | `pair-dict` |
| `submissions/[id]/route.ts` | 2 | `[approve route]` | `approve` |
| `submissions/[id]/post/route.ts` | 2 | `[post route]` | `retry` |
| `posting-lock.ts` | 2 | `[posting-lock]` | `posting-lock` |
| `test-x/route.ts` | 2 | `[test-x]` | `test-x` |
| `stale-posting.ts` | 1 | `[stale-posting]` | `stale-posting` |
| **Total** | **84** | | |

**Category B — Variable-first calls (6 total) — 5 passthrough + 1 code change**

Five of these already call `debug(variable, 'message')` where `variable` becomes the namespace argument automatically — no code change needed, only confirming the variable holds a valid namespace string at runtime.

**Exception:** `twitter-api-shared.ts:192` currently calls `debug(debugLabel, JSON.stringify(data))` with no context label in the second arg. After callers switch from `'[cookie-api] create_tweet_v2 response:'` to `'cookie-api'`, the log output loses its context (`[cookie-api] {"id":"..."}` — can't tell what produced this JSON). The fix is to add the context label back into the function body: `debug(debugLabel, 'create_tweet_v2 response:', JSON.stringify(data))`.

| File | Lines | Variable | Resolution |
|------|-------|----------|------------|
| `execute-post.ts` | 292, 308 | `logPrefix` | Passthrough — no code change; callers must pass clean namespace |
| `submissions/[id]/_lib.ts` | 96, 103, 110 | `logLabel` | Passthrough — no code change; callers must pass clean namespace |
| `twitter-api-shared.ts` | 192 | `debugLabel` | **Code change required** — add `'create_tweet_v2 response:'` as second arg |

#### File-by-File Migration Details

**1. `src/lib/circuit-breaker.ts` — 7 calls, namespace `circuit-breaker`**

Replace `debug('[circuit-breaker] ` with `debug('circuit-breaker', '` in every call.

**2. `src/lib/execute-post.ts` — 6 static + 2 variable, namespace `execute-post`**

Static calls (lines 141, 157, 166, 184, 203, 222): Replace `debug('[execute-post] ` with `debug('execute-post', '`

Variable calls (lines 292, 308): **No change needed.** `logPrefix` is a parameter — callers pass the namespace.

**3. `src/lib/twitter-post-cookie.ts` — 15 calls, namespace `direct`**

Replace `debug('[direct] ` with `debug('direct', '` in every call.

**4. `src/lib/twitter-cookie-api.ts` — 3 calls, namespace `cookie-api`**

Replace `debug('[cookie-api] ` with `debug('cookie-api', '` in every call.

**5. `src/lib/twitter-v2-login.ts` — 4 calls, namespace `twitterapi`**

Replace `debug('[twitterapi] ` with `debug('twitterapi', '` in every call.

**6. `src/lib/twitter-api-shared.ts` — 1 variable call**

Line 192: `debug(debugLabel, JSON.stringify(data))` → `debug(debugLabel, 'create_tweet_v2 response:', JSON.stringify(data))`

The message part (`'create_tweet_v2 response:'`) moves into the function body since it's always the same context.

**7. `src/lib/gemini-filter.ts` — 7 calls, namespace `gemini-filter`**

Replace `debug('[gemini-filter] ` with `debug('gemini-filter', '` in every call.

**8. `src/lib/x-transaction-id-pair.ts` — 3 calls, namespace `pair-dict`**

Replace `debug('[pair-dict] ` with `debug('pair-dict', '` in every call. Note: one call spans multiple lines (126-129).

**9. `src/lib/stale-posting.ts` — 1 call, namespace `stale-posting`**

Replace `debug('[stale-posting] ` with `debug('stale-posting', '`.

**10. `src/lib/posting-lock.ts` — 2 calls, namespace `posting-lock`**

Replace `debug('[posting-lock]', ` with `debug('posting-lock', ` (note: no message after the bracket — the second arg is the first message).

**11. `src/app/api/submissions/route.ts` — 12 calls, namespace `submit`**

Replace `debug('[submit] ` with `debug('submit', '` in every call.

**12. `src/app/api/submissions/_lib.ts` — 12 calls, namespace `submit`**

Replace `debug('[submit] ` with `debug('submit', '` in every call.

**13. `src/app/api/submissions/[id]/route.ts` — 2 calls, namespace `approve`**

Replace `debug('[approve route] ` with `debug('approve', '` in every call.

**14. `src/app/api/submissions/[id]/_lib.ts` — 3 variable calls**

Lines 96, 103, 110: **No change needed.** `logLabel` is a parameter — callers pass the namespace.

**15. `src/app/api/submissions/[id]/post/route.ts` — 2 calls, namespace `retry`**

Replace `debug('[post route] ` with `debug('retry', '` in every call.

**16. `src/app/api/autopost/route.ts` — 6 calls, namespace `autopost`**

Replace `debug('[autopost] ` with `debug('autopost', '` in every call.

**17. `src/app/api/test-x/route.ts` — 2 calls, namespace `test-x`**

Replace `debug('[test-x] ` with `debug('test-x', '` in every call.

**18. `src/lib/twitter-api-fallback.ts` — SKIP**

Zero debug calls. Nothing to do. (The original monolith had 10 calls; they were moved to `twitter-cookie-api.ts`, `twitter-v2-login.ts`, and `twitter-api-shared.ts` during the split refactor.)

#### Caller-Only Updates (7 sites)

These are lines where a namespace string is passed as an argument to a function (not a `debug()` call itself), but must be updated to match the new namespace convention:

> **Note on Batch 8 interaction:** The `createCooldownWindowChecks` call at `submissions/route.ts:258` was NOT moved by Batch 8. Batch 8 only extracted `runFilterPipeline` (filter/validation logic) to `_lib.ts`. The posting logic — including `executePostAndRecord`, `createCooldownWindowChecks`, and all post-result debug calls — remained in `route.ts`. The target file is correct.

| File | Line | Before | After |
|------|------|--------|-------|
| `submissions/route.ts` | 258 | `createCooldownWindowChecks(..., '[submit]')` | `createCooldownWindowChecks(..., 'submit')` |
| `autopost/route.ts` | 137 | `createCooldownWindowChecks(..., '[autopost]')` | `createCooldownWindowChecks(..., 'autopost')` |
| `submissions/[id]/route.ts` | ~50 | `handlePostEarlyReturns(postResult, '[approve route]')` | `handlePostEarlyReturns(postResult, 'approve')` |
| `submissions/[id]/post/route.ts` | ~28 | `handlePostEarlyReturns(postResult, '[post route]')` | `handlePostEarlyReturns(postResult, 'retry')` |
| `twitter-cookie-api.ts` | 167 | `callCreateTweetV2(apiKey, body, '[cookie-api] create_tweet_v2 response:')` | `callCreateTweetV2(apiKey, body, 'cookie-api')` |
| `twitter-v2-login.ts` | 235 | `callCreateTweetV2(apiKey, retryBody, '[twitterapi] create_tweet_v2 retry response:')` | `callCreateTweetV2(apiKey, retryBody, 'twitterapi')` |
| `twitter-v2-login.ts` | 317 | `callCreateTweetV2(apiKey, body, '[twitterapi] create_tweet_v2 response:')` | `callCreateTweetV2(apiKey, body, 'twitterapi')` |

### Execution Order

1. **Write new `debug.ts`** (signature change)
2. **Update `db.ts`** (9B — DB query duration logging)
3. **Update `.env.example`** (add `# DEBUG_DB=1`)
4. **Migrate all 17 files** (84 static calls + 1 shared function body change + 7 caller updates)
5. **Run verification**

### Batch 9 Verification Checklist
- [x] `grep -rn "debug('\[" src/` returns 0 results (no old-style embedded-label calls remain)
- [x] `grep -rn "'\[submit\]\|'\[autopost\]\|'\[approve route\]\|'\[post route\]\|'\[cookie-api\]\|'\[twitterapi\]" src/` returns 0 results (all callers pass clean namespace strings)
- [x] `grep -rn "debug(logPrefix\|debug(logLabel\|debug(debugLabel" src/` returns 6 results (passthrough variables unchanged)
- [x] `grep -n "create_tweet_v2 response" src/lib/twitter-api-shared.ts` confirms the context label was added to line 192 (Bug #1 fix)
- [x] Total debug call count per file matches: 7+8+15+3+4+7+3+1+2+1+12+12+2+3+2+6+2 = 90
- [x] `grep -n "debug" src/lib/twitter-api-fallback.ts` returns 0 results (file not touched)
- [x] `grep "globalForPrisma.prisma" src/lib/db.ts` shows the hot-reload guard condition
- [x] `bun run ci` passes (typecheck + lint)
- [x] `DEBUG=1` — all debug messages show with timestamps
- [x] `DEBUG=submit` — only submit namespace messages show
- [x] `DEBUG_DB=1` — query duration logs appear

### Commit Message
```
feat: namespaced debug logging with timestamps, DB query duration

- debug(): now takes (namespace, ...args) instead of (...args)
- Supports DEBUG=1 (all), DEBUG=direct,submit (specific namespaces)
- Always includes HH:mm:ss.SSS timestamp in output
- DEBUG_DB=1 enables Prisma query duration logging
- Migrate 84 old-style debug() calls across 17 files
- 7 caller-site updates for variable-namespace passthrough
- twitter-api-fallback.ts: no changes needed (zero debug calls)
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
- [x] `bun run typecheck` passes
- [x] `bun run ci` passes (typecheck + lint)
- [x] `bun run db:studio` launches Prisma Studio
- [x] tsconfig: `noImplicitReturns` catches missing returns
- [x] tsconfig: `noFallthroughCasesInSwitch` catches switch fallthroughs
- [x] `.env.development` loaded by Next.js in dev mode

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
| **9** Debug upgrade | Low | Medium | ~19 files | None |
| **10** CI/tooling | Low | Low | 3 files | None |

**Recommended order:** 1 → 2 → 4 → 5 → 10 → 8 → 9 → 6 → 7

(Batches 6 & 7 are highest risk and most disruptive — do them last when everything else is stable.)

---

## FINAL CLEANUP (After All Batches Complete)

### Remove PostMethod Backward Compat Shim

**File: `src/types/index.ts`**

After all batches are done, grep the codebase for any remaining `PostMethod` usage. If zero consumers remain, delete the shim:
```ts
// DELETE this line:
/** @deprecated Use PostMethodSetting or PostMethodResult instead */
export type PostMethod = PostMethodSetting
```

**Verification:**
- [ ] `grep -rn "PostMethod[^SR]" src/` returns 0 results (no consumers of bare `PostMethod`)
- [ ] `bun run lint` passes
- [ ] `npx tsc --noEmit` passes

---

## ROLLBACK STRATEGY

Each batch is a **single atomic commit**. If a batch causes regression:
1. `git revert HEAD` to undo the last commit
2. Fix the issue
3. Re-commit with the fix

No batch should leave the codebase in a broken state. Every commit must pass `bun run lint`.
