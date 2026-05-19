'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { Send, Shield, Clock, Users } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { usePostingSettings } from '@/hooks/use-posting-settings'
import { useFilterSettings } from '@/hooks/use-filter-settings'
import { useCircuitBreaker } from '@/hooks/use-circuit-breaker'
import { useAdminStats } from '@/contexts/admin-stats-context'
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

function TabPanel({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="space-y-4 mt-4"
    >
      {children}
    </motion.div>
  )
}

export default function AdminSettingsPage() {
  const [isLoadingCredits, setIsLoadingCredits] = useState(false)

  // Hooks — declared without cross-references to avoid circular deps
  const posting = usePostingSettings()
  const filterSettings = useFilterSettings()
  const circuitBreaker = useCircuitBreaker()

  // Stats from context — single source for both settings data and badge
  const {
    stats,
    cookieStatus,
    apiCredits,
    apiLoginStatus,
    refetch: refetchAdminStats,
  } = useAdminStats()

  // Track whether initial settings load has happened
  // to prevent overwriting local state (toggles, text inputs) on every render
  const hasLoadedRef = useRef(false)

  // Sync stats → filter settings, circuit breaker, posting method
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
  }, [stats, circuitBreaker.setStatus, filterSettings.loadFromFilterSettings, posting.setPostMethodSetting]) // deps include all used functions

  // Always sync circuit breaker status (read-only display, safe to update)
  useEffect(() => {
    if (!stats?.circuitBreaker) return
    if (!hasLoadedRef.current) return // skip during initial load (handled above)
    circuitBreaker.setStatus(stats.circuitBreaker)
  }, [stats?.circuitBreaker, circuitBreaker.setStatus])

  // Sync blocklist/whitelist after mutations (display-only, safe to overwrite)
  // Unlike text inputs/toggles, these lists are never edited in-place —
  // they change atomically via API calls that trigger refetchAdminStats().
  useEffect(() => {
    if (!stats?.filterSettings) return
    if (!hasLoadedRef.current) return // skip during initial load (handled above)
    const { blockedUsernames, whitelistUsernames } = stats.filterSettings
    if (blockedUsernames) filterSettings.setBlockedUsernames(blockedUsernames)
    if (whitelistUsernames) filterSettings.setWhitelistUsernames(whitelistUsernames)
  }, [stats?.filterSettings?.blockedUsernames, stats?.filterSettings?.whitelistUsernames])

  // Wrapper actions that also refresh stats after save
  // Single-call pattern: only refetchAdminStats() — one API call refreshes both settings data + badge
  const postingSaveSetting = useCallback(async (key: string, value: string, onSuccess?: () => void, onFailure?: () => void) => {
    await posting.saveSetting(key, value, () => {
      onSuccess?.()
      refetchAdminStats()
    }, onFailure)
  }, [posting, refetchAdminStats])

  const postingClearCache = useCallback(async () => {
    await posting.clearCache()
    void refetchAdminStats()
  }, [posting, refetchAdminStats])

  const postingSaveAllCredentials = useCallback(async () => {
    await posting.saveAllCredentials()
    void refetchAdminStats()
  }, [posting, refetchAdminStats])

  const filterSaveFilterSettings = useCallback(async () => {
    await filterSettings.saveFilterSettings()
    void refetchAdminStats()
  }, [filterSettings, refetchAdminStats])

  const filterSaveGeminiKey = useCallback(async (key: string) => {
    await filterSettings.saveGeminiKey(key)
    void refetchAdminStats()
  }, [filterSettings, refetchAdminStats])

  const handleRefreshCredits = useCallback(async () => {
    setIsLoadingCredits(true)
    await refetchAdminStats()
    setIsLoadingCredits(false)
  }, [refetchAdminStats])

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-bold text-[#0F1419]">Settings</h2>
        <p className="text-xs text-[#536471]">Manage autobase configuration</p>
      </div>

      {/* Encryption Warning Banner */}
      <div className="mb-4">
        <EncryptionBanner encryptionEnabled={stats?.encryptionEnabled} />
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
          <TabPanel>
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
              cookieStatus={cookieStatus}
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
              apiLoginStatus={apiLoginStatus}
              apiCredits={apiCredits}
              onRefreshCredits={handleRefreshCredits}
              isLoadingCredits={isLoadingCredits}
            />
          </TabPanel>
        </TabsContent>

        {/* ── Filter Tab ── */}
        <TabsContent value="filter">
          <TabPanel>
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
          </TabPanel>
        </TabsContent>

        {/* ── Users Tab ── */}
        <TabsContent value="users">
          <TabPanel>
            <WhitelistCard
              whitelistUsernames={filterSettings.whitelistUsernames}
              onWhitelistChange={() => { void refetchAdminStats() }}
            />

            <BlocklistCard
              blockedUsernames={filterSettings.blockedUsernames}
              onBlocklistChange={() => { void refetchAdminStats() }}
            />
          </TabPanel>
        </TabsContent>

        {/* ── Limits Tab ── */}
        <TabsContent value="limits">
          <TabPanel>
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
          </TabPanel>
        </TabsContent>
      </Tabs>
    </>
  )
}
