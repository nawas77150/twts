'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { FilterRules, RateLimitSettings, FilterSettings, SaveFilterSettingsRequest } from '@/types'
import { DEFAULT_FILTER_RULES } from '@/types'
import { DEFAULT_RATE_LIMITS } from '@/lib/rate-limit-defaults'
import { apiClient } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'
import { useAdminAuth } from '@/contexts/admin-auth-context'

export function useFilterSettings() {
  const { isAdmin, registerResetCallback, unregisterResetCallback } = useAdminAuth()
  const [isLoaded, setIsLoaded] = useState(false)
  const [autoApprove, setAutoApprove] = useState(false)
  const [blockedWordsText, setBlockedWordsText] = useState('')
  const [nsfwWordsText, setNsfwWordsText] = useState('')
  const [filterRules, setFilterRules] = useState<FilterRules>({ ...DEFAULT_FILTER_RULES })
  const [isSavingFilter, setIsSavingFilter] = useState(false)
  const [isSavingRateLimits, setIsSavingRateLimits] = useState(false)
  const [isSavingCircuitBreaker, setIsSavingCircuitBreaker] = useState(false)
  const [geminiEnabled, setGeminiEnabled] = useState(false)
  const [geminiApiKeyInput, setGeminiApiKeyInput] = useState('')
  const [geminiApiKeySet, setGeminiApiKeySet] = useState(false)
  const [geminiModel, setGeminiModel] = useState('')
  const [showGeminiKey, setShowGeminiKey] = useState(false)
  const [rateLimits, setRateLimits] = useState<RateLimitSettings>({ ...DEFAULT_RATE_LIMITS })
  const [whitelistUsernames, setWhitelistUsernames] = useState<string[]>([])
  const [blockedUsernames, setBlockedUsernames] = useState<string[]>([])
  const [blockedReasons, setBlockedReasons] = useState<Record<string, string>>({})
  const [defaultBlockedWords, setDefaultBlockedWords] = useState<string[]>([])
  const [defaultNsfwWords, setDefaultNsfwWords] = useState<string[]>([])
  const { toast } = useToast()

  // Ref for latest filterRules to avoid stale closure in saveFilterRule
  const filterRulesRef = useRef(filterRules)
  useEffect(() => { filterRulesRef.current = filterRules }, [filterRules])

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
    if (settings.blockedReasons) setBlockedReasons(settings.blockedReasons)
    if (settings.defaultBlockedWords) setDefaultBlockedWords(settings.defaultBlockedWords)
    if (settings.defaultNsfwWords) setDefaultNsfwWords(settings.defaultNsfwWords)
    setIsLoaded(true)
  }, [])

  /** Shared helper: call saveFilterSettings API, toast on error, run onSuccess on success */
  const persistFilterSetting = useCallback(async (
    payload: SaveFilterSettingsRequest,
    onSuccess: () => void,
    errorMsg: string,
  ): Promise<void> => {
    try {
      const data = await apiClient.saveFilterSettings(payload)
      if (!data.error) {
        onSuccess()
      } else {
        toast({ title: 'Failed', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: errorMsg, variant: 'destructive' })
    }
  }, [toast])

  const [isSavingAutoApprove, setIsSavingAutoApprove] = useState(false)
  const [savingRuleKey, setSavingRuleKey] = useState<string | null>(null)

  const saveAutoApprove = useCallback(async (val: boolean) => {
    if (!isAdmin) return
    setIsSavingAutoApprove(true)
    await persistFilterSetting(
      { autoApprove: val },
      () => { setAutoApprove(val); toast({ title: `Auto-Approve: ${val ? 'ON' : 'OFF'}` }) },
      'Failed to update auto-approve',
    )
    setIsSavingAutoApprove(false)
  }, [isAdmin, persistFilterSetting, toast])

  const saveFilterRule = useCallback(async (key: keyof FilterRules, val: boolean) => {
    if (!isAdmin) return
    setSavingRuleKey(key)
    await persistFilterSetting(
      { filterRules: { ...filterRulesRef.current, [key]: val } },
      () => { setFilterRules((prev) => ({ ...prev, [key]: val })); toast({ title: `Filter: ${val ? 'ON' : 'OFF'}` }) },
      'Failed to update filter rule',
    )
    setSavingRuleKey(null)
  }, [isAdmin, persistFilterSetting, toast])

  const [geminiSaving, setGeminiSaving] = useState(false)

  const setGeminiEnabledState = useCallback(async (val: boolean) => {
    if (!isAdmin) return
    setGeminiSaving(true)
    await persistFilterSetting(
      { geminiEnabled: val },
      () => { setGeminiEnabled(val); toast({ title: `Gemini AI Filter: ${val ? 'ON' : 'OFF'}` }) },
      'Failed to update Gemini setting',
    )
    setGeminiSaving(false)
  }, [isAdmin, persistFilterSetting, toast])

  const [geminiKeySaving, setGeminiKeySaving] = useState(false)

  const saveGeminiKey = useCallback(async (key: string) => {
    if (!isAdmin) return
    setGeminiKeySaving(true)
    await persistFilterSetting(
      { geminiApiKey: key.trim() },
      () => { setGeminiApiKeyInput(''); setGeminiApiKeySet(true); toast({ title: 'Gemini API key saved!' }) },
      'Failed to save API key',
    )
    setGeminiKeySaving(false)
  }, [isAdmin, persistFilterSetting, toast])

  const [geminiModelSaving, setGeminiModelSaving] = useState(false)

  const saveGeminiModel = useCallback(async (model: string) => {
    if (!isAdmin) return
    setGeminiModelSaving(true)
    await persistFilterSetting(
      { geminiModel: model.trim() },
      () => { setGeminiModel(model.trim()); toast({ title: 'Gemini model saved!', description: `Using ${model.trim()}` }) },
      'Failed to save model',
    )
    setGeminiModelSaving(false)
  }, [isAdmin, persistFilterSetting, toast])

  const saveFilterSettings = useCallback(async () => {
    if (!isAdmin) return
    setIsSavingFilter(true)
    const words = blockedWordsText
      .split(/[,\n]+/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length > 0)

    const nsfwWords = nsfwWordsText
      .split(/[,\n]+/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length > 0)

    await persistFilterSetting(
      { autoApprove, blockedWords: words, nsfwWords, filterRules, geminiEnabled },
      () => { toast({ title: 'Filter settings saved!', description: `Auto-approve: ${autoApprove ? 'ON' : 'OFF'}, ${words.length} blocked words, Gemini: ${geminiEnabled ? 'ON' : 'OFF'}` }) },
      'Failed to save filter settings',
    )
    setIsSavingFilter(false)
  }, [isAdmin, autoApprove, blockedWordsText, nsfwWordsText, filterRules, geminiEnabled, persistFilterSetting, toast])

  /** Save only rate-limit fields (no filter/Gemini/circuit-breaker side-effects) */
  const saveRateLimits = useCallback(async () => {
    if (!isAdmin) return
    setIsSavingRateLimits(true)
    const { circuitBreakerThreshold: _circuitBreakerThreshold, circuitBreakerCooldownMinutes: _circuitBreakerCooldownMinutes, circuitBreakerFailureWindowMinutes: _cbWindow, ...rateOnly } = rateLimits
    await persistFilterSetting(
      { rateLimits: rateOnly },
      () => { toast({ title: 'Rate limits saved!', description: `Cooldown: ${rateLimits.submissionCooldown}m, Daily cap: ${rateLimits.submissionDailyCap}` }) },
      'Failed to save rate limits',
    )
    setIsSavingRateLimits(false)
  }, [isAdmin, rateLimits, persistFilterSetting, toast])

  /** Save only circuit-breaker fields (threshold, cooldown, window) */
  const saveCircuitBreaker = useCallback(async () => {
    if (!isAdmin) return
    setIsSavingCircuitBreaker(true)
    const { circuitBreakerThreshold, circuitBreakerCooldownMinutes, circuitBreakerFailureWindowMinutes } = rateLimits
    await persistFilterSetting(
      { rateLimits: { circuitBreakerThreshold, circuitBreakerCooldownMinutes, circuitBreakerFailureWindowMinutes } },
      () => { toast({ title: 'Circuit breaker saved!', description: `Threshold: ${circuitBreakerThreshold}x, Pause: ${circuitBreakerCooldownMinutes}m` }) },
      'Failed to save circuit breaker',
    )
    setIsSavingCircuitBreaker(false)
  }, [isAdmin, rateLimits, persistFilterSetting, toast])

  // Reset state on logout — registered imperatively via auth context (M-2)
  const resetState = useCallback(() => {
    setIsLoaded(false)
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
    setBlockedReasons({})
    setDefaultBlockedWords([])
    setDefaultNsfwWords([])
    // Reset loading/visibility flags
    setIsSavingFilter(false)
    setIsSavingRateLimits(false)
    setIsSavingCircuitBreaker(false)
    setIsSavingAutoApprove(false)
    setSavingRuleKey(null)
    setGeminiSaving(false)
    setGeminiKeySaving(false)
    setGeminiModelSaving(false)
    setShowGeminiKey(false)
  }, [])

  useEffect(() => {
    registerResetCallback(resetState)
    return () => unregisterResetCallback(resetState)
  }, [registerResetCallback, unregisterResetCallback, resetState])

  return {
    isLoaded,
    autoApprove,
    blockedWordsText,
    nsfwWordsText,
    filterRules,
    isSavingFilter,
    isSavingRateLimits,
    isSavingCircuitBreaker,
    geminiEnabled,
    geminiSaving,
    geminiApiKeyInput,
    geminiApiKeySet,
    geminiModel,
    showGeminiKey,
    rateLimits,
    whitelistUsernames,
    blockedUsernames,
    blockedReasons,
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
    setBlockedReasons,
    saveGeminiKey,
    geminiKeySaving,
    saveGeminiModel,
    geminiModelSaving,
    saveFilterSettings,
    saveRateLimits,
    saveCircuitBreaker,
    loadFromFilterSettings,
  }
}
