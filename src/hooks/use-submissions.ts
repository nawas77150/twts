'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Submission, SubmissionStatus } from '@/types'
import { apiClient } from '@/lib/api-client'
import { getErrorMessage } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

interface UseSubmissionsParams {
  isAdmin: boolean
}

/** Map postMethod → default description when API doesn't provide one. */
const POST_METHOD_DESCRIPTIONS: Record<string, string> = {
  retry: 'Pesan diposting setelah retry.',
  fallback: 'Pesan diposting via Cookie API (twitterapi.io).',
  fallback_cookie: 'Pesan diposting via Cookie API (twitterapi.io).',
  fallback_login: 'Pesan diposting via V2 Login API (twitterapi.io).',
}

export function useSubmissions({ isAdmin }: UseSubmissionsParams) {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string>('pending')
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set())
  const { toast } = useToast()

  // Use refs for page, search, and filterStatus to avoid infinite loop from useCallback + useEffect dep chain
  const pageRef = useRef(page)
  pageRef.current = page
  const searchRef = useRef(search)
  searchRef.current = search
  const filterStatusRef = useRef(filterStatus)
  filterStatusRef.current = filterStatus

  // Request ID counter to discard stale responses when filter changes
  const requestIdRef = useRef(0)

  // Track whether any non-silent (loading-spinner) request is outstanding.
  // This prevents the spinner getting stuck when a silent auto-refresh
  // supersedes a non-silent fetch — the silent fetch won't clear isLoading
  // (it didn't set it), but we need the latest request to clear it.
  const outstandingLoadingRef = useRef(false)

  const fetchSubmissions = useCallback(async (silent = false, targetPage?: number) => {
    if (!isAdmin) return
    const p = targetPage ?? pageRef.current
    const q = searchRef.current
    // Read filterStatus from ref (not closure) so the callback identity stays stable
    // when filterStatus changes — this prevents the double-fetch on filter change.
    const currentFilter = filterStatusRef.current
    if (!silent) {
      setIsLoading(true)
      outstandingLoadingRef.current = true
    }

    // Capture current request ID — only apply results if still the latest
    const thisRequestId = ++requestIdRef.current

    try {
      const data = await apiClient.getSubmissions({
        status: (currentFilter === 'all' ? 'all' : currentFilter) as SubmissionStatus | 'all',
        page: p,
        limit: 50,
        search: q || undefined,
      })

      // Discard stale response if a newer request was made
      if (thisRequestId !== requestIdRef.current) return

      setSubmissions(data.submissions)
      setHasMore(data.pagination.hasMore)
      setTotalPages(data.pagination.totalPages)
      setPage(p)
    } catch {
      if (thisRequestId === requestIdRef.current) {
        toast({ title: 'Error', description: 'Gagal memuat data', variant: 'destructive' })
      }
    } finally {
      // Only the latest request should update isLoading.
      if (thisRequestId === requestIdRef.current && outstandingLoadingRef.current) {
        setIsLoading(false)
        outstandingLoadingRef.current = false
      }
    }
  }, [isAdmin, toast])

  // Auto-refresh every 15s when admin is active
  // Pause when tab is hidden to avoid wasting serverless invocations
  useEffect(() => {
    if (isAdmin) {
      void fetchSubmissions() // initial load — shows spinner
      const interval = setInterval(() => {
        if (!document.hidden) {
          void fetchSubmissions(true)
        }
      }, 15000)
      return () => { clearInterval(interval) }
    }
    return undefined
  }, [isAdmin, fetchSubmissions])

  // Debounced search: trigger server-side search after 300ms of inactivity
  useEffect(() => {
    // `search` is in deps to trigger this effect; its value is read via searchRef
    // inside fetchSubmissions. Sync ref explicitly so SAST sees the dependency used.
    searchRef.current = search
    const timer = setTimeout(() => {
      if (isAdmin) {
        pageRef.current = 1
        void fetchSubmissions()
      }
    }, 300)
    return () => { clearTimeout(timer) }
  }, [search, isAdmin, fetchSubmissions])

  // Reset page when filter changes — also trigger fetch directly so the
  // auto-refresh effect doesn't fire a redundant second fetch.
  const setFilter = useCallback((status: string) => {
    setFilterStatus(status)
    setPage(1)
    // Sync the ref immediately so the fetch sees the new value
    filterStatusRef.current = status
    pageRef.current = 1
    void fetchSubmissions(false, 1)
  }, [fetchSubmissions])

  // Wrapper for setSearch (also resets page)
  const updateSearch = useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  // ── Actions: spinner + toast + refetch ──────────────────────────────

  /** Wrap an async action with loading spinner + error toast + cleanup */
  const withActionLoading = useCallback(
    <T,>(id: string, fn: () => Promise<T>, errorTitle: string, errorFallback: string): Promise<T | null> => {
      setActionLoading(prev => new Set(prev).add(id))
      return fn()
        .catch((err: unknown) => {
          toast({ title: errorTitle, description: getErrorMessage(err, errorFallback), variant: 'destructive' })
          return null
        })
        .finally(() => {
          setActionLoading(prev => { const next = new Set(prev); next.delete(id); return next })
        })
    },
    [toast],
  )

  const approve = useCallback(async (id: string): Promise<SubmissionStatus | null> => {
    return withActionLoading(id, async () => {
      const data = await apiClient.approveSubmission(id)
      if (data.autoPosted) {
        const desc = data.description || (data.postMethod ? POST_METHOD_DESCRIPTIONS[data.postMethod] : '') || 'Pesan otomatis diposting ke X.'
        toast({ title: 'Disetujui & diposting!', description: desc })
        void fetchSubmissions(true)
        return 'posted'
      }
      if (data.warning) {
        toast({ title: 'Disetujui', description: data.warning })
        void fetchSubmissions(true)
        return 'posting'
      }
      if (data.error) {
        toast({ title: 'Disetujui, tapi gagal posting', description: data.error, variant: 'destructive' })
        void fetchSubmissions(true)
        return 'posting'
      }
      toast({ title: 'Disetujui', description: 'Pesan telah disetujui.' })
      void fetchSubmissions(true)
      return 'posting'
    }, 'Gagal', 'Gagal menyetujui')
  }, [fetchSubmissions, toast, withActionLoading])

  const reject = useCallback(async (id: string): Promise<boolean> => {
    const result = await withActionLoading(id, async () => {
      await apiClient.rejectSubmission(id)
      toast({ title: 'Ditolak', description: 'Pesan telah ditolak.' })
      void fetchSubmissions(true)
      return true
    }, 'Gagal', 'Gagal menolak')
    return result ?? false
  }, [fetchSubmissions, toast, withActionLoading])

  const deleteSubmission = useCallback(async (id: string): Promise<boolean> => {
    const result = await withActionLoading(id, async () => {
      await apiClient.deleteSubmission(id)
      toast({ title: 'Dihapus' })
      void fetchSubmissions(true)
      return true
    }, 'Error', 'Gagal menghapus')
    return result ?? false
  }, [fetchSubmissions, toast, withActionLoading])

  const retryPost = useCallback(async (id: string): Promise<SubmissionStatus | null> => {
    return withActionLoading(id, async () => {
      const data = await apiClient.retryPost(id)
      if (data.error) {
        toast({ title: 'Gagal posting', description: data.error, variant: 'destructive' })
        void fetchSubmissions(true)
        return null
      }
      toast({ title: 'Berhasil diposting ke X!', description: data.tweetId ? `Tweet ID: ${data.tweetId}` : undefined })
      void fetchSubmissions(true)
      return 'posted'
    }, 'Gagal posting', 'Gagal posting ke X')
  }, [fetchSubmissions, toast, withActionLoading])

  return {
    submissions,
    page,
    totalPages,
    hasMore,
    filterStatus,
    search,
    isLoading,
    actionLoading,
    approve,
    reject,
    delete: deleteSubmission,
    retryPost,
    setFilter,
    setSearch: updateSearch,
    fetchSubmissions,
  }
}
