'use client'

import { useState, useCallback } from 'react'
import type { FilterRules, RateLimitSettings, FilterSettings } from '@/types'
import { DEFAULT_FILTER_RULES } from '@/types'
import { DEFAULT_RATE_LIMITS } from '@/lib/filter-settings'
import { DEFAULT_BLOCKED_WORDS, DEFAULT_NSFW_WORDS } from '@/lib/content-filter'
import { apiClient } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'

interface UseFilterSettingsParams {
  adminToken: string
  onStatsRefresh?: () => void
}

export function useFilterSettings({ adminToken, onStatsRefresh }: UseFilterSettingsParams) {
  const [autoApprove, setAutoApprove] = useState(false)
  const [blockedWordsText, setBlockedWordsText] = useState('')
  const [nsfwWordsText, setNsfwWordsText] = useState('')
  const [filterRules, setFilterRules] = useState<FilterRules>({ ...DEFAULT_FILTER_RULES })
  const [isSaving, setIsSaving] = useState(false)
  const [geminiEnabled, setGeminiEnabled] = useState(false)
  const [geminiApiKeyInput, setGeminiApiKeyInput] = useState('')
  const [geminiApiKeySet, setGeminiApiKeySet] = useState(false)
  const [geminiModel, setGeminiModel] = useState('')
  const [showGeminiKey, setShowGeminiKey] = useState(false)
  const [rateLimits, setRateLimits] = useState<RateLimitSettings>({ ...DEFAULT_RATE_LIMITS })
  const [whitelistUsernames, setWhitelistUsernames] = useState<string[]>([])
  const [blockedUsernames, setBlockedUsernames] = useState<string[]>([])
  const { toast } = useToast()

  // Load filter settings from stats response
  const loadFromFilterSettings = useCallback((settings: FilterSettings) => {
    setAutoApprove(settings.autoApprove)
    setBlockedWordsText(settings.blockedWords.join(', '))
    setNsfwWordsText(settings.nsfwWords.join(', '))
    setFilterRules(settings.filterRules)
    setGeminiEnabled(settings.geminiEnabled)
    setGeminiApiKeySet(settings.geminiApiKeySet)
    setGeminiModel(settings.geminiModel || '')
    if (settings.rateLimits) setRateLimits(settings.rateLimits)
    if (settings.whitelistUsernames) setWhitelistUsernames(settings.whitelistUsernames)
    if (settings.blockedUsernames) setBlockedUsernames(settings.blockedUsernames)
  }, [])

  const toggleAutoApprove = useCallback(() => {
    setAutoApprove((prev) => !prev)
  }, [])

  const toggleRule = useCallback((key: keyof FilterRules) => {
    setFilterRules((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const [geminiSaving, setGeminiSaving] = useState(false)

  const setGeminiEnabledState = useCallback(async (val: boolean) => {
    if (!adminToken) return
    // Optimistic update
    setGeminiEnabled(val)
    setGeminiSaving(true)
    try {
      const data = await apiClient.saveFilterSettings({ geminiEnabled: val })
      if (!data.error) {
        toast({ title: `Gemini AI Filter: ${val ? 'ON' : 'OFF'}` })
        onStatsRefresh?.()
      } else {
        // Revert on failure
        setGeminiEnabled(!val)
        toast({ title: 'Failed to update Gemini', description: data.error, variant: 'destructive' })
      }
    } catch {
      setGeminiEnabled(!val)
      toast({ title: 'Error', description: 'Failed to update Gemini setting', variant: 'destructive' })
    } finally {
      setGeminiSaving(false)
    }
  }, [adminToken, onStatsRefresh, toast])

  const saveGeminiKey = useCallback(async (key: string) => {
    if (!adminToken) return
    try {
      const data = await apiClient.saveFilterSettings({ geminiApiKey: key.trim() })
      if (!data.error) {
        setGeminiApiKeyInput('')
        setGeminiApiKeySet(true)
        toast({ title: 'Gemini API key saved!' })
        onStatsRefresh?.()
      } else {
        toast({ title: 'Failed', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save API key', variant: 'destructive' })
    }
  }, [adminToken, onStatsRefresh, toast])

  const saveGeminiModel = useCallback(async (model: string) => {
    if (!adminToken) return
    try {
      const data = await apiClient.saveFilterSettings({ geminiModel: model.trim() })
      if (!data.error) {
        setGeminiModel(model.trim())
        toast({ title: 'Gemini model saved!', description: `Using ${model.trim()}` })
        onStatsRefresh?.()
      } else {
        toast({ title: 'Failed', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save model', variant: 'destructive' })
    }
  }, [adminToken, onStatsRefresh, toast])

  const saveFilterSettings = useCallback(async () => {
    if (!adminToken) return
    setIsSaving(true)
    try {
      const words = blockedWordsText
        .split(/[,\n]+/)
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w.length > 0)

      const nsfwWords = nsfwWordsText
        .split(/[,\n]+/)
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w.length > 0)

      const data = await apiClient.saveFilterSettings({
        autoApprove,
        blockedWords: words,
        nsfwWords: nsfwWords,
        filterRules,
        geminiEnabled,
        rateLimits,
        // whitelistUsernames is NOT saved here — the whitelist/unwhitelist routes
        // manage it atomically via SQL. Sending it here would overwrite
        // the whitelist with stale data if another admin modified it
        // since this page loaded.
      })
      if (!data.error) {
        toast({
          title: 'Filter settings saved!',
          description: `Auto-approve: ${autoApprove ? 'ON' : 'OFF'}, ${words.length} blocked words, Gemini: ${geminiEnabled ? 'ON' : 'OFF'}, Cooldown: ${rateLimits.submissionCooldown}m, Daily cap: ${rateLimits.submissionDailyCap}`,
        })
        onStatsRefresh?.()
      } else {
        toast({ title: 'Failed', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save filter settings', variant: 'destructive' })
    } finally {
      setIsSaving(false)
    }
  }, [adminToken, autoApprove, blockedWordsText, nsfwWordsText, filterRules, geminiEnabled, rateLimits, onStatsRefresh, toast])

  // Reset state (used when admin logs out)
  const resetState = useCallback(() => {
    setAutoApprove(false)
    setBlockedWordsText('')
    setNsfwWordsText('')
    setFilterRules({ ...DEFAULT_FILTER_RULES })
    setGeminiEnabled(false)
    setGeminiApiKeyInput('')
    setGeminiApiKeySet(false)
    setGeminiModel('')
    setRateLimits({ ...DEFAULT_RATE_LIMITS })
    setWhitelistUsernames([])
    setBlockedUsernames([])
  }, [])

  return {
    autoApprove,
    blockedWordsText,
    nsfwWordsText,
    filterRules,
    isSaving,
    geminiEnabled,
    geminiSaving,
    geminiApiKeyInput,
    geminiApiKeySet,
    geminiModel,
    showGeminiKey,
    rateLimits,
    whitelistUsernames,
    blockedUsernames,
    DEFAULT_BLOCKED_WORDS,
    DEFAULT_NSFW_WORDS,
    toggleAutoApprove,
    setBlockedWordsText,
    setNsfwWordsText,
    setFilterRules,
    toggleRule,
    setGeminiEnabled: setGeminiEnabledState,
    setGeminiApiKeyInput,
    setShowGeminiKey,
    setGeminiModel,
    setRateLimits,
    setWhitelistUsernames,
    setBlockedUsernames,
    saveGeminiKey,
    saveGeminiModel,
    saveFilterSettings,
    loadFromFilterSettings,
    resetState,
  }
}
