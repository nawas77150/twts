import { useEffect, useRef } from 'react'
import type { Stats, PostMethodSetting } from '@/types'

interface UseSettingsSyncParams {
  stats: Stats | null
  posting: {
    setPostMethodSetting: (v: PostMethodSetting) => void
    setV2LoginEnabled: (v: boolean) => void
    setPostHashtags: (v: string) => void
  }
  filterSettings: {
    loadFromFilterSettings: (fs: NonNullable<Stats['filterSettings']>) => void
    setBlockedUsernames: (v: string[]) => void
    setBlockedReasons: (v: Record<string, string>) => void
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
  // hasLoadedRef guards against duplicate execution on re-renders
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
    if (stats.filterSettings?.postHashtags !== undefined) {
      posting.setPostHashtags(stats.filterSettings.postHashtags)
    }
    if (stats.circuitBreaker) {
      circuitBreaker.setStatus(stats.circuitBreaker)
    }
  }, [stats, circuitBreaker, filterSettings, posting])

  // Phase 2: Always sync circuit breaker status (read-only display, safe to update)
  useEffect(() => {
    if (!stats?.circuitBreaker) return
    if (!hasLoadedRef.current) return // skip during initial load (handled above)
    circuitBreaker.setStatus(stats.circuitBreaker)
  }, [stats?.circuitBreaker, circuitBreaker])

  // Phase 3: Sync blocklist/whitelist after mutations (display-only, safe to overwrite)
  // Unlike text inputs/toggles, these lists are never edited in-place —
  // they change atomically via API calls that trigger refetchAdminStats().
  useEffect(() => {
    if (!stats?.filterSettings) return
    if (!hasLoadedRef.current) return // skip during initial load (handled above)
    const { blockedUsernames, blockedReasons, whitelistUsernames } = stats.filterSettings
    filterSettings.setBlockedUsernames(blockedUsernames)
    filterSettings.setBlockedReasons(blockedReasons)
    filterSettings.setWhitelistUsernames(whitelistUsernames)
  }, [stats?.filterSettings, filterSettings])
}
