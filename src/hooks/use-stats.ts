'use client'

import { useState, useCallback } from 'react'
import type { Stats, CookieAuthStatus, PostMethodStats, KeyCredits, ApiLoginStatus } from '@/types'
import { apiClient } from '@/lib/api-client'

// ============================================================
// useStats — Full admin stats (for dashboard)
//
// Fetches ALL stats: submission counts, post method stats,
// cookie/API status. Used by the admin dashboard page.
// ============================================================

export function useStats({ adminToken }: { adminToken: string }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [cookieStatus, setCookieStatus] = useState<CookieAuthStatus | null>(null)
  const [postMethodStats, setPostMethodStats] = useState<PostMethodStats | null>(null)
  const [apiCredits, setApiCredits] = useState<KeyCredits[]>([])
  const [apiLoginStatus, setApiLoginStatus] = useState<ApiLoginStatus | null>(null)

  const fetchStats = useCallback(async () => {
    if (!adminToken) return
    try {
      const data = await apiClient.getStats()
      setStats(data)
      if (data.cookieAuthStatus !== undefined) setCookieStatus(data.cookieAuthStatus)
      if (data.apiCredits !== undefined) setApiCredits(data.apiCredits ?? [])
      if (data.apiLoginStatus !== undefined) setApiLoginStatus(data.apiLoginStatus)
      if (data.postMethodStats) setPostMethodStats(data.postMethodStats)
    } catch {
      // silently fail — next fetch will retry
    }
  }, [adminToken])

  const refetch = useCallback(async () => { await fetchStats() }, [fetchStats])

  return {
    stats,
    cookieStatus,
    postMethodStats,
    apiCredits,
    apiLoginStatus,
    fetchStats,
    refetch,
  }
}
