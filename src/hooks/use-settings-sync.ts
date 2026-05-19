import { useEffect, useRef } from 'react'
import type { Stats, PostMethodSetting } from '@/types'

interface UseSettingsSyncParams {
  stats: Stats | null
  posting: {
    setPostMethodSetting: (v: PostMethodSetting) => void
    setV2LoginEnabled: (v: boolean) => void
  }
  filterSettings: {
    loadFromFilterSettings: (fs: NonNullable<Stats['filterSettings']>) => void
    setBlockedUsernames: (v: string[]) => void
    setWhitelistUsernames: (v: string[]) => void
  }
  circuitBreaker: {
    setStatus: (cb: NonNullable<Stats['circuitBreaker']>) => void
  }
}

/**
 * Sync stats → local hook state for the settings page.
 * Three sync phases:
 * 1. Initial load (stats first arrive) — populate all local state
 * 2. Circuit breaker updates (read-only display, always synced)
 * 3. Blocklist/whitelist updates (after mutations, safe to overwrite)
 */
export function useSettingsSync({
  stats,
  posting,
  filterSettings,
  circuitBreaker,
}: UseSettingsSyncParams) {
  // Track whether initial settings load has happened
  // to prevent overwriting local state (toggles, text inputs) on every render
  const hasLoadedRef = useRef(false)

  // Phase 1: Sync stats → filter settings, circuit breaker, posting method
  // Only runs on initial load (when stats first arrive)
  useEffect(() => {
    if (!stats) return
    if (hasLoadedRef.current) return
    hasLoadedRef.current = true
    if (stats.filterSettings) {
      filterSettings.loadFromFilterSettings(stats.filterSettings)
    }
    if (stats.postMethodSetting) {
      posting.setPostMethodSetting(stats.postMethodSetting)
    }
    if (stats.apiLoginStatus?.v2LoginEnabled !== undefined) {
      posting.setV2LoginEnabled(stats.apiLoginStatus.v2LoginEnabled)
    }
    if (stats.circuitBreaker) {
      circuitBreaker.setStatus(stats.circuitBreaker)
    }
  }, [stats, circuitBreaker.setStatus, filterSettings.loadFromFilterSettings, posting.setPostMethodSetting, posting.setV2LoginEnabled])

  // Phase 2: Always sync circuit breaker status (read-only display, safe to update)
  useEffect(() => {
    if (!stats?.circuitBreaker) return
    if (!hasLoadedRef.current) return // skip during initial load (handled above)
    circuitBreaker.setStatus(stats.circuitBreaker)
  }, [stats?.circuitBreaker, circuitBreaker.setStatus])

  // Phase 3: Sync blocklist/whitelist after mutations (display-only, safe to overwrite)
  // Unlike text inputs/toggles, these lists are never edited in-place —
  // they change atomically via API calls that trigger refetchAdminStats().
  useEffect(() => {
    if (!stats?.filterSettings) return
    if (!hasLoadedRef.current) return // skip during initial load (handled above)
    const { blockedUsernames, whitelistUsernames } = stats.filterSettings
    if (blockedUsernames) filterSettings.setBlockedUsernames(blockedUsernames)
    if (whitelistUsernames) filterSettings.setWhitelistUsernames(whitelistUsernames)
  }, [stats?.filterSettings, filterSettings.setBlockedUsernames, filterSettings.setWhitelistUsernames])
}
