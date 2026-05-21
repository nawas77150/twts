'use client'

import { useState, useCallback, useEffect } from 'react'
import type { PostMethodSetting } from '@/types'
import { apiClient } from '@/lib/api-client'
import { getErrorMessage } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { useAdminAuth } from '@/contexts/admin-auth-context'

// Map (not Record) avoids the "Generic Object Injection Sink" SAST warning:
// plain objects have a prototype chain (__proto__, constructor) that SAST
// flags on dynamic-key access. Map.get() has no prototype chain.
const SETTING_LABELS = new Map<string, string>([
  ['x_cookie_string', 'Cookie String'],
  ['x_query_id', 'Query ID'],
  ['x_bearer_token', 'Bearer Token'],
  ['twitterapi_keys', 'API Keys'],
  ['twitterapi_proxy', 'Proxy URL'],
  ['post_method', 'Post Method'],
  ['x_username', 'X Username'],
  ['x_email', 'X Email'],
  ['x_password', 'X Password'],
  ['x_totp_secret', '2FA Secret'],
  ['v2_login_enabled', 'V2 Login Fallback'],
])

export function usePostingSettings() {
  const { isAdmin, registerResetCallback, unregisterResetCallback } = useAdminAuth()
  // Direct posting (Cookie method)
  const [cookieString, setCookieString] = useState('')
  const [queryId, setQueryId] = useState('')
  const [bearerToken, setBearerToken] = useState('')

  // API settings
  const [apiKeys, setApiKeys] = useState('')
  const [apiProxy, setApiProxy] = useState('')
  const [postMethodSetting, setPostMethodSetting] = useState<PostMethodSetting>('auto')

  // X Login Credentials (for twitterapi.io user_login_v2)
  const [xUsername, setXUsername] = useState('')
  const [xEmail, setXEmail] = useState('')
  const [xPassword, setXPassword] = useState('')
  const [xTotpSecret, setXTotpSecret] = useState('')

  // V2 Login toggle
  const [v2LoginEnabled, setV2LoginEnabled] = useState(false)

  // Visibility toggles
  const [showCookieValue, setShowCookieValue] = useState(false)
  const [showBearerValue, setShowBearerValue] = useState(false)
  const [showCookieGuide, setShowCookieGuide] = useState(false)
  const [showQueryIdGuide, setShowQueryIdGuide] = useState(false)
  const [showBearerGuide, setShowBearerGuide] = useState(false)

  // Loading states — use a Set to track concurrent saves properly
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set())
  const [isClearingCache, setIsClearingCache] = useState(false)
  const [isSavingAllCredentials, setIsSavingAllCredentials] = useState(false)

  const isSavingAnySetting = savingKeys.size > 0
  // For backward compat: return the last key being saved (or null)
  const isSavingSetting = savingKeys.size > 0 ? [...savingKeys][savingKeys.size - 1] : null

  const { toast } = useToast()

  const saveSetting = useCallback(async (key: string, value: string, onSuccess?: () => void, onFailure?: () => void) => {
    if (!isAdmin) return
    setSavingKeys(prev => new Set(prev).add(key))
    try {
      // Empty value → delete the setting instead (API rejects empty values)
      if (!value.trim()) {
        await apiClient.deleteSetting(key)
        toast({ title: `${SETTING_LABELS.get(key) || key} dihapus!` })
        onSuccess?.()
        return
      }
      const data = await apiClient.saveSetting(key, value)
      // Cookie string gets parsed confirmation toast
      if (key === 'x_cookie_string' && data.parsed) {
        const parsedInfo = `auth_token: ${data.parsed.auth_token}, ct0: ${data.parsed.ct0}, twid: ${data.parsed.twid}`
        toast({ title: 'Cookie disimpan!', description: parsedInfo })
      } else {
        const desc = data.autoLogin?.attempted
          ? data.autoLogin.success
            ? 'Auto-login berhasil — cookie tersimpan.'
            : `Disimpan, tapi auto-login gagal: ${data.autoLogin.error || 'Unknown error'}`
          : undefined
        toast({ title: `${SETTING_LABELS.get(key) || key} disimpan!`, description: desc })
      }
      onSuccess?.()
    } catch (err: unknown) {
      toast({ title: 'Gagal', description: getErrorMessage(err, 'Gagal menyimpan'), variant: 'destructive' })
      onFailure?.()
    } finally {
      setSavingKeys(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }, [isAdmin, toast])

  const saveAllCredentials = useCallback(async () => {
    if (!isAdmin) return
    setIsSavingAllCredentials(true)
    const fields: { key: string; value: string; label: string }[] = [
      { key: 'x_username', value: xUsername, label: 'Username' },
      { key: 'x_email', value: xEmail, label: 'Email' },
      { key: 'x_password', value: xPassword, label: 'Password' },
      { key: 'x_totp_secret', value: xTotpSecret, label: '2FA Secret' },
    ]

    const nonEmptyFields = fields.filter((f) => f.value.trim())
    const results = await Promise.allSettled(
      nonEmptyFields.map(async (field) => {
        await apiClient.saveSetting(field.key, field.value)
        return field.label
      }),
    )

    const savedLabels = results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
      .map((r) => r.value)

    // Deduce which field labels failed by diffing
    const failedLabels = nonEmptyFields
      .filter((f) => !savedLabels.includes(f.label))
      .map((f) => f.label)

    if (failedLabels.length > 0) {
      toast({
        title: 'Sebagian gagal disimpan',
        description: `Gagal: ${failedLabels.join(', ')}. Berhasil: ${savedLabels.length} field.`,
        variant: 'destructive',
      })
    } else {
      // Clear credential fields after successful save
      setXUsername('')
      setXEmail('')
      setXPassword('')
      setXTotpSecret('')
      toast({
        title: 'Semua kredensial disimpan!',
        description: `${savedLabels.length} field berhasil disimpan.`,
      })
    }

    setIsSavingAllCredentials(false)
  }, [xUsername, xEmail, xPassword, xTotpSecret, isAdmin, toast])

  const clearCache = useCallback(async () => {
    setIsClearingCache(true)
    try {
      const data = await apiClient.clearCache()
      if (!data.error) {
        toast({ title: 'Cache dibersihkan!', description: 'Query ID & transaction ID cache telah direset.' })
      } else {
        toast({ title: 'Gagal', description: 'Tidak dapat membersihkan cache', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Tidak dapat terhubung ke server', variant: 'destructive' })
    } finally {
      setIsClearingCache(false)
    }
  }, [toast])

  // Reset state on logout — registered imperatively via auth context (M-2)
  const resetState = useCallback(() => {
    setCookieString('')
    setQueryId('')
    setBearerToken('')
    setApiKeys('')
    setApiProxy('')
    setPostMethodSetting('auto')
    setXUsername('')
    setXEmail('')
    setXPassword('')
    setXTotpSecret('')
    setV2LoginEnabled(false)
  }, [])

  useEffect(() => {
    registerResetCallback(resetState)
    return () => unregisterResetCallback(resetState)
  }, [registerResetCallback, unregisterResetCallback, resetState])

  return {
    // Direct posting
    cookieString,
    setCookieString,
    queryId,
    setQueryId,
    bearerToken,
    setBearerToken,
    // API settings
    apiKeys,
    setApiKeys,
    apiProxy,
    setApiProxy,
    postMethodSetting,
    setPostMethodSetting,
    // X Login Credentials
    xUsername,
    setXUsername,
    xEmail,
    setXEmail,
    xPassword,
    setXPassword,
    xTotpSecret,
    setXTotpSecret,
    // V2 Login toggle
    v2LoginEnabled,
    setV2LoginEnabled,
    // Visibility toggles
    showCookieValue,
    setShowCookieValue,
    showBearerValue,
    setShowBearerValue,
    showCookieGuide,
    setShowCookieGuide,
    showQueryIdGuide,
    setShowQueryIdGuide,
    showBearerGuide,
    setShowBearerGuide,
    // Loading states
    isSavingSetting,
    isSavingAnySetting,
    isClearingCache,
    isSavingAllCredentials,
    // Actions
    saveSetting,
    saveAllCredentials,
    clearCache,
  }
}
