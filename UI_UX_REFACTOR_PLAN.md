# Tweetfess UI/UX Refactor Plan — Sync Frontend with Backend

> **Goal**: Make the UI feel instantly connected to the backend — every action produces an immediate, accurate visual response.  
> **Constraints**: No new backend features. No new API routes. No database changes. Keep current layout. Vercel serverless deployment.  
> **Principle**: Every change must be verifiable against the existing code. No regressions. No new bugs.

---

## Table of Contents

1. [Audit Findings](#1-audit-findings)
2. [Scope & Anti-Scope](#2-scope--anti-scope)
3. [Phase A — Optimistic Admin Actions + Instant Stats](#3-phase-a--optimistic-admin-actions--instant-stats)
4. [Phase B — Loading & Error State Consistency](#4-phase-b--loading--error-state-consistency)
5. [Phase C — Public Page Reactivity](#5-phase-c--public-page-reactivity)
6. [Phase D — Settings Sync Hardening](#6-phase-d--settings-sync-hardening)
7. [Phase E — Micro-Polish](#7-phase-e--micro-polish)
8. [Risk Analysis & Mitigations](#8-risk-analysis--mitigations)
9. [Verification Checklist](#9-verification-checklist)
10. [Vercel Deployment Considerations](#10-vercel-deployment-considerations)

---

## 1. Audit Findings

### Finding F1: Admin actions have no optimistic update

**Evidence** (from `src/hooks/use-submissions.ts` lines 135-201):

```ts
const approve = useCallback(async (id: string) => {
  setActionLoading(id)
  try {
    const data = await apiClient.approveSubmission(id)
    // ... toast based on response ...
    void fetchSubmissions(true) // ← silent refetch, 1-2s lag
  } catch (err: unknown) { /* ... */ }
  finally { setActionLoading(null) }
}, [fetchSubmissions, toast])
```

Same pattern for `reject`, `deleteSubmission`, `retryPost`. After the API call succeeds, a silent refetch is fired. The card stays in its old state until the refetch completes. The user sees no visual change for 1-2 seconds.

**Impact**: The dashboard feels disconnected. The user's own example — "when I click Setujui the dashboard stats update instantly" — is exactly what's missing.

### Finding F2: Stats and submissions have independent 15s polls that drift

**Evidence** (from `src/contexts/admin-stats-context.tsx` lines 53-62):

```ts
const interval = setInterval(() => {
  if (!document.hidden) {
    void fetchStatsRef.current()
  }
}, 15000)
```

And from `src/hooks/use-submissions.ts` lines 91-102:

```ts
const interval = setInterval(() => {
  if (!document.hidden) {
    void fetchSubmissions(true)
  }
}, 15000)
```

Two independent intervals, no coordination. After an action, `refetchStats()` and `fetchSubmissions(true)` are fired in parallel from `src/app/admin/page.tsx` lines 50-53:

```ts
const approve = useCallback(async (id: string) => {
  await rawApprove(id); void refetchStats()
}, [rawApprove, refetchStats])
```

Stats counts and the submission list can be out of sync for up to 15 seconds. The filter pill counts (from `stats`) don't match the visible list (from `useSubmissions`).

### Finding F3: Stats grid shows nothing while loading

**Evidence** (from `src/app/admin/page.tsx` lines 94-102):

```tsx
{stats && (
  <StatsGrid stats={stats} onPenggunaClick={...} />
)}
```

When `stats === null` (initial load), the grid simply doesn't render. There's blank space where 8 stat cards should be.

### Finding F4: Stats fetch silently fails with no user indication

**Evidence** (from `src/contexts/admin-stats-context.tsx` lines 30-42):

```ts
const fetchStats = useCallback(async () => {
  try {
    const data = await apiClient.getStats()
    // ... set state ...
  } catch {
    // silently fail — next fetch will retry
  }
}, [])
```

If the server is down or returns an error, the user sees stale data with no indication that it's stale. No error banner, no retry button, no "last updated" timestamp.

### Finding F5: `actionLoading` disables ALL buttons on ALL cards

**Evidence** (from `src/components/dashboard/submission-card.tsx` lines 131-182):

```tsx
<Button onClick={() => { onApprove(sub.id) }} disabled={!!actionLoading} ...>
<Button variant="destructive" onClick={() => { onReject(sub.id) }} disabled={!!actionLoading} ...>
```

`actionLoading` is a single `string | null` (the submission ID being acted on). The `disabled={!!actionLoading}` check disables buttons on ALL cards, not just the one being acted on. If you approve one card, you can't interact with any other card.

### Finding F6: LimitHealthCard silently fails

**Evidence** (from `src/components/settings/limit-health-card.tsx` lines 41-51):

```ts
try {
  const res = await apiClient.getLimitHits()
  setData(res)
} catch {
  // Silently fail — admin can retry
}
```

If the fetch fails, `data` stays `null`. The UI shows the loading spinner forever (because `loading` goes to false but `data` is still null, and the component renders nothing when `!data && !loading`). Actually, reviewing more carefully: `loading && !data` shows the spinner, `data && (...)` shows the content. If the fetch fails, neither condition is true — the card body is completely empty. No error state, no retry button.

### Finding F7: PostMethodRates disappears on empty data

**Evidence** (from `src/app/admin/page.tsx` lines 128-129):

```tsx
{postMethodStats && postMethodStats.total > 0 && (
  <PostMethodRates postMethodStats={postMethodStats} />
)}
```

And from `src/components/dashboard/post-method-rates.tsx` line 12:

```ts
if (postMethodStats.total === 0) return null
```

When total is 0 or stats haven't loaded yet, the component simply doesn't render. No placeholder, no skeleton.

### Finding F8: EncryptionBanner has no loading state

**Evidence** (from `src/components/dashboard/encryption-banner.tsx` lines 9-11):

```ts
if (encryptionEnabled === undefined || encryptionEnabled === true) return null
```

`undefined` means "still loading" but the component returns null — no loading indicator.

### Finding F9: MyPosts has no auto-refresh

**Evidence** (from `src/hooks/use-my-posts.ts` lines 41-49):

```ts
useEffect(() => {
  if (submitter && !isAnonUser) {
    void fetchMyPosts()
  } else {
    setMyPosts([]); setLimits(null); setError(null)
  }
}, [submitter, isAnonUser, fetchMyPosts])
```

Only fetches on login. No interval. After submitting, `refetchMyPosts()` is called once. Status changes (e.g., pending → posted by admin) are never reflected until the user manually submits again or refreshes the page.

### Finding F10: Cooldown is a static number, not a live countdown

**Evidence** (from `src/components/submit/confession-form.tsx` lines 124-126):

```ts
{limits.cooldownSeconds > 0
  ? `cooldown ${limits.cooldownSeconds < 60 ? `${limits.cooldownSeconds}s` : `${Math.ceil(limits.cooldownSeconds / 60)}m`}`
  : 'siap kirim'}
```

Shows a static string like "cooldown 5m". No countdown. User has to manually refresh to see when cooldown expires.

### Finding F11: Circuit breaker reset doesn't revert on failure

**Evidence** (from `src/hooks/use-circuit-breaker.ts` lines 65-78):

```ts
const reset = useCallback(async () => {
  try {
    await apiClient.resetCircuitBreaker()
    setCircuitBreakerStatus((prev) => prev ? { ...prev, paused: false, failCount: 0, pausedUntil: null } : null)
    toast({ title: 'Circuit breaker direset' })
  } catch {
    toast({ title: 'Gagal mereset circuit breaker', ... })
    // ← no revert of the optimistic update
  }
}, [isAdmin, toast])
```

The optimistic update (`paused: false, failCount: 0`) is applied before the API call's success/failure is known. Actually wait — re-reading: the optimistic update is applied AFTER `await apiClient.resetCircuitBreaker()` succeeds. So this is NOT an optimistic update — it waits for the API response. The issue is moot. Removing from scope.

### Finding F12: Shared `isSaving` between `saveFilterSettings` and `saveRateLimits`

**Evidence** (from `src/hooks/use-filter-settings.ts` lines 19, 109, 145):

Both `saveFilterSettings` and `saveRateLimits` set `isSaving(true)` / `isSaving(false)`. They're on different tabs (Filter vs Limits) so they can't conflict today. But it's fragile — if someone adds a "save all" button or the tabs change, it would break.

### Finding F13: Block/unblock in UsersDialog doesn't revert on API error-in-response

**Evidence** (from `src/hooks/use-submitters.ts` lines 31-55):

```ts
const toggleBlock = useCallback(async (username, action) => {
  try {
    const data = await apiCall
    if (!data.error) {
      setBlockedUsernames(prev => ...)  // ← only updates on success
      toast({ title: ... })
    } else {
      toast({ title: 'Gagal', description: data.error, variant: 'destructive' })
    }
  } catch { toast(...) }
}, ...)
```

This is actually correct — it only updates `blockedUsernames` on success. No revert needed. The UI correctly stays as-is on failure. However, the block/unblock buttons in UsersDialog have no loading state — the user can spam-click.

### Finding F14: Two sources of truth for `blockedUsernames`

**Evidence**: 
- `src/hooks/use-submitters.ts` line 12: `const [blockedUsernames, setBlockedUsernames] = useState<string[]>([])`
- `src/hooks/use-filter-settings.ts` line 27: `const [blockedUsernames, setBlockedUsernames] = useState<string[]>([])`
- `src/app/admin/page.tsx` lines 68-72: Syncs from stats to `useSubmitters`:
  ```ts
  useEffect(() => {
    if (stats?.filterSettings?.blockedUsernames) {
      setBlockedUsernames(stats.filterSettings.blockedUsernames)
    }
  }, [stats?.filterSettings?.blockedUsernames, setBlockedUsernames])
  ```

The dashboard page uses `useSubmitters.blockedUsernames` while the settings page uses `useFilterSettings.blockedUsernames`. They can momentarily disagree.

---

## 2. Scope & Anti-Scope

### IN SCOPE (sync improvements, no new features)

| Item | What | Why |
|------|------|-----|
| A1 | Optimistic update on approve/reject/delete/retry | F1 — biggest UX win |
| A2 | `adjustStats()` on AdminStatsContext | Required for A1 to update stats instantly |
| A3 | Per-card action loading (not global) | F5 — unblock other cards during action |
| A4 | Stats grid skeleton | F3 — blank space on initial load |
| A5 | Stats stale indicator + error state | F4 — silent failures |
| B1 | LimitHealthCard error state | F6 — empty card on failure |
| B2 | PostMethodRates empty/loading state | F7 — disappears |
| B3 | EncryptionBanner loading shimmer | F8 — no indication |
| C1 | MyPosts conditional auto-poll | F9 — status never updates |
| C2 | Cooldown live countdown | F10 — static number |
| D1 | Split `isSaving` into `isSavingFilter` + `isSavingRateLimits` | F12 — fragile shared state |
| E1 | Pending count badge subtle pulse | Polish — draw attention |
| E2 | Refresh button counterclockwise spin | Polish — UX convention |

### OUT OF SCOPE (too risky, too close to new feature, or unnecessary)

| Item | What | Why excluded |
|------|------|-------------|
| ~~Settings drift detection~~ | "Settings updated externally" banner | Requires deep object comparison on every 15s poll. Expensive. Error-prone. Edge case (multi-admin). |
| ~~Unify blockedUsernames sources~~ | Single source of truth | Refactor that could introduce regressions. Current dual-source works — the sync effect keeps them aligned. |
| ~~Sequential refetch~~ | Stats first, then list | Adds latency to the refetch. Better to keep parallel and use `adjustStats()` to bridge the gap. |
| ~~Smart page nav after delete~~ | Auto-navigate to prev page if current page becomes empty | Edge case: the silent refetch will correct this in ~1s. Adding navigation logic introduces race conditions with the refetch. |
| ~~Stats number animation~~ | Animate number changes | Risk of layout shifts and unnecessary re-renders. Not worth the complexity. |
| ~~Filter pill transition animation~~ | Smooth background-color/scale | Minor polish, not a sync issue. |
| ~~Submission card status flash~~ | Ring animation on status change | Complex to implement correctly with AnimatePresence + optimistic updates. |
| ~~Optimistic MyPosts prepend~~ | Add new submission to local array after submit | We don't have the full `Submission` object (no `id`, no `createdAt`) from the submit response. Would need to fabricate data, which is fragile. Just refetch instead. |
| ~~Block/unblock loading state in UsersDialog~~ | Prevent spam-clicking | The buttons already call `void onBlock/onUnblock` which are async. Adding per-button loading would require tracking `blockingUsername` state. Minor improvement, not a sync issue. |

---

## 3. Phase A — Optimistic Admin Actions + Instant Stats

**Goal**: When admin clicks Setujui/Tolak/Delete/Retry, the card and stats grid update instantly. If the API fails, they revert.

### A1: Add `adjustStats()` to AdminStatsContext

**File**: `src/contexts/admin-stats-context.tsx`

**Current interface** (line 8):
```ts
interface AdminStatsState {
  stats: Stats | null
  // ... other fields ...
  fetchStats: () => Promise<void>
  refetch: () => Promise<void>
}
```

**Change**: Add `adjustStats` method:
```ts
interface AdminStatsState {
  stats: Stats | null
  // ... other fields ...
  fetchStats: () => Promise<void>
  refetch: () => Promise<void>
  adjustStats: (patch: Partial<Stats>) => void  // NEW
}
```

**Implementation**:
```ts
const adjustStats = useCallback((patch: Partial<Stats>) => {
  setStats((prev) => {
    if (!prev) return prev  // can't adjust what doesn't exist
    return { ...prev, ...patch }
  })
  // Also update pendingCount if pending changed
  if (patch.pending !== undefined) {
    setPendingCount(patch.pending)
  }
}, [])
```

**Verification**:
- `adjustStats({ pending: 4 })` should update `stats.pending` and `pendingCount` immediately
- `adjustStats({})` should be a no-op
- `adjustStats` when `stats === null` should be a no-op
- The next `fetchStats()` call will overwrite with authoritative values, correcting any drift

**Risk**: Low. This is a pure local state update. The 15s poll provides automatic correction.

### A2: Optimistic updates in `useSubmissions`

**File**: `src/hooks/use-submissions.ts`

**Current** (lines 135-201): approve/reject/delete/retry all follow the same pattern:
1. `setActionLoading(id)`
2. Call API
3. Toast
4. `void fetchSubmissions(true)` (silent refetch)
5. `setActionLoading(null)`

**Change**: Replace the silent refetch with an immediate local state mutation. The page-level wrapper (`src/app/admin/page.tsx` lines 50-53) calls `refetchStats()` after each action — this will be replaced with `adjustStats()`.

**New `approve` implementation**:
```ts
const approve = useCallback(async (id: string) => {
  setActionLoading(id)
  // Snapshot for revert
  const prevSubmissions = submissionsRef.current
  
  // Optimistic: update local submission status
  setSubmissions((prev) =>
    prev.map((s) => s.id === id ? { ...s, status: 'posting' as SubmissionStatus } : s)
  )
  
  try {
    const data = await apiClient.approveSubmission(id)
    if (data.autoPosted) {
      // Refine: if auto-posted, set to 'posted' with postMethod
      const postMethod = data.postMethod as PostMethodResult | null
      setSubmissions((prev) =>
        prev.map((s) => s.id === id ? { ...s, status: 'posted', postMethod, tweetId: null } : s)
      )
      // ... toast ...
    } else if (data.warning) {
      // Still 'posting' — admin approved but posting is async
      // ... toast ...
    } else if (data.error) {
      // API succeeded but posting failed — status is still 'posting' on server
      // Revert to original since server may have left it in a different state
      setSubmissions(prevSubmissions)
      // ... toast ...
    } else {
      // Default: status is 'posting'
      // ... toast ...
    }
  } catch (err: unknown) {
    // Revert on network error
    setSubmissions(prevSubmissions)
    toast({ title: 'Gagal', description: getErrorMessage(err, 'Gagal menyetujui'), variant: 'destructive' })
  } finally {
    setActionLoading(null)
  }
}, [toast])
```

**Problem**: `submissionsRef` doesn't exist yet. Need to add it.

**Add `submissionsRef`**:
```ts
const submissionsRef = useRef(submissions)
submissionsRef.current = submissions
```

**New `reject` implementation**:
```ts
const reject = useCallback(async (id: string) => {
  setActionLoading(id)
  const prevSubmissions = submissionsRef.current
  
  // Optimistic: remove from list (or change status to 'rejected')
  // Strategy: change status to 'rejected' so the card updates in-place
  // If the user is filtering by 'pending', the card will still show but with 'rejected' badge
  // The next fetchSubmissions will remove it from the filtered view
  setSubmissions((prev) =>
    prev.map((s) => s.id === id ? { ...s, status: 'rejected' as SubmissionStatus } : s)
  )
  
  try {
    await apiClient.rejectSubmission(id)
    toast({ title: 'Ditolak', description: 'Pesan telah ditolak.' })
  } catch (err: unknown) {
    setSubmissions(prevSubmissions)
    toast({ title: 'Gagal', description: getErrorMessage(err, 'Gagal menolak'), variant: 'destructive' })
  } finally {
    setActionLoading(null)
  }
}, [toast])
```

**New `deleteSubmission` implementation**:
```ts
const deleteSubmission = useCallback(async (id: string) => {
  setActionLoading(id)
  const prevSubmissions = submissionsRef.current
  
  // Optimistic: remove from list immediately
  setSubmissions((prev) => prev.filter((s) => s.id !== id))
  
  try {
    await apiClient.deleteSubmission(id)
    toast({ title: 'Dihapus' })
  } catch {
    setSubmissions(prevSubmissions)
    toast({ title: 'Error', description: 'Gagal menghapus', variant: 'destructive' })
  } finally {
    setActionLoading(null)
  }
}, [toast])
```

**New `retryPost` implementation**:
```ts
const retryPost = useCallback(async (id: string) => {
  setActionLoading(id)
  const prevSubmissions = submissionsRef.current
  
  // Optimistic: change status to 'posting'
  setSubmissions((prev) =>
    prev.map((s) => s.id === id ? { ...s, status: 'posting' as SubmissionStatus, postError: null } : s)
  )
  
  try {
    const data = await apiClient.retryPost(id)
    if (data.error) {
      // Revert — posting failed
      setSubmissions(prevSubmissions)
      toast({ title: 'Gagal posting', description: data.error, variant: 'destructive' })
      return
    }
    // Refine: set to 'posted' if tweetId returned
    setSubmissions((prev) =>
      prev.map((s) => s.id === id ? { ...s, status: 'posted' as SubmissionStatus, tweetId: data.tweetId ?? null } : s)
    )
    toast({ title: 'Berhasil diposting ke X!', description: data.tweetId ? `Tweet ID: ${data.tweetId}` : undefined })
  } catch (err: unknown) {
    setSubmissions(prevSubmissions)
    toast({ title: 'Gagal posting', description: getErrorMessage(err, 'Gagal posting ke X'), variant: 'destructive' })
  } finally {
    setActionLoading(null)
  }
}, [toast])
```

**Remove `fetchSubmissions` dependency from actions**: The `approve`, `reject`, `deleteSubmission`, and `retryPost` callbacks no longer call `fetchSubmissions(true)`. This removes them from the `[fetchSubmissions, toast]` dependency array, simplifying the hooks.

**Important**: The page-level wrappers in `src/app/admin/page.tsx` (lines 50-53) currently call `refetchStats()` after each action. These will be changed to call `adjustStats()` with the appropriate delta instead.

**Verification for A2**:
- Click Setujui on a pending card → card status changes to "Posting" or "Diposting" instantly
- Click Tolak on a pending card → card status changes to "Ditolak" instantly
- Click × (delete) on any card → card disappears instantly with AnimatePresence exit animation
- Click Retry Post on a failed card → card status changes to "Posting" instantly
- If API call fails → card reverts to its original state
- The 15s silent poll still fires and will correct any drift
- No duplicate fetches (removed `fetchSubmissions(true)` from actions)

### A3: Page-level `adjustStats` integration

**File**: `src/app/admin/page.tsx`

**Current** (lines 50-53):
```ts
const approve = useCallback(async (id: string) => { await rawApprove(id); void refetchStats() }, [rawApprove, refetchStats])
const reject = useCallback(async (id: string) => { await rawReject(id); void refetchStats() }, [rawReject, refetchStats])
const deleteSubmission = useCallback(async (id: string) => { await rawDelete(id); void refetchStats() }, [rawDelete, refetchStats])
const retryPost = useCallback(async (id: string) => { await rawRetryPost(id); void refetchStats() }, [rawRetryPost, refetchStats])
```

**Change**: Replace `refetchStats()` with `adjustStats()` calls. The key insight: we need to know the submission's current status to compute the delta.

```ts
const { stats, cookieStatus, postMethodStats, apiLoginStatus, fetchStats, refetch: refetchStats, adjustStats } = useAdminStats()

// Helper: compute stats delta for a status transition
function getStatsDelta(fromStatus: SubmissionStatus, toStatus: SubmissionStatus): Partial<Stats> {
  const delta: Record<string, number> = {}
  // Decrement old status count
  const fromKey = fromStatus === 'post_failed' ? 'postFailed' : fromStatus
  delta[fromKey] = (stats?.[fromKey as keyof Stats] as number ?? 0) - 1
  // Increment new status count
  const toKey = toStatus === 'post_failed' ? 'postFailed' : toStatus
  delta[toKey] = (stats?.[toKey as keyof Stats] as number ?? 0) + 1
  // Update total if deleting
  if (toStatus === 'deleted') {
    delta.total = (stats?.total ?? 0) - 1
  }
  return delta as Partial<Stats>
}
```

Wait, this is getting complicated with the type mapping. Let me simplify.

**Simpler approach**: The `adjustStats` just takes a partial `Stats` object. The page-level wrapper can compute the new counts directly:

```ts
const approve = useCallback(async (id: string) => {
  // Find the submission's current status to compute stats delta
  const sub = submissions.find((s) => s.id === id)
  if (!sub) return
  const prevStatus = sub.status
  
  await rawApprove(id)
  
  // Optimistic stats update
  const newStatus: SubmissionStatus = 'posting'
  const fromKey = prevStatus === 'post_failed' ? 'postFailed' : prevStatus
  const toKey = 'posting'
  adjustStats({
    [fromKey]: Math.max(0, (stats?.[fromKey as keyof Stats] as number ?? 0) - 1),
    [toKey]: (stats?.[toKey as keyof Stats] as number ?? 0) + 1,
  })
}, [rawApprove, submissions, stats, adjustStats])
```

**Hmm, this is getting too complex and error-prone.** The key-value mapping between `SubmissionStatus` and `Stats` field names is fragile. Let me think of a better approach.

**Better approach**: Add a helper function to `AdminStatsContext` that understands status transitions:

```ts
// In admin-stats-context.tsx
const adjustStatsForTransition = useCallback((fromStatus: SubmissionStatus, toStatus: SubmissionStatus) => {
  setStats((prev) => {
    if (!prev) return prev
    const statusToKey = (s: string): keyof Stats => {
      if (s === 'post_failed') return 'postFailed'
      return s as keyof Stats
    }
    const fromKey = statusToKey(fromStatus)
    const toKey = statusToKey(toStatus)
    return {
      ...prev,
      [fromKey]: Math.max(0, (prev[fromKey] as number) - 1),
      [toKey]: ((prev[toKey] as number) || 0) + 1,
    }
  })
}, [])
```

Actually, `Stats` has fields like `pending`, `censored`, `posting`, `postFailed`, `rejected`, `posted`, `total`. The `SubmissionStatus` type has `'pending' | 'censored' | 'posting' | 'post_failed' | 'rejected' | 'posted'`. The mapping is:
- `pending` → `stats.pending`
- `censored` → `stats.censored`
- `posting` → `stats.posting`
- `post_failed` → `stats.postFailed`
- `rejected` → `stats.rejected`
- `posted` → `stats.posted`

So only `post_failed` needs mapping. Let me use a simple helper:

```ts
const STATUS_TO_STATS_KEY: Record<SubmissionStatus, keyof Stats> = {
  pending: 'pending',
  censored: 'censored',
  posting: 'posting',
  post_failed: 'postFailed',
  rejected: 'rejected',
  posted: 'posted',
}
```

**Final approach for `adjustStatsForTransition`**:

```ts
const adjustStatsForTransition = useCallback((fromStatus: SubmissionStatus, toStatus: SubmissionStatus) => {
  setStats((prev) => {
    if (!prev) return prev
    const fromKey = STATUS_TO_STATS_KEY[fromStatus]
    const toKey = STATUS_TO_STATS_KEY[toStatus]
    const next = { ...prev }
    next[fromKey] = Math.max(0, (prev[fromKey] as number) - 1) as never
    next[toKey] = ((prev[toKey] as number) || 0) + 1 as never
    next.total = Math.max(0, prev.total) // total stays the same (no deletion via transition)
    return next
  })
  // Update pendingCount if pending changed
  if (fromStatus === 'pending' || toStatus === 'pending') {
    setPendingCount((prev) => {
      const delta = (fromStatus === 'pending' ? -1 : 0) + (toStatus === 'pending' ? 1 : 0)
      return Math.max(0, prev + delta)
    })
  }
}, [])
```

And for deletion (which removes from total):

```ts
const adjustStatsForDeletion = useCallback((status: SubmissionStatus) => {
  setStats((prev) => {
    if (!prev) return prev
    const key = STATUS_TO_STATS_KEY[status]
    const next = { ...prev }
    next[key] = Math.max(0, (prev[key] as number) - 1) as never
    next.total = Math.max(0, prev.total - 1)
    return next
  })
  if (status === 'pending') {
    setPendingCount((prev) => Math.max(0, prev - 1))
  }
}, [])
```

**Now the page-level wrappers become simple**:

```ts
// src/app/admin/page.tsx
const approve = useCallback(async (id: string) => {
  const sub = submissions.find((s) => s.id === id)
  await rawApprove(id)
  if (sub) adjustStatsForTransition(sub.status, 'posting')
}, [rawApprove, submissions, adjustStatsForTransition])

const reject = useCallback(async (id: string) => {
  const sub = submissions.find((s) => s.id === id)
  await rawReject(id)
  if (sub) adjustStatsForTransition(sub.status, 'rejected')
}, [rawReject, submissions, adjustStatsForTransition])

const deleteSubmission = useCallback(async (id: string) => {
  const sub = submissions.find((s) => s.id === id)
  await rawDelete(id)
  if (sub) adjustStatsForDeletion(sub.status)
}, [rawDelete, submissions, adjustStatsForDeletion])

const retryPost = useCallback(async (id: string) => {
  const sub = submissions.find((s) => s.id === id)
  await rawRetryPost(id)
  if (sub) adjustStatsForTransition(sub.status, 'posting')
}, [rawRetryPost, submissions, adjustStatsForTransition])
```

Wait, but `rawApprove` is async and might fail. If it fails, we still called `adjustStatsForTransition`. We need to handle the failure case.

**Better**: Have the page-level wrappers check the result and revert on failure. But `rawApprove` already toasts on error. The question is: should the page wrapper revert the stats?

Actually, looking at this more carefully: the `rawApprove` in `useSubmissions` already does the optimistic update on the submissions list. If it fails, it reverts the submissions list. But the stats adjustment happens at the page level AFTER `rawApprove` returns. If `rawApprove` throws, the page wrapper never reaches `adjustStatsForTransition`. So the stats are NOT adjusted on failure. This is correct!

Wait, let me re-read the code. The current page wrappers are:
```ts
const approve = useCallback(async (id: string) => {
  await rawApprove(id)
  void refetchStats()
}, [rawApprove, refetchStats])
```

If `rawApprove` throws, `refetchStats()` is never called. But `rawApprove` catches all errors internally and re-throws... wait, no. Let me re-read:

```ts
const approve = useCallback(async (id: string) => {
  setActionLoading(id)
  try {
    const data = await apiClient.approveSubmission(id)
    // ... toast ...
    void fetchSubmissions(true)
  } catch (err: unknown) {
    toast({ title: 'Gagal', description: getErrorMessage(err, 'Gagal menyetujui'), variant: 'destructive' })
  } finally {
    setActionLoading(null)
  }
}, [fetchSubmissions, toast])
```

The `rawApprove` catches all errors internally. It never throws. So `await rawApprove(id)` always resolves (never rejects). The page wrapper always reaches `adjustStatsForTransition()`.

But with optimistic updates, `rawApprove` now does the optimistic state change and reverts on failure. The stats adjustment should only happen on success.

**Solution**: Have `rawApprove` return a boolean indicating success:

```ts
const approve = useCallback(async (id: string): Promise<boolean> => {
  // ... optimistic update ...
  try {
    const data = await apiClient.approveSubmission(id)
    // ... refine state, toast ...
    return true  // success
  } catch (err: unknown) {
    setSubmissions(prevSubmissions)  // revert
    toast(...)
    return false  // failure
  } finally {
    setActionLoading(null)
  }
}, [toast])
```

Then the page wrapper:
```ts
const approve = useCallback(async (id: string) => {
  const sub = submissions.find((s) => s.id === id)
  const success = await rawApprove(id)
  if (success && sub) adjustStatsForTransition(sub.status, 'posting')
}, [rawApprove, submissions, adjustStatsForTransition])
```

**Wait, there's a subtlety**: When `rawApprove` succeeds and `autoPosted` is true, the actual server status is `posted`, not `posting`. The stats should reflect `posted` not `posting`. But at the time we call `adjustStatsForTransition`, we don't know yet whether it'll be auto-posted.

**Solution**: Pass the final status back from `rawApprove`:

```ts
const approve = useCallback(async (id: string): Promise<SubmissionStatus | null> => {
  // ... optimistic: set to 'posting' ...
  try {
    const data = await apiClient.approveSubmission(id)
    if (data.autoPosted) {
      // Refine to 'posted'
      setSubmissions(...)
      return 'posted'  // ← tell caller the final status
    } else if (data.error) {
      // Posting failed — revert to original
      setSubmissions(prevSubmissions)
      return null  // ← failure
    } else {
      return 'posting'  // ← still posting
    }
  } catch {
    setSubmissions(prevSubmissions)
    return null  // ← failure
  } finally {
    setActionLoading(null)
  }
}, [toast])
```

Then the page wrapper:
```ts
const approve = useCallback(async (id: string) => {
  const sub = submissions.find((s) => s.id === id)
  if (!sub) return
  const finalStatus = await rawApprove(id)
  if (finalStatus) adjustStatsForTransition(sub.status, finalStatus)
}, [rawApprove, submissions, adjustStatsForTransition])
```

This is clean and correct.

**Verification for A3**:
- Approve a pending submission → stats grid: pending -1, posting +1 (or posted +1 if auto-posted)
- Reject a pending submission → stats grid: pending -1, rejected +1
- Delete any submission → stats grid: [status] -1, total -1
- Retry a post_failed submission → stats grid: postFailed -1, posting +1
- If action fails → stats unchanged
- After any action, filter pill counts update immediately
- The 15s poll will correct any drift (safety net)

### A4: Per-card action loading

**File**: `src/components/dashboard/submission-card.tsx`

**Current** (lines 131-182): `disabled={!!actionLoading}` on ALL buttons checks if ANY card is loading.

**Change**: Only disable buttons on the card that's being acted on.

```tsx
// Before:
disabled={!!actionLoading}

// After:
disabled={actionLoading === sub.id}
```

But we also want to prevent the SAME card from being double-clicked. The current `disabled={!!actionLoading}` already does this because `actionLoading` is set to the card's ID. But with the new check, other cards' buttons are enabled while one card is loading.

**Wait**: The current pattern uses `actionLoading` to also show the loading spinner:
```tsx
{!!actionLoading ? (
  <Loader2 className="w-3 h-3 animate-spin" />
) : (
  <CheckCircle className="w-3 h-3 mr-1" />
)}
```

This shows the spinner on ALL cards' buttons when any card is loading. We need to change this too:
```tsx
{actionLoading === sub.id ? (
  <Loader2 className="w-3 h-3 animate-spin" />
) : (
  <CheckCircle className="w-3 h-3 mr-1" />
)}
```

**Verification**:
- Click Setujui on card A → card A shows spinner, buttons disabled on card A only
- Card B's buttons are still enabled and clickable
- After card A's action completes → card A buttons re-enable

### A5: Stats grid skeleton

**File**: `src/app/admin/page.tsx`

**Current** (lines 94-102):
```tsx
{stats && (
  <StatsGrid stats={stats} onPenggunaClick={...} />
)}
```

**Change**: Show skeleton while stats are loading.

```tsx
{stats ? (
  <StatsGrid stats={stats} onPenggunaClick={...} />
) : (
  <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
    {Array.from({ length: 8 }).map((_, i) => (
      <Card key={i} className="border-0 shadow-sm py-2 md:py-3">
        <CardContent className="p-2 md:p-3">
          <div className="animate-pulse">
            <div className="flex items-center gap-1 md:gap-1.5 mb-0.5">
              <div className="w-5 h-5 md:w-6 md:h-6 rounded-md bg-gray-200" />
              <div className="h-4 bg-gray-200 rounded w-6" />
            </div>
            <div className="h-3 bg-gray-200 rounded w-12" />
          </div>
        </CardContent>
      </Card>
    ))}
  </div>
)}
```

**Verification**: On initial admin page load, see 8 pulsing placeholder cards before stats arrive. Then they swap to real data.

### A6: Stats stale indicator

**File**: `src/contexts/admin-stats-context.tsx`

**Change**: Track `lastFetchedAt` and `consecutiveFailures`. Expose them.

```ts
const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null)
const [consecutiveFailures, setConsecutiveFailures] = useState(0)

const fetchStats = useCallback(async () => {
  try {
    const data = await apiClient.getStats()
    setStats(data)
    setPendingCount(data.pending)
    // ... existing logic ...
    setLastFetchedAt(Date.now())
    setConsecutiveFailures(0)
  } catch {
    setConsecutiveFailures((prev) => prev + 1)
  }
}, [])
```

Add to interface:
```ts
interface AdminStatsState {
  // ... existing ...
  lastFetchedAt: number | null
  isStale: boolean  // true when consecutiveFailures >= 3
}
```

**File**: `src/app/admin/page.tsx` or `src/components/layout/admin-header.tsx`

Show a subtle warning when `isStale`:
```tsx
{isStale && (
  <div className="text-[10px] text-amber-600 flex items-center gap-1">
    <AlertTriangle className="w-3 h-3" /> Connection issue
  </div>
)}
```

**Verification**: 
- When stats fetch succeeds → `lastFetchedAt` updates, `consecutiveFailures` resets to 0
- When 3+ consecutive fetches fail → `isStale` becomes true, warning appears
- When connection recovers → warning disappears on next successful fetch
- `lastFetchedAt` can be used to show "Last updated Xs ago" (future enhancement, not in this phase)

---

## 4. Phase B — Loading & Error State Consistency

### B1: LimitHealthCard error state

**File**: `src/components/settings/limit-health-card.tsx`

**Current** (lines 41-51, 76-129): If fetch fails, `data` stays null and `loading` goes to false. The card body is empty (neither the spinner condition `loading && !data` nor the content condition `data && (...)` is true).

**Change**: Add error state.

```ts
const [error, setError] = useState<string | null>(null)

const fetchHits = useCallback(async () => {
  setLoading(true)
  setError(null)
  try {
    const res = await apiClient.getLimitHits()
    setData(res)
  } catch {
    setError('Gagal memuat data limit. Coba lagi.')
  } finally {
    setLoading(false)
  }
}, [])
```

In the JSX, add after the loading spinner:
```tsx
{error && !data && (
  <div className="text-center py-4">
    <AlertTriangle className="w-6 h-6 text-amber-400 mx-auto mb-2" />
    <p className="text-xs text-amber-600">{error}</p>
    <Button variant="link" className="text-xs text-[#71767B] mt-1" onClick={fetchHits}>
      Coba lagi
    </Button>
  </div>
)}
```

**Verification**: Simulate network failure → card shows error message with retry button. Click retry → re-fetches.

### B2: PostMethodRates empty/loading state

**File**: `src/app/admin/page.tsx`

**Current** (lines 128-129):
```tsx
{postMethodStats && postMethodStats.total > 0 && (
  <PostMethodRates postMethodStats={postMethodStats} />
)}
```

**Change**: Show placeholder when stats loaded but total is 0. Show skeleton while loading.

```tsx
{postMethodStats === null ? (
  <Card className="py-0 gap-0 shadow-sm border-[#EFF3F4]">
    <CardContent className="p-2.5">
      <div className="animate-pulse flex items-center gap-1.5 mb-2">
        <div className="w-3 h-3 rounded bg-gray-200" />
        <div className="h-3 bg-gray-200 rounded w-24" />
      </div>
      <div className="animate-pulse h-2.5 rounded-full bg-gray-200 w-full" />
    </CardContent>
  </Card>
) : postMethodStats.total > 0 ? (
  <PostMethodRates postMethodStats={postMethodStats} />
) : (
  <Card className="py-0 gap-0 shadow-sm border-[#EFF3F4]">
    <CardContent className="p-2.5 text-center">
      <p className="text-xs text-[#71767B]">No posting data yet</p>
    </CardContent>
  </Card>
)}
```

**Verification**: On initial load, see skeleton. When stats arrive with total > 0, see bar chart. When stats arrive with total = 0, see "No posting data yet".

### B3: EncryptionBanner loading shimmer

**File**: `src/components/dashboard/encryption-banner.tsx`

**Current** (lines 9-11):
```ts
if (encryptionEnabled === undefined || encryptionEnabled === true) return null
```

**Change**: Show subtle loading shimmer while `undefined`.

```tsx
if (encryptionEnabled === undefined) {
  return (
    <div className="rounded-lg border border-[#EFF3F4] bg-[#F7F9F9] p-3 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded bg-gray-200" />
        <div className="h-4 bg-gray-200 rounded w-32" />
      </div>
    </div>
  )
}
if (encryptionEnabled === true) return null
```

**Verification**: While stats are loading, see a subtle shimmer. When `encryptionEnabled` resolves, either the warning banner appears or nothing (if encryption is on).

---

## 5. Phase C — Public Page Reactivity

### C1: MyPosts conditional auto-poll

**File**: `src/hooks/use-my-posts.ts`

**Current**: No auto-refresh. Only fetches on login and after submit.

**Change**: Add a 30s auto-refresh when the user has non-terminal posts. Stop when all posts are in terminal states.

**Vercel concern**: Each poll is a serverless invocation. We minimize by:
1. Only polling when there are non-terminal posts
2. 30s interval (not 15s like admin)
3. Pausing when tab is hidden (`document.hidden`)
4. Stopping entirely when all posts reach terminal states

```ts
// Add to useMyPosts
const hasNonTerminalPosts = myPosts.some(
  (p) => p.status === 'pending' || p.status === 'censored' || p.status === 'posting'
)

useEffect(() => {
  if (!submitter || isAnonUser || !hasNonTerminalPosts) return
  
  const interval = setInterval(() => {
    if (!document.hidden) {
      void fetchMyPosts()
    }
  }, 30000)
  
  return () => { clearInterval(interval) }
}, [submitter, isAnonUser, hasNonTerminalPosts, fetchMyPosts])
```

**Verification**:
- User has a pending post → MyPosts auto-refreshes every 30s
- All posts reach terminal states (posted/rejected/post_failed) → auto-refresh stops
- Tab is hidden → no polling
- User has no posts → no polling
- User is anon → no polling

### C2: Cooldown live countdown

**File**: `src/components/submit/confession-form.tsx`

**Current** (lines 124-126):
```ts
{limits.cooldownSeconds > 0
  ? `cooldown ${limits.cooldownSeconds < 60 ? `${limits.cooldownSeconds}s` : `${Math.ceil(limits.cooldownSeconds / 60)}m`}`
  : 'siap kirim'}
```

**Change**: Add a `useCountdown` hook that ticks every second.

**New hook** (add to `src/hooks/use-countdown.ts`):

```ts
import { useState, useEffect } from 'react'

export function useCountdown(initialSeconds: number) {
  const [remaining, setRemaining] = useState(initialSeconds)

  useEffect(() => {
    setRemaining(initialSeconds)
    if (initialSeconds <= 0) return

    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => { clearInterval(interval) }
  }, [initialSeconds])

  return remaining
}
```

**In ConfessionForm**:
```tsx
const cooldownRemaining = useCountdown(limits?.cooldownSeconds ?? 0)

// In the JSX:
{cooldownRemaining > 0
  ? `cooldown ${cooldownRemaining < 60 ? `${cooldownRemaining}s` : `${Math.floor(cooldownRemaining / 60)}:${String(cooldownRemaining % 60).padStart(2, '0')}`}`
  : 'siap kirim'}
```

**Additional**: When cooldown hits 0, auto-refetch limits to check if the cooldown has actually expired on the server:

```ts
// In useCountdown or as a separate effect:
useEffect(() => {
  if (cooldownRemaining === 0 && limits?.cooldownSeconds && limits.cooldownSeconds > 0) {
    // Cooldown just expired — refetch to get updated limits
    // The parent page's refetchMyPosts already captures limits
  }
}, [cooldownRemaining])
```

Wait, `ConfessionForm` doesn't have access to `refetchMyPosts`. The limits come as a prop. We need to add an `onCooldownExpired` callback prop.

Actually, simpler: just add a `onCooldownExpired` optional prop:

```tsx
interface ConfessionFormProps {
  // ... existing ...
  onCooldownExpired?: () => void
}
```

And in the component:
```tsx
useEffect(() => {
  if (cooldownRemaining === 0 && (limits?.cooldownSeconds ?? 0) > 0) {
    onCooldownExpired?.()
  }
}, [cooldownRemaining, limits?.cooldownSeconds, onCooldownExpired])
```

In `src/app/page.tsx`, pass:
```tsx
<ConfessionForm
  // ... existing props ...
  onCooldownExpired={refetchMyPosts}
/>
```

**Verification**:
- Cooldown of 300s → shows "4:60" → "4:59" → ... → "0:01" → "0:00" → "siap kirim"
- When hitting 0, `refetchMyPosts` is called which also refetches limits
- If the server says cooldown is still active (clock skew), the countdown restarts with the new value
- If cooldown is 0 from the start, shows "siap kirim" immediately

---

## 6. Phase D — Settings Sync Hardening

### D1: Split `isSaving` into `isSavingFilter` + `isSavingRateLimits`

**File**: `src/hooks/use-filter-settings.ts`

**Current** (line 19):
```ts
const [isSaving, setIsSaving] = useState(false)
```

Used by both `saveFilterSettings` and `saveRateLimits`.

**Change**: Split into two states:

```ts
const [isSavingFilter, setIsSavingFilter] = useState(false)
const [isSavingRateLimits, setIsSavingRateLimits] = useState(false)
```

Update `saveFilterSettings` to use `isSavingFilter`:
```ts
const saveFilterSettings = useCallback(async () => {
  if (!isAdmin) return
  setIsSavingFilter(true)
  try { /* ... existing logic ... */ }
  finally { setIsSavingFilter(false) }
}, [isAdmin, autoApprove, blockedWordsText, nsfwWordsText, filterRules, geminiEnabled, toast])
```

Update `saveRateLimits` to use `isSavingRateLimits`:
```ts
const saveRateLimits = useCallback(async () => {
  if (!isAdmin) return
  setIsSavingRateLimits(true)
  try { /* ... existing logic ... */ }
  finally { setIsSavingRateLimits(false) }
}, [isAdmin, rateLimits, toast])
```

Return both:
```ts
return {
  // ... existing ...
  isSavingFilter,    // replaces isSaving for FilterCard
  isSavingRateLimits, // replaces isSaving for RateLimitCard + CircuitBreakerCard
  isSaving: isSavingFilter || isSavingRateLimits, // backward compat if needed
}
```

**File**: `src/app/admin/settings/page.tsx`

Update prop passing:
```tsx
<FilterCard isSaving={filterSettings.isSavingFilter} ... />
<RateLimitCard isSaving={filterSettings.isSavingRateLimits} ... />
<CircuitBreakerCard isSaving={filterSettings.isSavingRateLimits} ... />
```

**Verification**:
- Saving filter settings → FilterCard shows spinner, RateLimitCard does not
- Saving rate limits → RateLimitCard + CircuitBreakerCard show spinner, FilterCard does not
- No cross-contamination of saving states

---

## 7. Phase E — Micro-Polish

### E1: Pending count badge subtle pulse

**File**: `src/components/layout/admin-header.tsx`

**Current** (lines 57-65): Badge shows pending count with no animation.

**Change**: Add pulse animation when `pendingCount > 0`.

```tsx
<Badge className={`... ${pendingCount > 0 ? 'animate-pulse' : ''}`}>
  {pendingCount}
</Badge>
```

Wait, `animate-pulse` is too aggressive for a badge. Use a custom subtle animation:

```tsx
// Add to tailwind or inline style
<Badge className={`... ${pendingCount > 0 ? 'ring-2 ring-yellow-300 ring-offset-1' : ''}`}>
  {pendingCount}
</Badge>
```

A subtle ring highlight is less distracting than pulse. The badge is already yellow, so a yellow ring adds emphasis without being annoying.

**Verification**: When pendingCount > 0, badge has a subtle ring. When pendingCount === 0, no ring.

### E2: Refresh button counterclockwise spin

**File**: Multiple components use `RefreshCw` with `animate-spin`.

The `animate-spin` class in Tailwind spins clockwise. For refresh buttons, counterclockwise is the UX convention.

**Change**: Add a custom animation in `src/app/globals.css` or use Tailwind's arbitrary value:

```css
@keyframes spin-reverse {
  from { transform: rotate(0deg) }
  to { transform: rotate(-360deg) }
}
.animate-spin-reverse {
  animation: spin-reverse 1s linear infinite
}
```

Then replace `animate-spin` with `animate-spin-reverse` on all `RefreshCw` icons.

**Files affected**:
- `src/components/dashboard/submission-filters.tsx` (line 76)
- `src/components/settings/api-fallback-card.tsx` (multiple)
- `src/components/settings/limit-health-card.tsx` (line 140)
- `src/components/dashboard/users-dialog.tsx` (line 219)
- `src/components/submit/my-posts.tsx` (line 34)

**Note**: Do NOT change `Loader2` spinners — those should stay clockwise (loading convention). Only `RefreshCw` icons should spin counterclockwise.

**Verification**: All RefreshCw icons spin counterclockwise. All Loader2 icons spin clockwise.

---

## 8. Risk Analysis & Mitigations

### Risk R1: Optimistic update drift

**Scenario**: Admin approves a submission. Optimistic update sets status to 'posting'. But the server actually set it to 'posted' (auto-post succeeded). The 15s poll corrects this, but there's a 15s window where the UI shows 'posting' instead of 'posted'.

**Mitigation**: The `approve` callback already checks `data.autoPosted` and refines the local state immediately after the API response. So this drift only lasts from the optimistic update (~0ms) until the API response arrives (~500ms). Then it's corrected. The 15s poll is a safety net.

**Residual risk**: Very low. The API response arrives quickly and corrects the state.

### Risk R2: Stats count goes negative

**Scenario**: `adjustStatsForTransition` decrements a count. If the count was already 0 (e.g., due to a race condition with the 15s poll), it could go to -1.

**Mitigation**: Use `Math.max(0, ...)` in all decrement operations. Already planned in the implementation.

**Residual risk**: None.

### Risk R3: `submissionsRef` snapshot is stale

**Scenario**: While an approve action is in-flight, the 15s silent poll fires and updates `submissions`. The `submissionsRef.current` snapshot taken before the approve might be stale.

**Mitigation**: The `submissionsRef` is updated on every render (`submissionsRef.current = submissions`). The snapshot is taken at the START of the action, before the API call. If the 15s poll updates submissions during the API call, the snapshot will contain the old list. On revert, we'd restore the old list, which would then be overwritten by the next 15s poll.

**Actually, this is a real problem.** If we save `prevSubmissions = submissionsRef.current` at the start, then the 15s poll updates the list while the API is in-flight, and then the API fails — we'd revert to the old list, losing the 15s poll's update.

**Better approach**: Instead of snapshotting the entire list, use a functional revert that only restores the specific submission:

```ts
// Instead of:
const prevSubmissions = submissionsRef.current
// On failure: setSubmissions(prevSubmissions)

// Use:
const targetId = id
const targetSubmission = submissionsRef.current.find((s) => s.id === targetId)
const originalStatus = targetSubmission?.status
// On failure: setSubmissions((prev) =>
//   prev.map((s) => s.id === targetId ? { ...s, status: originalStatus } : s)
// )
```

This way, only the affected submission is reverted, and any 15s poll updates to OTHER submissions are preserved.

**For delete**:
```ts
const deletedSubmission = submissionsRef.current.find((s) => s.id === id)
// On failure: setSubmissions((prev) => {
//   // Re-insert at the original position
//   const idx = prev.findIndex((s) => s.id > id ? true : false) // approximate
//   return [...prev.slice(0, idx), deletedSubmission, ...prev.slice(idx)]
// })
```

Actually, for delete, it's simpler to just append at the end on failure — the next 15s poll will fix the order.

**Residual risk**: Low. The functional revert approach is safer than full-list snapshot.

### Risk R4: MyPosts polling increases Vercel invocations

**Scenario**: A user has a pending post and leaves the tab open. MyPosts polls every 30s. Over 10 minutes, that's 20 invocations.

**Mitigation**: 
1. 30s interval (not 15s) — half the invocations
2. `document.hidden` check — no invocations when tab is hidden
3. Auto-stop when all posts reach terminal states — stops polling as soon as possible
4. The `/api/submissions/mine` endpoint is lightweight (single user, limited rows)

**Residual risk**: Acceptable. The invocations are minimal and self-limiting.

### Risk R5: `useCountdown` re-renders every second

**Scenario**: The countdown timer triggers a state update every second, causing the entire ConfessionForm to re-render.

**Mitigation**: The countdown display is a small part of the form. React's reconciliation is fast enough for this. The re-render only affects the cooldown text span. The textarea and other inputs are unaffected because React only updates the changed DOM nodes.

**Alternative**: Use `useRef` + direct DOM manipulation for the countdown to avoid re-renders entirely. But this is over-engineering for a simple text update.

**Residual risk**: Very low. One re-render per second is negligible.

### Risk R6: Split `isSaving` breaks existing consumers

**Scenario**: Some component still reads `isSaving` instead of `isSavingFilter` or `isSavingRateLimits`.

**Mitigation**: Keep `isSaving` as a computed backward-compat value: `isSaving: isSavingFilter || isSavingRateLimits`. Also do a search for all consumers of `isSaving` from `useFilterSettings` and update them.

**Verification**: `bun run ci` (prisma generate + tsc --noEmit + eslint) will catch any type errors if we remove `isSaving` from the return type. If we keep it as backward compat, there are no type errors.

**Residual risk**: None if we keep the backward-compat alias.

---

## 9. Verification Checklist

After implementing each phase, run these checks:

### Pre-implementation baseline
- [ ] `bun run ci` passes clean on current code
- [ ] Dev server runs without errors
- [ ] All existing functionality works (login, submit, admin actions, settings)

### After Phase A (Optimistic + Stats)
- [ ] `bun run ci` passes
- [ ] Click Setujui → card status changes instantly, stats grid updates instantly
- [ ] Click Tolak → card status changes instantly, stats grid updates instantly
- [ ] Click × (delete) → card disappears instantly, stats grid updates instantly
- [ ] Click Retry Post → card status changes instantly, stats grid updates instantly
- [ ] If API call fails (e.g., network error) → card reverts to original state, stats unchanged
- [ ] Other cards' buttons remain clickable while one card is loading
- [ ] Stats grid shows skeleton on initial load
- [ ] Stats stale indicator appears when fetch fails 3+ times
- [ ] Filter pill counts update immediately after actions
- [ ] 15s poll still works and corrects any drift

### After Phase B (Loading/Error Consistency)
- [ ] `bun run ci` passes
- [ ] LimitHealthCard shows error + retry button on fetch failure
- [ ] PostMethodRates shows skeleton while loading, "No posting data yet" when total=0
- [ ] EncryptionBanner shows subtle shimmer while loading
- [ ] No regressions in existing loading states

### After Phase C (Public Page Reactivity)
- [ ] `bun run ci` passes
- [ ] MyPosts auto-refreshes every 30s when there are non-terminal posts
- [ ] MyPosts stops auto-refreshing when all posts are terminal
- [ ] MyPosts doesn't poll when tab is hidden
- [ ] Cooldown shows live countdown (e.g., "4:32")
- [ ] When countdown hits 0, limits are refetched
- [ ] No regressions in submit flow

### After Phase D (Settings Sync)
- [ ] `bun run ci` passes
- [ ] Saving filter settings shows spinner on FilterCard only
- [ ] Saving rate limits shows spinner on RateLimitCard + CircuitBreakerCard only
- [ ] Both can't be saved simultaneously (separate isSaving states)
- [ ] No regressions in settings save/load cycle

### After Phase E (Polish)
- [ ] `bun run ci` passes
- [ ] Pending count badge has subtle ring when > 0
- [ ] All RefreshCw icons spin counterclockwise
- [ ] All Loader2 icons spin clockwise
- [ ] No visual regressions

### Final
- [ ] `bun run ci` passes clean
- [ ] Dev server log shows no errors
- [ ] Full manual test of all admin actions
- [ ] Full manual test of public submit flow
- [ ] Full manual test of settings page (all tabs)

---

## 10. Vercel Deployment Considerations

### Serverless invocations

Every API call = one Vercel serverless invocation. This refactor adds:

| Change | Additional invocations | Mitigation |
|--------|----------------------|------------|
| MyPosts 30s poll | ~2/min per active user (only when non-terminal posts exist) | Auto-stops when all posts terminal. `document.hidden` check. |
| Stats stale indicator | 0 (uses existing 15s poll) | N/A |
| Cooldown refetch | 1 per cooldown expiry | Only fires once when countdown hits 0 |

**Net impact**: Minimal. The only new polling is MyPosts, which is self-limiting and throttled to 30s with `document.hidden`.

### Cold starts

No changes to backend. Cold start behavior is unchanged.

### Function duration

No backend changes. All changes are client-side.

### Bandwidth

No additional data fetched. `adjustStats` is a local-only operation. The 15s polls continue as before.

### Concurrent connections

No changes. The number of concurrent API calls per user is unchanged (at most 2: stats + submissions).

---

## Implementation Order

```
Phase A  →  A1 (adjustStats), A2 (optimistic updates), A3 (page integration), A4 (per-card loading), A5 (skeleton), A6 (stale indicator)
Phase B  →  B1 (LimitHealthCard error), B2 (PostMethodRates states), B3 (EncryptionBanner shimmer)
Phase C  →  C1 (MyPosts poll), C2 (cooldown countdown)
Phase D  →  D1 (split isSaving)
Phase E  →  E1 (badge ring), E2 (counterclockwise spin)
```

**Recommended**: Implement in order A → B → C → D → E. Each phase is independently verifiable. Phase A is the highest impact and should be done first.
