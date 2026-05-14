'use client'

import { useState, useCallback } from 'react'
import type { FilterRules, RateLimitSettings, FilterSettings } from '@/types'
import { DEFAULT_FILTER_RULES, DEFAULT_RATE_LIMITS } from '@/types'
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
  const [showGeminiKey, setShowGeminiKey] = useState(false)
  const [rateLimits, setRateLimits] = useState<RateLimitSettings>({ ...DEFAULT_RATE_LIMITS })
  const [whitelistText, setWhitelistText] = useState('')
  const { toast } = useToast()

  // Load filter settings from stats response
  const loadFromFilterSettings = useCallback((settings: FilterSettings) => {
    setAutoApprove(settings.autoApprove)
    setBlockedWordsText(settings.blockedWords.join(', '))
    setNsfwWordsText(settings.nsfwWords.join(', '))
    setFilterRules(settings.filterRules)
    setGeminiEnabled(settings.geminiEnabled)
    setGeminiApiKeySet(settings.geminiApiKeySet)
    if (settings.rateLimits) setRateLimits(settings.rateLimits)
    if (settings.whitelistUsernames) setWhitelistText(settings.whitelistUsernames.join(', '))
  }, [])

  const toggleAutoApprove = useCallback(() => {
    setAutoApprove((prev) => !prev)
  }, [])

  const toggleRule = useCallback((key: keyof FilterRules) => {
    setFilterRules((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const setGeminiEnabledState = useCallback((val: boolean) => {
    setGeminiEnabled(val)
  }, [])

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

      const whitelist = whitelistText
        .split(/[,\n]+/)
        .map((u) => u.trim().toLowerCase())
        .filter((u) => u.length > 0)

      const data = await apiClient.saveFilterSettings({
        autoApprove,
        blockedWords: words,
        nsfwWords: nsfwWords,
        filterRules,
        geminiEnabled,
        rateLimits,
        whitelistUsernames: whitelist,
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
  }, [adminToken, autoApprove, blockedWordsText, nsfwWordsText, filterRules, geminiEnabled, rateLimits, whitelistText, onStatsRefresh, toast])

  // Reset state (used when admin logs out)
  const resetState = useCallback(() => {
    setAutoApprove(false)
    setBlockedWordsText('')
    setNsfwWordsText('')
    setFilterRules({ ...DEFAULT_FILTER_RULES })
    setGeminiEnabled(false)
    setGeminiApiKeyInput('')
    setGeminiApiKeySet(false)
    setRateLimits({ ...DEFAULT_RATE_LIMITS })
    setWhitelistText('')
  }, [])

  return {
    autoApprove,
    blockedWordsText,
    nsfwWordsText,
    filterRules,
    isSaving,
    geminiEnabled,
    geminiApiKeyInput,
    geminiApiKeySet,
    showGeminiKey,
    rateLimits,
    whitelistText,
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
    setRateLimits,
    setWhitelistText,
    saveGeminiKey,
    saveFilterSettings,
    loadFromFilterSettings,
    resetState,
  }
}
