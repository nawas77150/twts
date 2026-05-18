'use client'

import { useState, useCallback } from 'react'
import type { Stats, CookieAuthStatus, PostMethodStats, KeyCredits, ApiLoginStatus, PostMethod } from '@/types'
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

  const refetch = useCallback(async () => fetchStats(), [fetchStats])

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
      // Build a partial Stats object — submission counts default to 0
      // (summary endpoint doesn't provide them; settings page doesn't display them)
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
      if (data.cookieAuthStatus !== undefined) setCookieStatus(data.cookieAuthStatus)
      if (data.apiCredits !== undefined) setApiCredits(data.apiCredits ?? [])
      if (data.apiLoginStatus !== undefined) setApiLoginStatus(data.apiLoginStatus)
    } catch {
      // silently fail — next fetch will retry
    }
  }, [adminToken])

  const refetch = useCallback(async () => fetchStats(), [fetchStats])

  return {
    stats,
    cookieStatus,
    apiCredits,
    apiLoginStatus,
    fetchStats,
    refetch,
  }
}
