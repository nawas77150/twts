'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { Send, Shield, Clock, Users } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { usePostingSettings } from '@/hooks/use-posting-settings'
import { useFilterSettings } from '@/hooks/use-filter-settings'
import { useCircuitBreaker } from '@/hooks/use-circuit-breaker'
import { useStatsSummary } from '@/hooks/use-stats'
import { useAdminAuth } from '@/hooks/use-admin-auth'
import { DirectPostingCard } from '@/components/settings/direct-posting-card'
import { ApiFallbackCard } from '@/components/settings/api-fallback-card'
import { FilterCard } from '@/components/settings/filter-card'
import { GeminiCard } from '@/components/settings/gemini-card'
import { RateLimitCard } from '@/components/settings/rate-limit-card'
import { CircuitBreakerCard } from '@/components/settings/circuit-breaker-card'
import { WhitelistCard } from '@/components/settings/whitelist-card'
import { BlocklistCard } from '@/components/settings/blocklist-card'
import { LimitHealthCard } from '@/components/settings/limit-health-card'
import { EncryptionBanner } from '@/components/dashboard/encryption-banner'
import { DEFAULT_BLOCKED_WORDS, DEFAULT_NSFW_WORDS } from '@/lib/content-filter'

export default function AdminSettingsPage() {
  const { adminToken } = useAdminAuth()
  const [isLoadingCredits, setIsLoadingCredits] = useState(false)

  // Hooks — declared without cross-references to avoid circular deps
  const posting = usePostingSettings({ adminToken })
  const filterSettings = useFilterSettings({ adminToken })
  const circuitBreaker = useCircuitBreaker({ adminToken })
  const stats = useStatsSummary({ adminToken })

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
    if (s.apiLoginStatus?.v2LoginEnabled !== undefined) {
      posting.setV2LoginEnabled(s.apiLoginStatus.v2LoginEnabled)
    }
    if (s.circuitBreaker) {
      circuitBreaker.setStatus(s.circuitBreaker)
    }
  }, [stats.stats, circuitBreaker.setStatus, filterSettings.loadFromFilterSettings, posting.setPostMethodSetting]) // deps include all used functions

  // Always sync circuit breaker status (read-only display, safe to update)
  useEffect(() => {
    if (!stats.stats?.circuitBreaker) return
    if (!hasLoadedRef.current) return // skip during initial load (handled above)
    circuitBreaker.setStatus(stats.stats.circuitBreaker)
  }, [stats.stats?.circuitBreaker, circuitBreaker.setStatus])

  // Sync blocklist/whitelist after mutations (display-only, safe to overwrite)
  // Unlike text inputs/toggles, these lists are never edited in-place —
  // they change atomically via API calls that trigger stats.refetch().
  useEffect(() => {
    if (!stats.stats?.filterSettings) return
    if (!hasLoadedRef.current) return // skip during initial load (handled above)
    const { blockedUsernames, whitelistUsernames } = stats.stats.filterSettings
    if (blockedUsernames) filterSettings.setBlockedUsernames(blockedUsernames)
    if (whitelistUsernames) filterSettings.setWhitelistUsernames(whitelistUsernames)
  }, [stats.stats?.filterSettings?.blockedUsernames, stats.stats?.filterSettings?.whitelistUsernames])

  // Auto-load settings from stats on mount & when token changes
  useEffect(() => {
    if (adminToken) {
      hasLoadedRef.current = false // reset so sync effect can run again
      void stats.fetchStats()
    }
  }, [adminToken, stats.fetchStats])

  // Wrapper actions that also refresh stats after save
  const postingSaveSetting = useCallback(async (key: string, value: string, onSuccess?: () => void, onFailure?: () => void) => {
    await posting.saveSetting(key, value, () => {
      onSuccess?.()
      stats.refetch()
    }, onFailure)
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
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-bold text-[#0F1419]">Settings</h2>
        <p className="text-xs text-[#536471]">Manage autobase configuration</p>
      </div>

      {/* Encryption Warning Banner */}
      <div className="mb-4">
        <EncryptionBanner encryptionEnabled={stats.stats?.encryptionEnabled} />
      </div>

      {/* Tab-based Settings Layout */}
      <Tabs defaultValue="posting" className="w-full">
        <TabsList className="bg-[#EFF3F4] p-1 h-auto rounded-xl w-full sm:w-fit grid grid-cols-4 sm:flex">
          <TabsTrigger
            value="posting"
            className="rounded-lg data-[state=active]:bg-[#0F1419] data-[state=active]:text-[#F7F9F9] text-[#536471] data-[state=active]:shadow-sm px-2 sm:px-4 py-2 text-xs sm:text-sm font-medium gap-1 sm:gap-2"
          >
            <Send className="size-3.5 sm:size-4" />
            <span className="truncate">Posting</span>
          </TabsTrigger>
          <TabsTrigger
            value="filter"
            className="rounded-lg data-[state=active]:bg-[#0F1419] data-[state=active]:text-[#F7F9F9] text-[#536471] data-[state=active]:shadow-sm px-2 sm:px-4 py-2 text-xs sm:text-sm font-medium gap-1 sm:gap-2"
          >
            <Shield className="size-3.5 sm:size-4" />
            <span className="truncate">Filter</span>
          </TabsTrigger>
          <TabsTrigger
            value="users"
            className="rounded-lg data-[state=active]:bg-[#0F1419] data-[state=active]:text-[#F7F9F9] text-[#536471] data-[state=active]:shadow-sm px-2 sm:px-4 py-2 text-xs sm:text-sm font-medium gap-1 sm:gap-2"
          >
            <Users className="size-3.5 sm:size-4" />
            <span className="truncate">Users</span>
          </TabsTrigger>
          <TabsTrigger
            value="limits"
            className="rounded-lg data-[state=active]:bg-[#0F1419] data-[state=active]:text-[#F7F9F9] text-[#536471] data-[state=active]:shadow-sm px-2 sm:px-4 py-2 text-xs sm:text-sm font-medium gap-1 sm:gap-2"
          >
            <Clock className="size-3.5 sm:size-4" />
            <span className="truncate">Limits</span>
          </TabsTrigger>
        </TabsList>

        {/* ── Posting Tab ── */}
        <TabsContent value="posting">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="space-y-4 mt-4"
          >
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

            <ApiFallbackCard
              postMethodSetting={posting.postMethodSetting}
              setPostMethodSetting={posting.setPostMethodSetting}
              v2LoginEnabled={posting.v2LoginEnabled}
              setV2LoginEnabled={posting.setV2LoginEnabled}
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
              isSavingAnySetting={posting.isSavingAnySetting}
              isSavingAllCredentials={posting.isSavingAllCredentials}
              saveSetting={postingSaveSetting}
              saveAllCredentials={postingSaveAllCredentials}
              apiLoginStatus={stats.apiLoginStatus}
              apiCredits={stats.apiCredits}
              onRefreshCredits={handleRefreshCredits}
              isLoadingCredits={isLoadingCredits}
            />
          </motion.div>
        </TabsContent>

        {/* ── Filter Tab ── */}
        <TabsContent value="filter">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="space-y-4 mt-4"
          >
            <FilterCard
              autoApprove={filterSettings.autoApprove}
              toggleAutoApprove={filterSettings.toggleAutoApprove}
              blockedWordsText={filterSettings.blockedWordsText}
              setBlockedWordsText={filterSettings.setBlockedWordsText}
              nsfwWordsText={filterSettings.nsfwWordsText}
              setNsfwWordsText={filterSettings.setNsfwWordsText}
              filterRules={filterSettings.filterRules}
              setFilterRules={filterSettings.setFilterRules}
              toggleRule={filterSettings.toggleRule}
              geminiEnabled={filterSettings.geminiEnabled}
              geminiApiKeySet={filterSettings.geminiApiKeySet}
              isSaving={filterSettings.isSaving}
              saveFilterSettings={filterSaveFilterSettings}
              defaultBlockedWords={DEFAULT_BLOCKED_WORDS}
              defaultNsfwWords={DEFAULT_NSFW_WORDS}
            />

            <GeminiCard
              geminiEnabled={filterSettings.geminiEnabled}
              geminiSaving={filterSettings.geminiSaving}
              setGeminiEnabled={filterSettings.setGeminiEnabled}
              geminiApiKeyInput={filterSettings.geminiApiKeyInput}
              setGeminiApiKeyInput={filterSettings.setGeminiApiKeyInput}
              geminiApiKeySet={filterSettings.geminiApiKeySet}
              showGeminiKey={filterSettings.showGeminiKey}
              setShowGeminiKey={filterSettings.setShowGeminiKey}
              saveGeminiKey={filterSaveGeminiKey}
              geminiModel={filterSettings.geminiModel}
              setGeminiModel={filterSettings.setGeminiModel}
              saveGeminiModel={filterSettings.saveGeminiModel}
            />
          </motion.div>
        </TabsContent>

        {/* ── Users Tab ── */}
        <TabsContent value="users">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="space-y-4 mt-4"
          >
            <WhitelistCard
              whitelistUsernames={filterSettings.whitelistUsernames}
              onWhitelistChange={() => stats.refetch()}
            />

            <BlocklistCard
              blockedUsernames={filterSettings.blockedUsernames}
              onBlocklistChange={() => stats.refetch()}
            />
          </motion.div>
        </TabsContent>

        {/* ── Limits Tab ── */}
        <TabsContent value="limits">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="space-y-4 mt-4"
          >
            <LimitHealthCard />

            <RateLimitCard
              rateLimits={filterSettings.rateLimits}
              setRateLimits={filterSettings.setRateLimits}
              isSaving={filterSettings.isSaving}
              saveFilterSettings={filterSaveFilterSettings}
            />

            <CircuitBreakerCard
              circuitBreakerStatus={circuitBreaker.circuitBreakerStatus}
              liveRemainingMinutes={circuitBreaker.liveRemainingMinutes}
              rateLimits={filterSettings.rateLimits}
              setRateLimits={filterSettings.setRateLimits}
              reset={circuitBreaker.reset}
              isSaving={filterSettings.isSaving}
              saveFilterSettings={filterSaveFilterSettings}
            />
          </motion.div>
        </TabsContent>
      </Tabs>
    </>
  )
}
