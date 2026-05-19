'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
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

  // Keep a ref to fetchStats so the interval always calls the latest version
  // Updated in an effect to comply with react-hooks/refs rule.
  const fetchStatsRef = useRef(fetchStats)
  useEffect(() => { fetchStatsRef.current = fetchStats }, [fetchStats])

  // Fetch on auth change + 15s auto-refresh (keeps pendingCount badge fresh on all pages)
  useEffect(() => {
    if (!isAdmin) return
    void fetchStatsRef.current()
    const interval = setInterval(() => { void fetchStatsRef.current() }, 15000)
    return () => { clearInterval(interval) }
  }, [isAdmin])

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
