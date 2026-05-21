'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Submission, SubmitterInfo, SubmissionLimitsData } from '@/types'
import { apiClient } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'

interface UseMyPostsParams {
  submitter: SubmitterInfo | null
  isAnonUser: boolean
  initialLimits?: SubmissionLimitsData | null
}

export function useMyPosts({ submitter, isAnonUser, initialLimits }: UseMyPostsParams) {
  const [myPosts, setMyPosts] = useState<Submission[]>([])
  const [limits, setLimits] = useState<SubmissionLimitsData | null>(initialLimits ?? null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  const fetchMyPosts = useCallback(async (silent = false) => {
    if (!submitter) return
    setIsLoading(true)
    setError(null)
    try {
      const data = await apiClient.getMyPosts()
      setMyPosts(data.submissions)
      if (data.limits) {
        setLimits(data.limits)
      }
    } catch {
      const msg = 'Gagal memuat pesan. Coba lagi.'
      setError(msg)
      if (!silent) {
        toast({ title: 'Error', description: msg, variant: 'destructive' })
      }
    } finally {
      setIsLoading(false)
    }
  }, [submitter, toast])

  // Fetch my posts when user logs in
  useEffect(() => {
    if (submitter && !isAnonUser) {
      void fetchMyPosts()
    } else {
      setMyPosts([])
      setLimits(null)
      setError(null)
    }
  }, [submitter, isAnonUser, fetchMyPosts])

  const hasNonTerminalPosts = myPosts.some(
    (p) => p.status === 'pending' || p.status === 'censored' || p.status === 'posting'
  )

  useEffect(() => {
    if (!submitter || isAnonUser || !hasNonTerminalPosts) return
    const interval = setInterval(() => {
      if (!document.hidden) {
        void fetchMyPosts(true)
      }
    }, 30000)
    return () => { clearInterval(interval) }
  }, [submitter, isAnonUser, hasNonTerminalPosts, fetchMyPosts])

  const refetch = useCallback(async () => {
    return fetchMyPosts()
  }, [fetchMyPosts])

  return {
    myPosts,
    limits,
    isLoading,
    error,
    fetchMyPosts,
    refetch,
  }
}
