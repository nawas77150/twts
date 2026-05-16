'use client'

import { useState, useCallback } from 'react'
import type { SubmitterWithStats } from '@/types'
import { apiClient, ApiError } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'

interface UseSubmittersParams {
  adminToken: string
}

export function useSubmitters({ adminToken }: UseSubmittersParams) {
  const [submitters, setSubmitters] = useState<SubmitterWithStats[]>([])
  const [blockedUsernames, setBlockedUsernames] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [search, setSearch] = useState('')
  const { toast } = useToast()

  const fetchSubmitters = useCallback(async () => {
    if (!adminToken) return
    setIsLoading(true)
    try {
      const data = await apiClient.getSubmitters()
      setSubmitters(data.submitters)
    } catch {
      /* ignore */
    } finally {
      setIsLoading(false)
    }
  }, [adminToken])

  const block = useCallback(async (username: string) => {
    if (!adminToken) return
    try {
      const data = await apiClient.blockUser(username)
      if (!data.error) {
        setBlockedUsernames((prev) => [...prev, username.toLowerCase()])
        toast({ title: `@${username} diblokir` })
        void fetchSubmitters()
      } else {
        toast({ title: 'Gagal', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Gagal', description: 'Tidak dapat terhubung ke server', variant: 'destructive' })
    }
  }, [adminToken, fetchSubmitters, toast])

  const unblock = useCallback(async (username: string) => {
    if (!adminToken) return
    try {
      const data = await apiClient.unblockUser(username)
      if (!data.error) {
        setBlockedUsernames((prev) => prev.filter((u) => u !== username.toLowerCase()))
        toast({ title: `@${username} dibebaskan` })
        void fetchSubmitters()
      } else {
        toast({ title: 'Gagal', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Gagal', description: 'Tidak dapat terhubung ke server', variant: 'destructive' })
    }
  }, [adminToken, fetchSubmitters, toast])

  const setCustomLimits = useCallback(async (username: string, customLimits: Record<string, number | null> | null): Promise<boolean> => {
    if (!adminToken) return false
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
  }, [adminToken, fetchSubmitters, toast])

  // Set blocked usernames from external source (e.g. stats response)
  const setBlockedUsernamesFromSource = useCallback((usernames: string[]) => {
    setBlockedUsernames(usernames)
  }, [])

  return {
    submitters,
    blockedUsernames,
    isLoading,
    search,
    fetchSubmitters,
    block,
    unblock,
    setCustomLimits,
    setSearch,
    setBlockedUsernames: setBlockedUsernamesFromSource,
  }
}
