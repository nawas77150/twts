'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Submission, SubmissionStatus, PostMethodResult } from '@/types'
import { apiClient } from '@/lib/api-client'
import { getErrorMessage } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

interface UseSubmissionsParams {
  isAdmin: boolean
}

export function useSubmissions({ isAdmin }: UseSubmissionsParams) {
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

  const approve = useCallback(async (id: string): Promise<SubmissionStatus | null> => {
    setActionLoading(id)
    // Capture only this submission's original state for targeted revert
    const originalSub = submissions.find((s) => s.id === id)

    // Optimistic: set to 'posting'
    setSubmissions((prev) =>
      prev.map((s) => s.id === id ? { ...s, status: 'posting' as SubmissionStatus } : s)
    )
    try {
      const data = await apiClient.approveSubmission(id)
      if (data.autoPosted) {
        let desc = 'Pesan otomatis diposting ke X.'
        if (data.postMethod === 'retry') desc = data.description || 'Pesan diposting setelah retry.'
        else if (data.postMethod === 'fallback' || data.postMethod === 'fallback_cookie') desc = data.description || 'Pesan diposting via Cookie API (twitterapi.io).'
        else if (data.postMethod === 'fallback_login') desc = data.description || 'Pesan diposting via V2 Login API (twitterapi.io).'
        // Refine to 'posted'
        setSubmissions((prev) =>
          prev.map((s) => s.id === id
            ? { ...s, status: 'posted' as SubmissionStatus, postMethod: (data.postMethod as PostMethodResult) ?? null }
            : s)
        )
        toast({ title: 'Disetujui & diposting!', description: desc })
        return 'posted'
      } else if (data.warning) {
        toast({ title: 'Disetujui', description: data.warning })
        return 'posting'
      } else if (data.error) {
        // Server accepted approval but posting failed — keep 'posting', poll corrects to 'post_failed'
        toast({ title: 'Disetujui, tapi gagal posting', description: data.error, variant: 'destructive' })
        return 'posting'
      } else {
        toast({ title: 'Disetujui', description: 'Pesan telah disetujui.' })
        return 'posting'
      }
    } catch (err: unknown) {
      // Revert only this card
      if (originalSub) {
        setSubmissions((prev) =>
          prev.map((s) => s.id === id ? { ...originalSub } : s)
        )
      }
      toast({ title: 'Gagal', description: getErrorMessage(err, 'Gagal menyetujui'), variant: 'destructive' })
      return null
    } finally {
      setActionLoading(null)
    }
  }, [submissions, toast])

  const reject = useCallback(async (id: string): Promise<boolean> => {
    setActionLoading(id)
    const originalSub = submissions.find((s) => s.id === id)

    // Optimistic: set to 'rejected'
    setSubmissions((prev) =>
      prev.map((s) => s.id === id ? { ...s, status: 'rejected' as SubmissionStatus } : s)
    )
    try {
      await apiClient.rejectSubmission(id)
      toast({ title: 'Ditolak', description: 'Pesan telah ditolak.' })
      return true
    } catch (err: unknown) {
      // Revert only this card
      if (originalSub) {
        setSubmissions((prev) => prev.map((s) => s.id === id ? { ...originalSub } : s))
      }
      toast({ title: 'Gagal', description: getErrorMessage(err, 'Gagal menolak'), variant: 'destructive' })
      return false
    } finally {
      setActionLoading(null)
    }
  }, [submissions, toast])

  const deleteSubmission = useCallback(async (id: string): Promise<boolean> => {
    setActionLoading(id)
    const originalSub = submissions.find((s) => s.id === id)

    // Optimistic: remove immediately
    setSubmissions((prev) => prev.filter((s) => s.id !== id))
    try {
      await apiClient.deleteSubmission(id)
      toast({ title: 'Dihapus' })
      return true
    } catch {
      // Re-append at end; 15s poll restores correct order
      if (originalSub) {
        setSubmissions((prev) => [...prev, originalSub])
      }
      toast({ title: 'Error', description: 'Gagal menghapus', variant: 'destructive' })
      return false
    } finally {
      setActionLoading(null)
    }
  }, [submissions, toast])

  const retryPost = useCallback(async (id: string): Promise<SubmissionStatus | null> => {
    setActionLoading(id)
    const originalSub = submissions.find((s) => s.id === id)

    // Optimistic: set to 'posting'
    setSubmissions((prev) =>
      prev.map((s) => s.id === id ? { ...s, status: 'posting' as SubmissionStatus, postError: null } : s)
    )
    try {
      const data = await apiClient.retryPost(id)
      if (data.error) {
        // Revert — posting failed
        if (originalSub) {
          setSubmissions((prev) => prev.map((s) => s.id === id ? { ...originalSub } : s))
        }
        toast({ title: 'Gagal posting', description: data.error, variant: 'destructive' })
        return null
      }
      // Refine to 'posted'
      setSubmissions((prev) =>
        prev.map((s) => s.id === id
          ? { ...s, status: 'posted' as SubmissionStatus, tweetId: data.tweetId ?? null }
          : s)
      )
      toast({ title: 'Berhasil diposting ke X!', description: data.tweetId ? `Tweet ID: ${data.tweetId}` : undefined })
      return 'posted'
    } catch (err: unknown) {
      // Revert only this card
      if (originalSub) {
        setSubmissions((prev) => prev.map((s) => s.id === id ? { ...originalSub } : s))
      }
      toast({ title: 'Gagal posting', description: getErrorMessage(err, 'Gagal posting ke X'), variant: 'destructive' })
      return null
    } finally {
      setActionLoading(null)
    }
  }, [submissions, toast])

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
