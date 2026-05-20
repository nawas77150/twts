'use client'

import { useState, useCallback } from 'react'
import type { FilterRules, RateLimitSettings, FilterSettings } from '@/types'
import { DEFAULT_FILTER_RULES } from '@/types'
import { DEFAULT_RATE_LIMITS } from '@/lib/filter-settings'
import { DEFAULT_BLOCKED_WORDS, DEFAULT_NSFW_WORDS } from '@/lib/content-filter'
import { apiClient } from '@/lib/api-client'
import { safeAccess } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { useAdminAuth } from '@/contexts/admin-auth-context'

export function useFilterSettings() {
  const { isAdmin } = useAdminAuth()
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
    setFilterRules((prev) => ({ ...prev, [key]: !safeAccess(prev, key) }))
  }, [])

  const [geminiSaving, setGeminiSaving] = useState(false)

  const setGeminiEnabledState = useCallback(async (val: boolean) => {
    if (!isAdmin) return
    // Optimistic update
    setGeminiEnabled(val)
    setGeminiSaving(true)
    try {
      const data = await apiClient.saveFilterSettings({ geminiEnabled: val })
      if (!data.error) {
        toast({ title: `Gemini AI Filter: ${val ? 'ON' : 'OFF'}` })
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
  }, [isAdmin, toast])

  const saveGeminiKey = useCallback(async (key: string) => {
    if (!isAdmin) return
    try {
      const data = await apiClient.saveFilterSettings({ geminiApiKey: key.trim() })
      if (!data.error) {
        setGeminiApiKeyInput('')
        setGeminiApiKeySet(true)
        toast({ title: 'Gemini API key saved!' })
      } else {
        toast({ title: 'Failed', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save API key', variant: 'destructive' })
    }
  }, [isAdmin, toast])

  const saveGeminiModel = useCallback(async (model: string) => {
    if (!isAdmin) return
    try {
      const data = await apiClient.saveFilterSettings({ geminiModel: model.trim() })
      if (!data.error) {
        setGeminiModel(model.trim())
        toast({ title: 'Gemini model saved!', description: `Using ${model.trim()}` })
      } else {
        toast({ title: 'Failed', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save model', variant: 'destructive' })
    }
  }, [isAdmin, toast])

  const saveFilterSettings = useCallback(async () => {
    if (!isAdmin) return
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
        // rateLimits is NOT sent here — use saveRateLimits() for that
      })
      if (!data.error) {
        toast({
          title: 'Filter settings saved!',
          description: `Auto-approve: ${autoApprove ? 'ON' : 'OFF'}, ${words.length} blocked words, Gemini: ${geminiEnabled ? 'ON' : 'OFF'}`,
        })
      } else {
        toast({ title: 'Failed', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save filter settings', variant: 'destructive' })
    } finally {
      setIsSaving(false)
    }
  }, [isAdmin, autoApprove, blockedWordsText, nsfwWordsText, filterRules, geminiEnabled, toast])

  /** Save only rate-limit + circuit-breaker fields (no filter/Gemini side-effects) */
  const saveRateLimits = useCallback(async () => {
    if (!isAdmin) return
    setIsSaving(true)
    try {
      const data = await apiClient.saveFilterSettings({ rateLimits })
      if (!data.error) {
        toast({
          title: 'Rate limits saved!',
          description: `Cooldown: ${rateLimits.submissionCooldown}m, Daily cap: ${rateLimits.submissionDailyCap}`,
        })
      } else {
        toast({ title: 'Failed', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save rate limits', variant: 'destructive' })
    } finally {
      setIsSaving(false)
    }
  }, [isAdmin, rateLimits, toast])

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
    saveRateLimits,
    loadFromFilterSettings,
    resetState,
  }
}
