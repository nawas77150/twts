'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Submission, SubmissionStatus, PostMethodResult } from '@/types'
import { apiClient } from '@/lib/api-client'
import { getErrorMessage } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

interface UseSubmissionsParams {
  isAdmin: boolean
}

/** Revert strategy: how to restore submissions after a failed optimistic update. */
type RevertFn = (prev: Submission[], originalSub: Submission) => Submission[]

/** Default revert: replace the item with its original state (used by approve, reject, retryPost). */
const defaultRevert: RevertFn = (prev, originalSub) =>
  prev.map((s) => s.id === originalSub.id ? { ...originalSub } : s)

export function useSubmissions({ isAdmin }: UseSubmissionsParams) {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
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

  // Mirror actionLoading state as a ref so fetchSubmissions can read it
  // without adding it to its dependency array (which would restart the 15s interval).
  // Used to skip silent auto-refresh while an optimistic action is in-flight,
  // preventing the server's stale state from overwriting the optimistic update.
  const actionLoadingRef = useRef<string | null>(null)

  const fetchSubmissions = useCallback(async (silent = false, targetPage?: number) => {
    if (!isAdmin) return
    // Skip silent auto-refresh while an optimistic action is in-flight
    // to prevent stale server data from overwriting the optimistic update.
    if (silent && actionLoadingRef.current) return
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

  // ── Optimistic action helper ──────────────────────────────────────
  // Eliminates duplication across approve/reject/delete/retryPost:
  //   1. setActionLoading(id)
  //   2. capture original submission for revert
  //   3. apply optimistic update
  //   4. catch → revert + error toast
  //   5. finally → clear loading state
  //
  // Returns { result, originalSub } on success, null on catch (after revert + toast).
  // The caller handles the success path, which varies per action.
  async function withOptimisticAction<R>(
    id: string,
    optimisticUpdate: (prev: Submission[]) => Submission[],
    action: () => Promise<R>,
    errorConfig: { title: string; fallback: string },
    revertFn: RevertFn = defaultRevert,
  ): Promise<{ result: R; originalSub: Submission | undefined } | null> {
    const originalSub = submissions.find((s) => s.id === id)
    actionLoadingRef.current = id
    setActionLoading(id)
    setSubmissions(optimisticUpdate)

    try {
      const result = await action()
      return { result, originalSub }
    } catch (err: unknown) {
      if (originalSub) {
        setSubmissions((prev) => revertFn(prev, originalSub))
      }
      toast({ title: errorConfig.title, description: getErrorMessage(err, errorConfig.fallback), variant: 'destructive' })
      return null
    } finally {
      actionLoadingRef.current = null
      setActionLoading(null)
    }
  }

  const approve = useCallback(async (id: string): Promise<SubmissionStatus | null> => {
    const res = await withOptimisticAction(
      id,
      (prev) => prev.map((s) => s.id === id ? { ...s, status: 'posting' as SubmissionStatus } : s),
      () => apiClient.approveSubmission(id),
      { title: 'Gagal', fallback: 'Gagal menyetujui' },
    )
    if (!res) return null

    const { result: data } = res
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
  }, [submissions, toast])

  const reject = useCallback(async (id: string): Promise<boolean> => {
    const res = await withOptimisticAction(
      id,
      (prev) => prev.map((s) => s.id === id ? { ...s, status: 'rejected' as SubmissionStatus } : s),
      () => apiClient.rejectSubmission(id),
      { title: 'Gagal', fallback: 'Gagal menolak' },
    )
    if (!res) return false
    toast({ title: 'Ditolak', description: 'Pesan telah ditolak.' })
    return true
  }, [submissions, toast])

  const deleteSubmission = useCallback(async (id: string): Promise<boolean> => {
    const res = await withOptimisticAction(
      id,
      (prev) => prev.filter((s) => s.id !== id),
      () => apiClient.deleteSubmission(id),
      { title: 'Error', fallback: 'Gagal menghapus' },
      // Delete reverts by re-appending (not replacing)
      (prev, originalSub) => [...prev, originalSub],
    )
    if (!res) return false
    toast({ title: 'Dihapus' })
    return true
  }, [submissions, toast])

  const retryPost = useCallback(async (id: string): Promise<SubmissionStatus | null> => {
    const res = await withOptimisticAction(
      id,
      (prev) => prev.map((s) => s.id === id ? { ...s, status: 'posting' as SubmissionStatus, postError: null } : s),
      () => apiClient.retryPost(id),
      { title: 'Gagal posting', fallback: 'Gagal posting ke X' },
    )
    if (!res) return null

    const { result: data, originalSub } = res
    if (data.error) {
      // Revert — posting failed (logical error from API, not a network error)
      if (originalSub) {
        setSubmissions((prev) => defaultRevert(prev, originalSub))
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
