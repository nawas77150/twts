'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import type { Stats, CookieAuthStatus, PostMethodStats, KeyCredits, ApiLoginStatus, PostMethod } from '@/types'
import { apiClient } from '@/lib/api-client'

interface UseStatsParams {
  adminToken: string
  /** Use lightweight summary endpoint (no submission counts, no post method stats).
   *  Ideal for the Settings page which only needs filter/cookie/API status. */
  lightweight?: boolean
}

// Callbacks to sync filter settings, circuit breaker, and blocked usernames from stats
interface UseStatsCallbacks {
  onFilterSettings?: (settings: Stats['filterSettings']) => void
  onCircuitBreaker?: (status: { paused: boolean; failCount: number; pausedUntil: number | null; threshold: number } | null) => void
  onBlockedUsernames?: (usernames: string[]) => void
  onPostMethodSetting?: (method: PostMethod) => void
}

// Shared response shape — both Stats (full) and Summary (lightweight) produce this
interface StatsResponse {
  cookieAuthStatus?: CookieAuthStatus | null
  apiCredits?: KeyCredits[] | null
  apiLoginStatus?: ApiLoginStatus | null
  postMethodSetting?: string | null
  filterSettings?: Stats['filterSettings'] | null
  circuitBreaker?: { paused: boolean; failCount: number; pausedUntil: number | null; threshold: number } | null
  pending?: number
  postFailed?: number
  rejected?: number
  posted?: number
  total?: number
  submitters?: number
  postMethodStats?: PostMethodStats | null
}

export function useStats({ adminToken, lightweight }: UseStatsParams, callbacks?: UseStatsCallbacks) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [cookieStatus, setCookieStatus] = useState<CookieAuthStatus | null>(null)
  const [postMethodStats, setPostMethodStats] = useState<PostMethodStats | null>(null)
  const [apiCredits, setApiCredits] = useState<KeyCredits[]>([])
  const [apiLoginStatus, setApiLoginStatus] = useState<ApiLoginStatus | null>(null)
  const [postMethodSetting, setPostMethodSetting] = useState<PostMethod>('auto')

  // Use ref for callbacks to avoid unstable dependency causing excessive re-fetches
  const callbacksRef = useRef(callbacks)
  useEffect(() => {
    callbacksRef.current = callbacks
  })

  // Shared logic for processing summary/stats response fields
  const processResponse = useCallback((data: StatsResponse) => {
    if (data.cookieAuthStatus !== undefined) setCookieStatus(data.cookieAuthStatus)
    if (data.apiCredits !== undefined) setApiCredits(data.apiCredits ?? [])
    if (data.apiLoginStatus !== undefined) setApiLoginStatus(data.apiLoginStatus)
    if (data.postMethodSetting) {
      setPostMethodSetting(data.postMethodSetting as PostMethod)
      callbacksRef.current?.onPostMethodSetting?.(data.postMethodSetting as PostMethod)
    }
    if (data.filterSettings !== undefined) {
      callbacksRef.current?.onFilterSettings?.(data.filterSettings)
      if (data.filterSettings?.blockedUsernames) callbacksRef.current?.onBlockedUsernames?.(data.filterSettings.blockedUsernames)
    }
    // Circuit breaker is a top-level field in both /stats and /summary responses
    if (data.circuitBreaker !== undefined) {
      callbacksRef.current?.onCircuitBreaker?.(data.circuitBreaker)
    }
  }, [])

  const fetchStats = useCallback(async () => {
    if (!adminToken) return
    try {
      if (lightweight) {
        // Lightweight mode — only fetch settings/cookie/API status, no submission counts
        const data = await apiClient.getSummary()
        // Build a partial Stats object so existing consumers still work
        setStats((prev) => ({
          pending: prev?.pending ?? 0,
          censored: prev?.censored ?? 0,
          posting: prev?.posting ?? 0,
          postFailed: prev?.postFailed ?? 0,
          rejected: prev?.rejected ?? 0,
          posted: prev?.posted ?? 0,
          total: prev?.total ?? 0,
          submitters: prev?.submitters ?? 0,
          cookieAuthStatus: data.cookieAuthStatus ?? prev?.cookieAuthStatus ?? null,
          postMethodStats: prev?.postMethodStats ?? null,
          apiCredits: data.apiCredits ?? prev?.apiCredits ?? [],
          apiLoginStatus: data.apiLoginStatus ?? prev?.apiLoginStatus ?? null,
          postMethodSetting: (data.postMethodSetting ?? prev?.postMethodSetting ?? 'auto') as PostMethod,
          filterSettings: data.filterSettings ?? prev?.filterSettings ?? null,
          circuitBreaker: data.circuitBreaker ?? prev?.circuitBreaker ?? null,
        }))
        processResponse(data)
      } else {
        // Full mode — fetch everything (for admin dashboard)
        const data = await apiClient.getStats()
        setStats(data)
        if (data.postMethodStats) setPostMethodStats(data.postMethodStats)
        processResponse(data)
      }
    } catch {
      // silently fail
    }
  }, [adminToken, lightweight, processResponse])

  const refetch = useCallback(async () => {
    return fetchStats()
  }, [fetchStats])

  return {
    stats,
    cookieStatus,
    postMethodStats,
    apiCredits,
    apiLoginStatus,
    postMethodSetting,
    setPostMethodSetting,
    fetchStats,
    refetch,
  }
}
