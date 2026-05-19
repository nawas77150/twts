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
import { ApiCredits } from '@/components/dashboard/api-credits'
import { SubmissionFilters } from '@/components/dashboard/submission-filters'
import { SubmissionList } from '@/components/dashboard/submission-list'
import { UsersDialog } from '@/components/dashboard/users-dialog'
import { EncryptionBanner } from '@/components/dashboard/encryption-banner'

export default function AdminDashboardPage() {
  const { isAdmin, adminToken } = useAdminAuth()
  const [usersDialogOpen, setUsersDialogOpen] = useState(false)

  // Stats from context (AdminStatsProvider handles fetch + 15s auto-refresh)
  const {
    stats,
    cookieStatus,
    postMethodStats,
    apiCredits,
    apiLoginStatus,
    fetchStats,
    refetch: refetchStats,
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
    approve,
    reject,
    delete: deleteSubmission,
    retryPost,
    setFilter,
    setSearch,
    fetchSubmissions,
  } = useSubmissions({
    isAdmin,
    adminToken,
    onStatsRefresh: fetchStats,
  })

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
  } = useSubmitters({ adminToken })

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
      {/* Stats Grid */}
      {stats && (
        <StatsGrid
          stats={stats}
          onPenggunaClick={() => {
            setUsersDialogOpen(true)
            void fetchSubmitters()
          }}
        />
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
      {postMethodStats && postMethodStats.total > 0 && (
        <PostMethodRates postMethodStats={postMethodStats} />
      )}

      {/* API Credits */}
      {apiCredits.length > 0 && (
        <ApiCredits apiCredits={apiCredits} onRefresh={refetchStats} />
      )}

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
