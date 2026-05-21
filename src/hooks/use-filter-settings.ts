'use client'

import { useState, useCallback, useEffect } from 'react'
import type { FilterRules, RateLimitSettings, FilterSettings } from '@/types'
import { DEFAULT_FILTER_RULES } from '@/types'
import { DEFAULT_RATE_LIMITS } from '@/lib/rate-limit-defaults'
import { apiClient } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'
import { useAdminAuth } from '@/contexts/admin-auth-context'

export function useFilterSettings() {
  const { isAdmin } = useAdminAuth()
  const [autoApprove, setAutoApprove] = useState(false)
  const [blockedWordsText, setBlockedWordsText] = useState('')
  const [nsfwWordsText, setNsfwWordsText] = useState('')
  const [filterRules, setFilterRules] = useState<FilterRules>({ ...DEFAULT_FILTER_RULES })
  const [isSavingFilter, setIsSavingFilter] = useState(false)
  const [isSavingRateLimits, setIsSavingRateLimits] = useState(false)
  const [geminiEnabled, setGeminiEnabled] = useState(false)
  const [geminiApiKeyInput, setGeminiApiKeyInput] = useState('')
  const [geminiApiKeySet, setGeminiApiKeySet] = useState(false)
  const [geminiModel, setGeminiModel] = useState('')
  const [showGeminiKey, setShowGeminiKey] = useState(false)
  const [rateLimits, setRateLimits] = useState<RateLimitSettings>({ ...DEFAULT_RATE_LIMITS })
  const [whitelistUsernames, setWhitelistUsernames] = useState<string[]>([])
  const [blockedUsernames, setBlockedUsernames] = useState<string[]>([])
  const [defaultBlockedWords, setDefaultBlockedWords] = useState<string[]>([])
  const [defaultNsfwWords, setDefaultNsfwWords] = useState<string[]>([])
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
    if (settings.defaultBlockedWords) setDefaultBlockedWords(settings.defaultBlockedWords)
    if (settings.defaultNsfwWords) setDefaultNsfwWords(settings.defaultNsfwWords)
  }, [])

  const [isSavingAutoApprove, setIsSavingAutoApprove] = useState(false)
  const [savingRuleKey, setSavingRuleKey] = useState<string | null>(null)

  const saveAutoApprove = useCallback(async (val: boolean) => {
    if (!isAdmin) return
    setIsSavingAutoApprove(true)
    try {
      const data = await apiClient.saveFilterSettings({ autoApprove: val })
      if (!data.error) {
        setAutoApprove(val)
        toast({ title: `Auto-Approve: ${val ? 'ON' : 'OFF'}` })
      } else {
        toast({ title: 'Failed', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to update auto-approve', variant: 'destructive' })
    } finally {
      setIsSavingAutoApprove(false)
    }
  }, [isAdmin, toast])

  const saveFilterRule = useCallback(async (key: keyof FilterRules, val: boolean) => {
    if (!isAdmin) return
    setSavingRuleKey(key)
    try {
      const data = await apiClient.saveFilterSettings({ filterRules: { ...filterRules, [key]: val } })
      if (!data.error) {
        setFilterRules((prev) => ({ ...prev, [key]: val }))
        toast({ title: `Filter: ${val ? 'ON' : 'OFF'}` })
      } else {
        toast({ title: 'Failed', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to update filter rule', variant: 'destructive' })
    } finally {
      setSavingRuleKey(null)
    }
  }, [isAdmin, filterRules, toast])

  const [geminiSaving, setGeminiSaving] = useState(false)

  const setGeminiEnabledState = useCallback(async (val: boolean) => {
    if (!isAdmin) return
    setGeminiSaving(true)
    try {
      const data = await apiClient.saveFilterSettings({ geminiEnabled: val })
      if (!data.error) {
        setGeminiEnabled(val)
        toast({ title: `Gemini AI Filter: ${val ? 'ON' : 'OFF'}` })
      } else {
        toast({ title: 'Failed to update Gemini', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to update Gemini setting', variant: 'destructive' })
    } finally {
      setGeminiSaving(false)
    }
  }, [isAdmin, toast])

  const [geminiKeySaving, setGeminiKeySaving] = useState(false)

  const saveGeminiKey = useCallback(async (key: string) => {
    if (!isAdmin) return
    setGeminiKeySaving(true)
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
    } finally {
      setGeminiKeySaving(false)
    }
  }, [isAdmin, toast])

  const [geminiModelSaving, setGeminiModelSaving] = useState(false)

  const saveGeminiModel = useCallback(async (model: string) => {
    if (!isAdmin) return
    setGeminiModelSaving(true)
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
    } finally {
      setGeminiModelSaving(false)
    }
  }, [isAdmin, toast])

  const saveFilterSettings = useCallback(async () => {
    if (!isAdmin) return
    setIsSavingFilter(true)
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
      setIsSavingFilter(false)
    }
  }, [isAdmin, autoApprove, blockedWordsText, nsfwWordsText, filterRules, geminiEnabled, toast])

  /** Save only rate-limit + circuit-breaker fields (no filter/Gemini side-effects) */
  const saveRateLimits = useCallback(async () => {
    if (!isAdmin) return
    setIsSavingRateLimits(true)
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
      setIsSavingRateLimits(false)
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
    setDefaultBlockedWords([])
    setDefaultNsfwWords([])
  }, [])

  // Reset state when admin logs out
  useEffect(() => {
    if (!isAdmin) resetState()
  }, [isAdmin, resetState])

  return {
    autoApprove,
    blockedWordsText,
    nsfwWordsText,
    filterRules,
    isSavingFilter,
    isSavingRateLimits,
    geminiEnabled,
    geminiSaving,
    geminiApiKeyInput,
    geminiApiKeySet,
    geminiModel,
    showGeminiKey,
    rateLimits,
    whitelistUsernames,
    blockedUsernames,
    defaultBlockedWords,
    defaultNsfwWords,
    saveAutoApprove,
    isSavingAutoApprove,
    setBlockedWordsText,
    setNsfwWordsText,
    setFilterRules,
    saveFilterRule,
    savingRuleKey,
    setGeminiEnabled: setGeminiEnabledState,
    setGeminiApiKeyInput,
    setShowGeminiKey,
    setGeminiModel,
    setRateLimits,
    setWhitelistUsernames,
    setBlockedUsernames,
    saveGeminiKey,
    geminiKeySaving,
    saveGeminiModel,
    geminiModelSaving,
    saveFilterSettings,
    saveRateLimits,
    loadFromFilterSettings,
    resetState,
  }
}
