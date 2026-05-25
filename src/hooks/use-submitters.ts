'use client'

import { useState, useCallback, useEffect } from 'react'
import type { SubmitterWithStats } from '@/types'
import { apiClient, ApiError } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'
import { useAdminAuth } from '@/contexts/admin-auth-context'

export function useSubmitters() {
  const { isAdmin } = useAdminAuth()
  const [submitters, setSubmitters] = useState<SubmitterWithStats[]>([])
  const [blockedUsernames, setBlockedUsernames] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  const fetchSubmitters = useCallback(async (silent = false) => {
    if (!isAdmin) return
    setIsLoading(true)
    setError(null)
    try {
      const data = await apiClient.getSubmitters()
      setSubmitters(data.submitters)
    } catch {
      const msg = 'Gagal memuat data submitter. Coba lagi.'
      setError(msg)
      if (!silent) {
        toast({ title: 'Error', description: msg, variant: 'destructive' })
      }
    } finally {
      setIsLoading(false)
    }
  }, [isAdmin, toast])

  // Shared helper for block/unblock — eliminates duplication
  const toggleBlock = useCallback(async (
    username: string,
    action: 'block' | 'unblock',
    reason?: string,
  ) => {
    if (!isAdmin) return
    const apiCall = action === 'block'
      ? apiClient.blockUser(username, reason)
      : apiClient.unblockUser(username)
    try {
      const data = await apiCall
      if (!data.error) {
        setBlockedUsernames((prev) =>
          action === 'block'
            ? [...prev, username.toLowerCase()]
            : prev.filter((u) => u !== username.toLowerCase())
        )
        toast({ title: `@${username} ${action === 'block' ? 'diblokir' : 'dibebaskan'}` })
        void fetchSubmitters()
      } else {
        toast({ title: 'Gagal', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Gagal', description: 'Tidak dapat terhubung ke server', variant: 'destructive' })
    }
  }, [isAdmin, fetchSubmitters, toast])

  const block = useCallback((username: string, reason?: string) => toggleBlock(username, 'block', reason), [toggleBlock])
  const unblock = useCallback((username: string) => toggleBlock(username, 'unblock'), [toggleBlock])

  const setCustomLimits = useCallback(async (username: string, customLimits: Record<string, number | null> | null): Promise<boolean> => {
    if (!isAdmin) return false
    try {
      const data = await apiClient.setCustomLimits(username, customLimits)
      if (data.success) {
        toast({ title: `Limit @${username} diperbarui` })
        void fetchSubmitters()
        return true
      } else {
        toast({ title: 'Gagal', description: data.error || 'Gagal mengatur limit', variant: 'destructive' })
        return false
      }
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : 'Tidak dapat terhubung ke server'
      toast({ title: 'Gagal', description: message, variant: 'destructive' })
      return false
    }
  }, [isAdmin, fetchSubmitters, toast])

  // Set blocked usernames from external source (e.g. stats response)
  const setBlockedUsernamesFromSource = useCallback((usernames: string[]) => {
    setBlockedUsernames(usernames)
  }, [])

  // Clear error state on logout
  useEffect(() => {
    if (!isAdmin) {
      setError(null)
    }
  }, [isAdmin])

  return {
    submitters,
    blockedUsernames,
    isLoading,
    error,
    fetchSubmitters,
    block,
    unblock,
    setCustomLimits,
    setBlockedUsernames: setBlockedUsernamesFromSource,
  }
}
