'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { Shield, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePostingSettings } from '@/hooks/use-posting-settings'
import { useFilterSettings } from '@/hooks/use-filter-settings'
import { useCircuitBreaker } from '@/hooks/use-circuit-breaker'
import { useStats } from '@/hooks/use-stats'
import { useAdminAuth } from '@/hooks/use-admin-auth'
import { DirectPostingCard } from '@/components/settings/direct-posting-card'
import { ApiFallbackCard } from '@/components/settings/api-fallback-card'
import { FilterCard } from '@/components/settings/filter-card'
import { GeminiCard } from '@/components/settings/gemini-card'
import { RateLimitCard } from '@/components/settings/rate-limit-card'
import { CircuitBreakerCard } from '@/components/settings/circuit-breaker-card'
import { WhitelistCard } from '@/components/settings/whitelist-card'
import { DEFAULT_BLOCKED_WORDS, DEFAULT_NSFW_WORDS } from '@/lib/content-filter'

export default function AdminSettingsPage() {
  const { adminToken } = useAdminAuth()
  const [isLoadingCredits, setIsLoadingCredits] = useState(false)

  // Hooks — declared without cross-references to avoid circular deps
  const posting = usePostingSettings({ adminToken })
  const filterSettings = useFilterSettings({ adminToken })
  const circuitBreaker = useCircuitBreaker({ adminToken })
  const stats = useStats({ adminToken })

  // Track whether initial settings load has happened
  // to prevent overwriting local state (toggles, text inputs) on every render
  const hasLoadedRef = useRef(false)

  // Sync stats → filter settings, circuit breaker, posting method
  // Only runs on initial load (when stats first arrive) and when token changes
  useEffect(() => {
    if (!stats.stats) return
    if (hasLoadedRef.current) return
    hasLoadedRef.current = true
    const s = stats.stats
    if (s.filterSettings) {
      filterSettings.loadFromFilterSettings(s.filterSettings)
    }
    if (s.postMethodSetting) {
      posting.setPostMethodSetting(s.postMethodSetting)
    }
    if (s.circuitBreaker) {
      circuitBreaker.setStatus(s.circuitBreaker)
    }
  }, [stats.stats]) // intentionally only depend on stats.stats

  // Always sync circuit breaker status (read-only display, safe to update)
  useEffect(() => {
    if (!stats.stats?.circuitBreaker) return
    if (!hasLoadedRef.current) return // skip during initial load (handled above)
    circuitBreaker.setStatus(stats.stats.circuitBreaker)
  }, [stats.stats?.circuitBreaker])

  // Auto-load settings from stats on mount & when token changes
  useEffect(() => {
    if (adminToken) {
      hasLoadedRef.current = false // reset so sync effect can run again
      stats.fetchStats()
    }
  }, [adminToken, stats.fetchStats])

  // Wrapper actions that also refresh stats after save
  const postingSaveSetting = useCallback(async (key: string, value: string, onSuccess?: () => void) => {
    await posting.saveSetting(key, value, () => {
      onSuccess?.()
      stats.refetch()
    })
  }, [posting, stats])

  const postingClearCache = useCallback(async () => {
    await posting.clearCache()
    stats.refetch()
  }, [posting, stats])

  const postingSaveAllCredentials = useCallback(async () => {
    await posting.saveAllCredentials()
    stats.refetch()
  }, [posting, stats])

  const filterSaveFilterSettings = useCallback(async () => {
    await filterSettings.saveFilterSettings()
    stats.refetch()
  }, [filterSettings, stats])

  const filterSaveGeminiKey = useCallback(async (key: string) => {
    await filterSettings.saveGeminiKey(key)
    stats.refetch()
  }, [filterSettings, stats])

  const handleRefreshCredits = useCallback(async () => {
    setIsLoadingCredits(true)
    await stats.refetch()
    setIsLoadingCredits(false)
  }, [stats])

  return (
    <>
      {/* Top Save Bar */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-[#0F1419]">Settings</h2>
          <p className="text-xs text-[#536471]">Manage autobase configuration</p>
        </div>
        <Button
          onClick={() => { filterSaveFilterSettings() }}
          disabled={filterSettings.isSaving}
          className="bg-[#0F1419] hover:bg-[#272c30]"
        >
          {filterSettings.isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Shield className="w-4 h-4 mr-2" />}
          Save All Settings
        </Button>
      </div>

      {/* Settings Grid */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      >
        {/* Left Column */}
        <div className="space-y-4">
          <DirectPostingCard
            cookieString={posting.cookieString}
            setCookieString={posting.setCookieString}
            bearerToken={posting.bearerToken}
            setBearerToken={posting.setBearerToken}
            queryId={posting.queryId}
            setQueryId={posting.setQueryId}
            showCookieValue={posting.showCookieValue}
            setShowCookieValue={posting.setShowCookieValue}
            showBearerValue={posting.showBearerValue}
            setShowBearerValue={posting.setShowBearerValue}
            showCookieGuide={posting.showCookieGuide}
            setShowCookieGuide={posting.setShowCookieGuide}
            showQueryIdGuide={posting.showQueryIdGuide}
            setShowQueryIdGuide={posting.setShowQueryIdGuide}
            showBearerGuide={posting.showBearerGuide}
            setShowBearerGuide={posting.setShowBearerGuide}
            isSavingSetting={posting.isSavingSetting}
            isClearingCache={posting.isClearingCache}
            saveSetting={postingSaveSetting}
            clearCache={postingClearCache}
            cookieStatus={stats.cookieStatus}
          />

          <FilterCard
            autoApprove={filterSettings.autoApprove}
            toggleAutoApprove={filterSettings.toggleAutoApprove}
            blockedWordsText={filterSettings.blockedWordsText}
            setBlockedWordsText={filterSettings.setBlockedWordsText}
            nsfwWordsText={filterSettings.nsfwWordsText}
            setNsfwWordsText={filterSettings.setNsfwWordsText}
            filterRules={filterSettings.filterRules}
            setFilterRules={filterSettings.setFilterRules}
            geminiEnabled={filterSettings.geminiEnabled}
            geminiApiKeySet={filterSettings.geminiApiKeySet}
            isSaving={filterSettings.isSaving}
            saveFilterSettings={filterSaveFilterSettings}
            defaultBlockedWords={DEFAULT_BLOCKED_WORDS}
            defaultNsfwWords={DEFAULT_NSFW_WORDS}
          />

          <RateLimitCard
            rateLimits={filterSettings.rateLimits}
            setRateLimits={filterSettings.setRateLimits}
          />
        </div>

        {/* Right Column */}
        <div className="space-y-4">
          <ApiFallbackCard
            postMethodSetting={posting.postMethodSetting}
            setPostMethodSetting={posting.setPostMethodSetting}
            xUsername={posting.xUsername}
            setXUsername={posting.setXUsername}
            xEmail={posting.xEmail}
            setXEmail={posting.setXEmail}
            xPassword={posting.xPassword}
            setXPassword={posting.setXPassword}
            xTotpSecret={posting.xTotpSecret}
            setXTotpSecret={posting.setXTotpSecret}
            apiKeys={posting.apiKeys}
            setApiKeys={posting.setApiKeys}
            apiProxy={posting.apiProxy}
            setApiProxy={posting.setApiProxy}
            isSavingSetting={posting.isSavingSetting}
            isSavingAllCredentials={posting.isSavingAllCredentials}
            saveSetting={postingSaveSetting}
            saveAllCredentials={postingSaveAllCredentials}
            apiLoginStatus={stats.apiLoginStatus}
            apiCredits={stats.apiCredits}
            onRefreshCredits={handleRefreshCredits}
            isLoadingCredits={isLoadingCredits}
          />

          <GeminiCard
            geminiEnabled={filterSettings.geminiEnabled}
            setGeminiEnabled={filterSettings.setGeminiEnabled}
            geminiApiKeyInput={filterSettings.geminiApiKeyInput}
            setGeminiApiKeyInput={filterSettings.setGeminiApiKeyInput}
            geminiApiKeySet={filterSettings.geminiApiKeySet}
            showGeminiKey={filterSettings.showGeminiKey}
            setShowGeminiKey={filterSettings.setShowGeminiKey}
            saveGeminiKey={filterSaveGeminiKey}
          />

          <CircuitBreakerCard
            circuitBreakerStatus={circuitBreaker.circuitBreakerStatus}
            liveRemainingMinutes={circuitBreaker.liveRemainingMinutes}
            rateLimits={filterSettings.rateLimits}
            setRateLimits={filterSettings.setRateLimits}
            reset={circuitBreaker.reset}
          />

          <WhitelistCard
            whitelistText={filterSettings.whitelistText}
            setWhitelistText={filterSettings.setWhitelistText}
          />
        </div>
      </motion.div>

      {/* Bottom Save Button */}
      <div className="mt-6 flex justify-end">
        <Button
          onClick={() => { filterSaveFilterSettings() }}
          disabled={filterSettings.isSaving}
          className="bg-[#0F1419] hover:bg-[#272c30]"
        >
          {filterSettings.isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Shield className="w-4 h-4 mr-2" />}
          Save All Settings
        </Button>
      </div>
    </>
  )
}
