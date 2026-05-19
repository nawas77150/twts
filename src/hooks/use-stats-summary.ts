'use client'

import { useState, useCallback } from 'react'
import type { Stats, CookieAuthStatus, KeyCredits, ApiLoginStatus, PostMethodSetting } from '@/types'
import { apiClient } from '@/lib/api-client'

// ============================================================
// buildStatsFromSummary — pure merge helper
//
// Keeps all ?? / ?. branches out of the useCallback body so
// fetchStats itself stays low-complexity. Pure function:
// no hooks, no side-effects, easy to unit-test independently.
// ============================================================

type SummaryData = Partial<
  Pick<Stats, 'cookieAuthStatus' | 'apiCredits' | 'apiLoginStatus' | 'filterSettings' | 'circuitBreaker'>
> & { postMethodSetting?: string }

function buildStatsFromSummary(prev: Stats | null, data: SummaryData): Stats {
  return {
    // Submission counts — summary endpoint omits these;
    // preserve existing state, default to 0 on first load.
    pending: prev?.pending ?? 0,
    censored: prev?.censored ?? 0,
    posting: prev?.posting ?? 0,
    postFailed: prev?.postFailed ?? 0,
    rejected: prev?.rejected ?? 0,
    posted: prev?.posted ?? 0,
    total: prev?.total ?? 0,
    submitters: prev?.submitters ?? 0,
    // Auth / method fields — prefer fresh data, fall back to prev.
    cookieAuthStatus: data.cookieAuthStatus ?? prev?.cookieAuthStatus ?? null,
    postMethodStats: prev?.postMethodStats ?? null,
    apiCredits: data.apiCredits ?? prev?.apiCredits ?? [],
    apiLoginStatus: data.apiLoginStatus ?? prev?.apiLoginStatus ?? null,
    postMethodSetting: (data.postMethodSetting ?? prev?.postMethodSetting ?? 'auto') as PostMethodSetting,
    filterSettings: data.filterSettings ?? prev?.filterSettings ?? null,
    circuitBreaker: data.circuitBreaker ?? prev?.circuitBreaker ?? null,
  }
}

// ============================================================
// useStatsSummary — Lightweight summary (for settings page)
//
// Fetches only cookie/API status, filter settings, and circuit
// breaker. No submission counts or post method stats — ideal
// for the settings page which doesn't display counts.
//
// Builds a partial Stats object (counts default to 0) so
// existing consumers that read stats.filterSettings etc.
// still work without type changes.
// ============================================================

export function useStatsSummary({ adminToken }: { adminToken: string }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [cookieStatus, setCookieStatus] = useState<CookieAuthStatus | null>(null)
  const [apiCredits, setApiCredits] = useState<KeyCredits[]>([])
  const [apiLoginStatus, setApiLoginStatus] = useState<ApiLoginStatus | null>(null)

  const fetchStats = useCallback(async () => {
    if (!adminToken) return
    try {
      const data = await apiClient.getSummary()
      setStats((prev) => buildStatsFromSummary(prev, data))
      if (data.cookieAuthStatus !== undefined) setCookieStatus(data.cookieAuthStatus)
      if (data.apiCredits !== undefined) setApiCredits(data.apiCredits ?? [])
      if (data.apiLoginStatus !== undefined) setApiLoginStatus(data.apiLoginStatus)
    } catch {
      // silently fail — next fetch will retry
    }
  }, [adminToken])

  const refetch = useCallback(async () => { await fetchStats() }, [fetchStats])

  return {
    stats,
    cookieStatus,
    apiCredits,
    apiLoginStatus,
    fetchStats,
    refetch,
  }
}
