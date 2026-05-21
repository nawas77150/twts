'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import type { Stats, CookieAuthStatus, PostMethodStats, KeyCredits, ApiLoginStatus, SubmissionStatus } from '@/types'
import { apiClient } from '@/lib/api-client'
import { useAdminAuth } from './admin-auth-context'

interface AdminStatsState {
  stats: Stats | null
  cookieStatus: CookieAuthStatus | null
  postMethodStats: PostMethodStats | null
  apiCredits: KeyCredits[]
  apiLoginStatus: ApiLoginStatus | null
  pendingCount: number
  isStale: boolean
  fetchStats: (options?: { refresh?: boolean }) => Promise<void>
  refetch: (options?: { refresh?: boolean }) => Promise<void>
  adjustStatsForTransition: (from: SubmissionStatus, to: SubmissionStatus) => void
  adjustStatsForDeletion: (status: SubmissionStatus) => void
}

const AdminStatsContext = createContext<AdminStatsState | null>(null)

/** Maps SubmissionStatus values to their corresponding Stats field names.
 *  Uses Map (not Record) to avoid the "Generic Object Injection Sink" SAST warning:
 *  plain objects have a prototype chain (__proto__, constructor) that SAST
 *  flags on dynamic-key access. Map.get() has no prototype chain.
 */
const STATUS_TO_KEY = new Map<SubmissionStatus, keyof Stats>([
  ['pending',     'pending'],
  ['censored',    'censored'],
  ['posting',     'posting'],
  ['post_failed', 'postFailed'],
  ['rejected',    'rejected'],
  ['posted',      'posted'],
])

/** Explicit property read — avoids dynamic key access that SAST flags. */
function getStatValue(stats: Stats, key: keyof Stats): number {
  switch (key) {
    case 'pending':     return stats.pending
    case 'censored':    return stats.censored
    case 'posting':     return stats.posting
    case 'postFailed':  return stats.postFailed
    case 'rejected':    return stats.rejected
    case 'posted':      return stats.posted
    case 'total':       return stats.total
    default:            return 0
  }
}

/** Explicit property set — avoids dynamic key assignment that SAST flags. */
function setStatValue(stats: Stats, key: keyof Stats, value: number): Stats {
  switch (key) {
    case 'pending':     return { ...stats, pending: value }
    case 'censored':    return { ...stats, censored: value }
    case 'posting':     return { ...stats, posting: value }
    case 'postFailed':  return { ...stats, postFailed: value }
    case 'rejected':    return { ...stats, rejected: value }
    case 'posted':      return { ...stats, posted: value }
    case 'total':       return { ...stats, total: value }
    default:            return stats
  }
}

export function AdminStatsProvider({ children }: { children: ReactNode }) {
  const { isAdmin } = useAdminAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [cookieStatus, setCookieStatus] = useState<CookieAuthStatus | null>(null)
  const [postMethodStats, setPostMethodStats] = useState<PostMethodStats | null>(null)
  const [apiCredits, setApiCredits] = useState<KeyCredits[]>([])
  const [apiLoginStatus, setApiLoginStatus] = useState<ApiLoginStatus | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [consecutiveFailures, setConsecutiveFailures] = useState(0)

  const fetchStats = useCallback(async (options?: { refresh?: boolean }) => {
    try {
      const data = await apiClient.getStats(options)
      setStats(data)
      setPendingCount(data.pending)
      if (data.cookieAuthStatus !== undefined) setCookieStatus(data.cookieAuthStatus)
      if (data.apiCredits !== undefined) setApiCredits(data.apiCredits ?? [])
      if (data.apiLoginStatus !== undefined) setApiLoginStatus(data.apiLoginStatus)
      if (data.postMethodStats) setPostMethodStats(data.postMethodStats)
      setConsecutiveFailures(0)
    } catch {
      setConsecutiveFailures((prev) => prev + 1)
    }
  }, [])

  const refetch = useCallback(async (options?: { refresh?: boolean }) => { await fetchStats(options) }, [fetchStats])

  const isStale = consecutiveFailures >= 3

  const adjustStatsForTransition = useCallback(
    (from: SubmissionStatus, to: SubmissionStatus) => {
      const fromKey = STATUS_TO_KEY.get(from)
      const toKey   = STATUS_TO_KEY.get(to)
      if (!fromKey || !toKey) return
      setStats((prev) => {
        if (!prev) return prev
        const next = setStatValue(prev, fromKey, Math.max(0, getStatValue(prev, fromKey) - 1))
        return setStatValue(next, toKey, (getStatValue(prev, toKey) || 0) + 1)
      })
      if (from === 'pending' || to === 'pending') {
        setPendingCount((prev) => {
          const delta = (from === 'pending' ? -1 : 0) + (to === 'pending' ? 1 : 0)
          return Math.max(0, prev + delta)
        })
      }
    },
    [],
  )

  const adjustStatsForDeletion = useCallback((status: SubmissionStatus) => {
    const key = STATUS_TO_KEY.get(status)
    if (!key) return
    setStats((prev) => {
      if (!prev) return prev
      const next = setStatValue(prev, key, Math.max(0, getStatValue(prev, key) - 1))
      return { ...next, total: Math.max(0, prev.total - 1) }
    })
    if (status === 'pending') {
      setPendingCount((prev) => Math.max(0, prev - 1))
    }
  }, [])

  // Keep a ref to fetchStats so the interval always calls the latest version
  // Updated in an effect to comply with react-hooks/refs rule.
  const fetchStatsRef = useRef(fetchStats)
  useEffect(() => { fetchStatsRef.current = fetchStats }, [fetchStats])

  // Fetch on auth change + 15s auto-refresh (keeps pendingCount badge fresh on all pages)
  // Pause when tab is hidden to avoid wasting serverless invocations
  useEffect(() => {
    if (!isAdmin) return
    void fetchStatsRef.current()
    const interval = setInterval(() => {
      if (!document.hidden) {
        void fetchStatsRef.current()
      }
    }, 15000)
    return () => { clearInterval(interval) }
  }, [isAdmin])

  return (
    <AdminStatsContext.Provider value={{ stats, cookieStatus, postMethodStats, apiCredits, apiLoginStatus, pendingCount, isStale, fetchStats, refetch, adjustStatsForTransition, adjustStatsForDeletion }}>
      {children}
    </AdminStatsContext.Provider>
  )
}

export function useAdminStats(): AdminStatsState {
  const ctx = useContext(AdminStatsContext)
  if (!ctx) throw new Error('useAdminStats must be used within AdminStatsProvider')
  return ctx
}
