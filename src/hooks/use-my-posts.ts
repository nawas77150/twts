'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Submission, SubmitterInfo, SubmissionLimitsData } from '@/types'
import { apiClient } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'

interface UseMyPostsParams {
  submitter: SubmitterInfo | null
  isAnonUser: boolean
}

export function useMyPosts({ submitter, isAnonUser }: UseMyPostsParams) {
  const [myPosts, setMyPosts] = useState<Submission[]>([])
  const [limits, setLimits] = useState<SubmissionLimitsData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  const fetchMyPosts = useCallback(async () => {
    if (!submitter) return
    setIsLoading(true)
    setError(null)
    try {
      const data = await apiClient.getMyPosts()
      setMyPosts(data.submissions)
      // Also capture limits data if present (now properly typed)
      if (data.limits) {
        setLimits(data.limits)
      }
    } catch {
      const msg = 'Gagal memuat pesan. Coba lagi.'
      setError(msg)
      toast({ title: 'Error', description: msg, variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }, [submitter, toast])

  // Fetch my posts when user logs in
  useEffect(() => {
    if (submitter && !isAnonUser) {
      fetchMyPosts()
    } else {
      setMyPosts([])
      setLimits(null)
      setError(null)
    }
  }, [submitter, isAnonUser, fetchMyPosts])

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
