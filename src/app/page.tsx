'use client'

import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useToast } from '@/hooks/use-toast'
import { useSubmitterAuth } from '@/hooks/use-submitter-auth'
import { useMyPosts } from '@/hooks/use-my-posts'
import { apiClient } from '@/lib/api-client'
import { PublicHeader } from '@/components/layout/public-header'
import { Footer } from '@/components/layout/footer'
import { AuthGate } from '@/components/submit/auth-gate'
import { ConfessionForm } from '@/components/submit/confession-form'
import { MyPosts } from '@/components/submit/my-posts'
import { TrustBadges } from '@/components/submit/trust-badges'

export default function HomePage() {
  const { submitter, isChecking, authError, isBlocked, setBlocked, logout, checkAuth } = useSubmitterAuth()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { toast } = useToast()

  const isAnonUser = submitter?.username?.startsWith('anon_') ?? false
  const { myPosts, limits, isLoading: myPostsLoading, error: myPostsError, refetch: refetchMyPosts } = useMyPosts({
    submitter,
    isAnonUser,
  })

  const handleLogin = useCallback(() => { window.location.assign('/api/auth/twitter') }, [])
  const handleLogout = useCallback(() => { logout(); toast({ title: 'Logout berhasil', description: 'Sampai jumpa!' }) }, [logout, toast])

  const handleSubmit = useCallback(async (message: string, category: string): Promise<boolean> => {
    if (!message.trim()) { toast({ title: 'Error', description: 'Pesan tidak boleh kosong', variant: 'destructive' }); return false }
    if (message.trim().length > 280) { toast({ title: 'Error', description: 'Pesan maksimal 280 karakter', variant: 'destructive' }); return false }

    setIsSubmitting(true)
    try {
      const data = await apiClient.submitMessage({ message, category: category || undefined })
      if (data.autoPosted) {
        toast({ title: 'Terkirim & diposting!', description: 'Pesanmu langsung diposting ke X.' })
      } else if (data.postCapped) {
        toast({ title: 'Batas post harian tercapai', description: data.error })
      } else if (data.postFailed) {
        toast({ title: 'Gagal auto-post', description: data.error || 'Gagal auto-post. Pesanmu masuk antrean untuk review admin.' })
      } else if (data.queued) {
        toast({ title: 'Masuk antrean', description: data.error || 'Pesanmu sudah masuk antrean dan akan diposting oleh admin setelahnya.' })
      } else if (data.censored) {
        const censoredMessages: Record<string, string> = {
          ai: 'Pesanmu ditandai mengandung kata yang dilarang oleh AI.',
          filter: 'Pesanmu ditandai mengandung kata yang dilarang oleh pengaturan filter.',
          both: 'Pesanmu ditandai mengandung kata yang dilarang oleh pengaturan filter & AI.',
        }
        toast({ title: 'Disensor', description: censoredMessages[data.censoredReason ?? 'filter'] || censoredMessages.filter })
      } else {
        toast({ title: 'Berhasil dikirim!', description: 'Pesanmu sedang menunggu moderasi admin.' })
      }
      refetchMyPosts()
      return true
    } catch (err: unknown) {
      const status = (err as { status?: number }).status
      if (status === 403) setBlocked(true)
      if (status === 409) {
        // Status changed by another process — tell user to check their submission list
        toast({ title: 'Status berubah', description: (err as { message?: string }).message || 'Status pesan berubah sebelum diproses. Cek riwayat submission-mu.', variant: 'destructive' })
      } else {
        const errMsg = (err as { message?: string }).message || 'Gagal mengirim pesan'
        toast({ title: 'Gagal', description: errMsg, variant: 'destructive' })
      }
      return false
    } finally {
      setIsSubmitting(false)
    }
  }, [toast, setBlocked, refetchMyPosts])

  const showMyPosts = !!submitter && !isAnonUser

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F9F9]">
      <PublicHeader
        submitter={submitter}
        isChecking={isChecking}
        isAnonUser={isAnonUser}
        onLogin={handleLogin}
        onLogout={handleLogout}
      />

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-[#0F1419] mb-2">Kirim Pesan Anonim</h2>
            <p className="text-[#536471]">Tulis pesanmu, admin akan memeriksa dan mempostingnya ke X.</p>
          </div>

          <AuthGate
            submitter={submitter}
            isChecking={isChecking}
            authError={authError}
            isBlocked={isBlocked}
            isAnonUser={isAnonUser}
            onLogin={handleLogin}
            onLogout={handleLogout}
            onRetry={checkAuth}
          >
            <ConfessionForm
              submitterUsername={submitter?.username || 'user'}
              submitterImage={submitter?.profileImage || null}
              onSubmit={handleSubmit}
              isSubmitting={isSubmitting}
              limits={limits}
              autoApprove={limits?.autoApprove ?? false}
            />
          </AuthGate>

          {showMyPosts && (
            <MyPosts
              posts={myPosts}
              isLoading={myPostsLoading}
              error={myPostsError}
              onRefresh={refetchMyPosts}
            />
          )}

          <TrustBadges />
        </motion.div>
      </main>

      <Footer />
    </div>
  )
}
