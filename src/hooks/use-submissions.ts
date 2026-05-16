'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Submission, SubmissionStatus } from '@/types'
import { apiClient } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'

interface UseSubmissionsParams {
  isAdmin: boolean
  adminToken: string
  onStatsRefresh?: () => void
}

export function useSubmissions({ isAdmin, adminToken, onStatsRefresh }: UseSubmissionsParams) {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('pending')
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const { toast } = useToast()

  // Use refs for page and search to avoid infinite loop from useCallback + useEffect dep chain
  const pageRef = useRef(page)
  pageRef.current = page
  const searchRef = useRef(search)
  searchRef.current = search

  // Request ID counter to discard stale responses when filter changes
  const requestIdRef = useRef(0)

  // Track whether any non-silent (loading-spinner) request is outstanding.
  // This prevents the spinner getting stuck when a silent auto-refresh
  // supersedes a non-silent fetch — the silent fetch won't clear isLoading
  // (it didn't set it), but we need the latest request to clear it.
  const outstandingLoadingRef = useRef(false)

  const fetchSubmissions = useCallback(async (silent = false, targetPage?: number) => {
    if (!adminToken) return
    const p = targetPage ?? pageRef.current
    const q = searchRef.current
    if (!silent) {
      setIsLoading(true)
      outstandingLoadingRef.current = true
    }

    // Capture current request ID — only apply results if still the latest
    const thisRequestId = ++requestIdRef.current

    try {
      const data = await apiClient.getSubmissions({
        status: (filterStatus === 'all' ? 'all' : filterStatus) as SubmissionStatus | 'all',
        page: p,
        limit: 50,
        search: q || undefined,
      })

      // Discard stale response if a newer request was made
      if (thisRequestId !== requestIdRef.current) return

      setSubmissions(data.submissions)
      setHasMore(data.pagination.hasMore)
      setTotal(data.pagination.total)
      setTotalPages(data.pagination.totalPages)
      setPage(p)
    } catch {
      if (thisRequestId === requestIdRef.current) {
        toast({ title: 'Error', description: 'Gagal memuat data', variant: 'destructive' })
      }
    } finally {
      // Only the latest request should update isLoading.
      // A non-silent request sets outstandingLoadingRef, and the
      // latest request (even if it was silent) is responsible for
      // clearing the spinner if one was requested.
      if (thisRequestId === requestIdRef.current && outstandingLoadingRef.current) {
        setIsLoading(false)
        outstandingLoadingRef.current = false
      }
    }
  }, [adminToken, filterStatus, toast])

  // Auto-refresh every 15s when admin is active
  useEffect(() => {
    if (isAdmin) {
      void fetchSubmissions() // initial load — shows spinner
      const interval = setInterval(() => { void fetchSubmissions(true) }, 15000)
      return () => clearInterval(interval)
    }
  }, [isAdmin, filterStatus, fetchSubmissions])

  // Debounced search: trigger server-side search after 300ms of inactivity
  useEffect(() => {
    const timer = setTimeout(() => {
      if (isAdmin && adminToken) {
        pageRef.current = 1
        void fetchSubmissions()
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [search, isAdmin, adminToken, fetchSubmissions])

  // Reset page when filter changes
  const setFilter = (status: string) => {
    setFilterStatus(status)
    setPage(1)
  }

  // Wrapper for setSearch (also resets page)
  const updateSearch = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const approve = useCallback(async (id: string) => {
    setActionLoading(id)
    try {
      const data = await apiClient.approveSubmission(id)
      if (data.autoPosted) {
        let desc = 'Pesan otomatis diposting ke X.'
        if (data.postMethod === 'retry') desc = data.description || 'Pesan diposting setelah retry.'
        else if (data.postMethod === 'fallback') desc = data.description || 'Pesan diposting via fallback API.'
        toast({ title: 'Disetujui & diposting!', description: desc })
      } else if (data.warning) {
        toast({ title: 'Disetujui', description: data.warning })
      } else if (data.error) {
        toast({ title: 'Disetujui, tapi gagal posting', description: data.error, variant: 'destructive' })
      } else {
        toast({ title: 'Disetujui', description: 'Pesan telah disetujui.' })
      }
      fetchSubmissions()
      onStatsRefresh?.()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Gagal menyetujui'
      toast({ title: 'Gagal', description: message, variant: 'destructive' })
    } finally {
      setActionLoading(null)
    }
  }, [fetchSubmissions, onStatsRefresh, toast])

  const reject = useCallback(async (id: string) => {
    setActionLoading(id)
    try {
      await apiClient.rejectSubmission(id)
      toast({ title: 'Ditolak', description: 'Pesan telah ditolak.' })
      fetchSubmissions()
      onStatsRefresh?.()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Gagal menolak'
      toast({ title: 'Gagal', description: message, variant: 'destructive' })
    } finally {
      setActionLoading(null)
    }
  }, [fetchSubmissions, onStatsRefresh, toast])

  const deleteSubmission = useCallback(async (id: string) => {
    setActionLoading(id)
    try {
      await apiClient.deleteSubmission(id)
      toast({ title: 'Dihapus' })
      fetchSubmissions()
      onStatsRefresh?.()
    } catch {
      toast({ title: 'Error', description: 'Gagal menghapus', variant: 'destructive' })
    } finally {
      setActionLoading(null)
    }
  }, [fetchSubmissions, onStatsRefresh, toast])

  const retryPost = useCallback(async (id: string) => {
    setActionLoading(id)
    try {
      const data = await apiClient.retryPost(id)
      toast({ title: 'Berhasil diposting ke X!', description: data.tweetId ? `Tweet ID: ${data.tweetId}` : undefined })
      fetchSubmissions()
      onStatsRefresh?.()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Gagal posting ke X'
      toast({ title: 'Gagal posting', description: message, variant: 'destructive' })
    } finally {
      setActionLoading(null)
    }
  }, [fetchSubmissions, onStatsRefresh, toast])

  const loadMore = useCallback(() => {
    if (hasMore && page < totalPages) {
      void fetchSubmissions(false, page + 1)
    }
  }, [hasMore, page, totalPages, fetchSubmissions])

  return {
    submissions,
    page,
    totalPages,
    total,
    hasMore,
    filterStatus,
    search,
    isLoading,
    actionLoading,
    approve,
    reject,
    delete: deleteSubmission,
    retryPost,
    loadMore,
    setFilter,
    setSearch: updateSearch,
    fetchSubmissions,
  }
}
