'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useAdminAuth } from '@/contexts/admin-auth-context'
import { useAdminStats } from '@/contexts/admin-stats-context'
import { useSubmissions } from '@/hooks/use-submissions'
import { useSubmitters } from '@/hooks/use-submitters'
import { StatsGrid } from '@/components/dashboard/stats-grid'
import { ConnectionBanner } from '@/components/dashboard/connection-banner'
import { PostMethodRates } from '@/components/dashboard/post-method-rates'
import { SubmissionFilters } from '@/components/dashboard/submission-filters'
import { SubmissionList } from '@/components/dashboard/submission-list'
import { UsersDialog } from '@/components/dashboard/users-dialog'
import { EncryptionBanner } from '@/components/dashboard/encryption-banner'
import { Card, CardContent } from '@/components/ui/card'

const STAT_SKELETON_KEYS = [
  'skel-pending', 'skel-censored', 'skel-posting', 'skel-failed',
  'skel-rejected', 'skel-posted', 'skel-total', 'skel-users',
] as const

export default function AdminDashboardPage() {
  const { isAdmin } = useAdminAuth()
  const [usersDialogOpen, setUsersDialogOpen] = useState(false)

  // Stats from context (AdminStatsProvider handles fetch + 15s auto-refresh)
  const {
    stats,
    cookieStatus,
    postMethodStats,
    apiLoginStatus,
    isStale,
    fetchStats,
    adjustStatsForTransition,
    adjustStatsForDeletion,
  } = useAdminStats()

  // Submissions hook
  const {
    submissions,
    page,
    totalPages,
    filterStatus,
    search,
    isLoading: isLoadingSubmissions,
    actionLoading,
    approve: rawApprove,
    reject: rawReject,
    delete: rawDelete,
    retryPost: rawRetryPost,
    setFilter,
    setSearch,
    fetchSubmissions,
  } = useSubmissions({ isAdmin })

  // Page-level wrappers — optimistically adjust stats on success
  const approve = useCallback(async (id: string) => {
    const sub = submissions.find((s) => s.id === id)
    if (!sub) return
    const finalStatus = await rawApprove(id)
    if (finalStatus !== null) adjustStatsForTransition(sub.status, finalStatus)
  }, [rawApprove, submissions, adjustStatsForTransition])

  const reject = useCallback(async (id: string) => {
    const sub = submissions.find((s) => s.id === id)
    if (!sub) return
    const success = await rawReject(id)
    if (success) adjustStatsForTransition(sub.status, 'rejected')
  }, [rawReject, submissions, adjustStatsForTransition])

  const deleteSubmission = useCallback(async (id: string) => {
    const sub = submissions.find((s) => s.id === id)
    if (!sub) return
    const success = await rawDelete(id)
    if (success) adjustStatsForDeletion(sub.status)
  }, [rawDelete, submissions, adjustStatsForDeletion])

  const retryPost = useCallback(async (id: string) => {
    const sub = submissions.find((s) => s.id === id)
    if (!sub) return
    const finalStatus = await rawRetryPost(id)
    if (finalStatus !== null) adjustStatsForTransition(sub.status, finalStatus)
  }, [rawRetryPost, submissions, adjustStatsForTransition])

  // Submitters hook
  const {
    submitters,
    blockedUsernames,
    isLoading: isLoadingSubmitters,
    fetchSubmitters,
    block,
    unblock,
    setCustomLimits,
    setBlockedUsernames,
  } = useSubmitters()

  // Sync blocked usernames from stats
  useEffect(() => {
    if (stats?.filterSettings?.blockedUsernames) {
      setBlockedUsernames(stats.filterSettings.blockedUsernames)
    }
  }, [stats?.filterSettings?.blockedUsernames, setBlockedUsernames])

  const handleRefresh = useCallback(() => {
    void fetchSubmissions()
    void fetchStats()
  }, [fetchSubmissions, fetchStats])

  const handlePageChange = useCallback(
    (p: number) => {
      void fetchSubmissions(false, p)
    },
    [fetchSubmissions]
  )

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      {/* Stale data warning */}
      {isStale && (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
          Koneksi ke server bermasalah — data mungkin tidak terkini
        </div>
      )}

      {/* Stats Grid */}
      {stats ? (
        <StatsGrid
          stats={stats}
          onPenggunaClick={() => {
            setUsersDialogOpen(true)
            void fetchSubmitters()
          }}
        />
      ) : (
        <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
          {STAT_SKELETON_KEYS.map((key) => (
            <div key={key} className="rounded-xl border border-[#EFF3F4] shadow-sm p-3 animate-pulse">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-5 h-5 rounded-md bg-gray-200" />
                <div className="h-4 bg-gray-200 rounded w-6" />
              </div>
              <div className="h-3 bg-gray-200 rounded w-12" />
            </div>
          ))}
        </div>
      )}

      {/* Encryption Warning Banner */}
      <EncryptionBanner encryptionEnabled={stats?.encryptionEnabled} />

      {/* Users Dialog */}
      <UsersDialog
        open={usersDialogOpen}
        onOpenChange={setUsersDialogOpen}
        submitters={submitters}
        blockedUsernames={blockedUsernames}
        isLoading={isLoadingSubmitters}
        onFetchSubmitters={fetchSubmitters}
        onBlock={block}
        onUnblock={unblock}
        onSetCustomLimits={setCustomLimits}
        globalRateLimits={stats?.filterSettings?.rateLimits ?? null}
      />

      {/* Connection Status Banner */}
      <ConnectionBanner
        cookieStatus={cookieStatus}
        apiLoginStatus={apiLoginStatus}
      />

      {/* Post Method Rate */}
      {postMethodStats === null ? (
        <Card className="py-0 gap-0 shadow-sm border-[#EFF3F4]">
          <CardContent className="p-2.5">
            <div className="animate-pulse flex items-center gap-1.5 mb-2">
              <div className="w-3 h-3 rounded bg-gray-200" />
              <div className="h-3 bg-gray-200 rounded w-24" />
            </div>
            <div className="animate-pulse h-2.5 rounded-full bg-gray-200 w-full mb-2" />
            <div className="animate-pulse h-2.5 bg-gray-200 rounded w-1/2" />
          </CardContent>
        </Card>
      ) : postMethodStats.total > 0 ? (
        <PostMethodRates postMethodStats={postMethodStats} />
      ) : null}

      {/* Filter Bar + Submission List */}
      <div className="space-y-3">
        <SubmissionFilters
          filterStatus={filterStatus}
          setFilter={setFilter}
          search={search}
          setSearch={setSearch}
          onRefresh={handleRefresh}
          isLoading={isLoadingSubmissions}
          stats={stats}
        />

        <SubmissionList
          submissions={submissions}
          search={search}
          setSearch={setSearch}
          filterStatus={filterStatus}
          isLoading={isLoadingSubmissions}
          actionLoading={actionLoading}
          page={page}
          totalPages={totalPages}
          onApprove={approve}
          onReject={reject}
          onRetryPost={retryPost}
          onDelete={deleteSubmission}
          onPageChange={handlePageChange}
        />
      </div>
    </motion.div>
  )
}
