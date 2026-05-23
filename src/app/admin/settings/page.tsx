'use client'

import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Send, Shield, Clock, Users } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { usePostingSettings } from '@/hooks/use-posting-settings'
import { useFilterSettings } from '@/hooks/use-filter-settings'
import { useCircuitBreaker } from '@/hooks/use-circuit-breaker'
import { useCensorSender } from '@/hooks/use-censor-sender'
import { useAdminStats } from '@/contexts/admin-stats-context'
import { useSettingsSync } from '@/hooks/use-settings-sync'
import { DirectPostingCard } from '@/components/settings/direct-posting-card'
import { ApiFallbackCard } from '@/components/settings/api-fallback-card'
import { HashtagsCard } from '@/components/settings/hashtags-card'
import { FilterCard } from '@/components/settings/filter-card'
import { GeminiCard } from '@/components/settings/gemini-card'
import { RateLimitCard } from '@/components/settings/rate-limit-card'
import { CircuitBreakerCard } from '@/components/settings/circuit-breaker-card'
import { WhitelistCard } from '@/components/settings/whitelist-card'
import { BlocklistCard } from '@/components/settings/blocklist-card'
import { CensorSenderCard } from '@/components/settings/censor-sender-card'
import { LimitHealthCard } from '@/components/settings/limit-health-card'

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

const TAB_TRIGGER_CLASS =
  'rounded-lg data-[state=active]:bg-[#0F1419] data-[state=active]:text-[#F7F9F9] text-[#536471] data-[state=active]:shadow-sm px-2 sm:px-4 py-2 text-xs sm:text-sm font-medium gap-1 sm:gap-2'

function SettingsTabTrigger({ value, icon: Icon, label }: { value: string; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <TabsTrigger value={value} className={TAB_TRIGGER_CLASS}>
      <Icon className="size-3.5 sm:size-4" />
      <span className="truncate">{label}</span>
    </TabsTrigger>
  )
}

export default function AdminSettingsPage() {
  const [isLoadingCredits, setIsLoadingCredits] = useState(false)
  const [savingSource, setSavingSource] = useState<'rateLimits' | 'circuitBreaker' | null>(null)

  // Hooks — declared without cross-references to avoid circular deps
  const posting = usePostingSettings()
  const filterSettings = useFilterSettings()
  const circuitBreaker = useCircuitBreaker()
  const { censored, toggle: toggleCensor } = useCensorSender()

  // Stats from context — single source for both settings data and badge
  const {
    stats,
    cookieStatus,
    apiCredits,
    apiLoginStatus,
    refetch: refetchAdminStats,
  } = useAdminStats()

  // Sync stats → local hook state (3 phases: initial load, circuit breaker, blocklist/whitelist)
  useSettingsSync({ stats, posting, filterSettings, circuitBreaker })

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

  const filterSaveRateLimits = useCallback(async () => {
    setSavingSource('rateLimits')
    await filterSettings.saveRateLimits()
    void refetchAdminStats()
    setSavingSource(null)
  }, [filterSettings, refetchAdminStats])

  const filterSaveCircuitBreaker = useCallback(async () => {
    setSavingSource('circuitBreaker')
    await filterSettings.saveCircuitBreaker()
    void refetchAdminStats()
    setSavingSource(null)
  }, [filterSettings, refetchAdminStats])

  const filterSaveGeminiKey = useCallback(async (key: string) => {
    await filterSettings.saveGeminiKey(key)
    void refetchAdminStats()
  }, [filterSettings, refetchAdminStats])

  const handleRefreshCredits = useCallback(async () => {
    setIsLoadingCredits(true)
    try {
      await refetchAdminStats({ refresh: true })
    } finally {
      setIsLoadingCredits(false)
    }
  }, [refetchAdminStats])

  return (
    <>
      {/* Tab-based Settings Layout */}
      <Tabs defaultValue="posting" className="w-full">
        <TabsList className="bg-[#EFF3F4] p-1 h-auto rounded-xl w-full sm:w-fit grid grid-cols-4 sm:flex">
          <SettingsTabTrigger value="posting" icon={Send} label="Posting" />
          <SettingsTabTrigger value="filter" icon={Shield} label="Filter" />
          <SettingsTabTrigger value="users" icon={Users} label="Users" />
          <SettingsTabTrigger value="limits" icon={Clock} label="Limits" />
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

            <HashtagsCard
              postHashtags={posting.postHashtags}
              setPostHashtags={posting.setPostHashtags}
              isSavingSetting={posting.isSavingSetting}
              saveSetting={postingSaveSetting}
            />
          </TabPanel>
        </TabsContent>

        {/* ── Filter Tab ── */}
        <TabsContent value="filter">
          <TabPanel>
            <FilterCard
              autoApprove={filterSettings.autoApprove}
              saveAutoApprove={filterSettings.saveAutoApprove}
              isSavingAutoApprove={filterSettings.isSavingAutoApprove}
              blockedWordsText={filterSettings.blockedWordsText}
              setBlockedWordsText={filterSettings.setBlockedWordsText}
              nsfwWordsText={filterSettings.nsfwWordsText}
              setNsfwWordsText={filterSettings.setNsfwWordsText}
              filterRules={filterSettings.filterRules}
              saveFilterRule={filterSettings.saveFilterRule}
              savingRuleKey={filterSettings.savingRuleKey}
              geminiEnabled={filterSettings.geminiEnabled}
              geminiApiKeySet={filterSettings.geminiApiKeySet}
              isSaving={filterSettings.isSavingFilter}
              isLoaded={filterSettings.isLoaded}
              saveFilterSettings={filterSaveFilterSettings}
              defaultBlockedWords={filterSettings.defaultBlockedWords}
              defaultNsfwWords={filterSettings.defaultNsfwWords}
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
              geminiKeySaving={filterSettings.geminiKeySaving}
              geminiModel={filterSettings.geminiModel}
              setGeminiModel={filterSettings.setGeminiModel}
              saveGeminiModel={filterSettings.saveGeminiModel}
              geminiModelSaving={filterSettings.geminiModelSaving}
            />
          </TabPanel>
        </TabsContent>

        {/* ── Users Tab ── */}
        <TabsContent value="users">
          <TabPanel>
            <WhitelistCard
              whitelistUsernames={filterSettings.whitelistUsernames}
              onWhitelistChange={() => { void refetchAdminStats({ refresh: true }) }}
            />

            <BlocklistCard
              blockedUsernames={filterSettings.blockedUsernames}
              onBlocklistChange={() => { void refetchAdminStats({ refresh: true }) }}
            />

            <CensorSenderCard censored={censored} onToggle={toggleCensor} />
          </TabPanel>
        </TabsContent>

        {/* ── Limits Tab ── */}
        <TabsContent value="limits">
          <TabPanel>
            <LimitHealthCard />

            <RateLimitCard
              rateLimits={filterSettings.rateLimits}
              setRateLimits={filterSettings.setRateLimits}
              isSaving={savingSource === 'rateLimits'}
              isLoaded={filterSettings.isLoaded}
              saveRateLimits={filterSaveRateLimits}
            />

            <CircuitBreakerCard
              circuitBreakerStatus={circuitBreaker.circuitBreakerStatus}
              liveRemainingMinutes={circuitBreaker.liveRemainingMinutes}
              rateLimits={filterSettings.rateLimits}
              setRateLimits={filterSettings.setRateLimits}
              reset={circuitBreaker.reset}
              isSaving={savingSource === 'circuitBreaker'}
              isLoaded={filterSettings.isLoaded}
              onSave={filterSaveCircuitBreaker}
            />
          </TabPanel>
        </TabsContent>
      </Tabs>
    </>
  )
}
