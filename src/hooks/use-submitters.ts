'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { SubmitterWithStats } from '@/types'
import { apiClient, ApiError } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'
import { useAdminAuth } from '@/contexts/admin-auth-context'

const PAGE_SIZE = 50

export function useSubmitters() {
  const { isAdmin } = useAdminAuth()
  const [submitters, setSubmitters] = useState<SubmitterWithStats[]>([])
  const [blockedUsernames, setBlockedUsernames] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [search, setSearch] = useState('')
  const { toast } = useToast()

  // Use refs for page and search to avoid stale closures
  const pageRef = useRef(page)
  pageRef.current = page
  const searchRef = useRef(search)
  searchRef.current = search

  // Request ID counter to discard stale responses
  const requestIdRef = useRef(0)

  const fetchSubmitters = useCallback(async (silent = false, targetPage?: number, targetSearch?: string) => {
    if (!isAdmin) return
    const p = targetPage ?? pageRef.current
    const q = targetSearch ?? searchRef.current
    setIsLoading(true)
    setError(null)

    const thisRequestId = ++requestIdRef.current

    try {
      const data = await apiClient.getSubmitters({
        page: p,
        limit: PAGE_SIZE,
        search: q || undefined,
      })

      // Discard stale response if a newer request was made
      if (thisRequestId !== requestIdRef.current) return

      setSubmitters(data.submitters)
      setTotalCount(data.totalCount)
      setTotalPages(data.totalPages)
      setPage(data.page)
    } catch {
      if (thisRequestId === requestIdRef.current) {
        const msg = 'Gagal memuat data submitter. Coba lagi.'
        setError(msg)
        if (!silent) {
          toast({ title: 'Error', description: msg, variant: 'destructive' })
        }
      }
    } finally {
      if (thisRequestId === requestIdRef.current) {
        setIsLoading(false)
      }
    }
  }, [isAdmin, toast])

  // Debounced search: trigger server-side search after 300ms of inactivity
  useEffect(() => {
    searchRef.current = search
    const timer = setTimeout(() => {
      if (isAdmin) {
        pageRef.current = 1
        void fetchSubmitters(false, 1, search)
      }
    }, 300)
    return () => { clearTimeout(timer) }
  }, [search, isAdmin, fetchSubmitters])

  // Wrapper for setSearch (also resets page)
  const updateSearch = useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  // Page navigation
  const goToPage = useCallback((p: number) => {
    setPage(p)
    pageRef.current = p
    void fetchSubmitters(false, p)
  }, [fetchSubmitters])

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
        void fetchSubmitters(true)
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
        void fetchSubmitters(true)
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
    page,
    totalPages,
    totalCount,
    search,
    fetchSubmitters,
    goToPage,
    setSearch: updateSearch,
    block,
    unblock,
    setCustomLimits,
    setBlockedUsernames: setBlockedUsernamesFromSource,
  }
}
