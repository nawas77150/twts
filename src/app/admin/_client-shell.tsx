'use client'

import { AdminAuthProvider, useAdminAuth } from '@/contexts/admin-auth-context'
import { AdminStatsProvider, useAdminStats } from '@/contexts/admin-stats-context'
import { AdminHeader } from '@/components/layout/admin-header'
import { AdminLoginDialog } from './admin-login-dialog'
import { APP_VERSION } from '@/lib/constants'

export function AdminClientShell({ children }: { children: React.ReactNode }) {
  return (
    <AdminAuthProvider>
      <AdminStatsProvider>
        <AdminClientShellInner>{children}</AdminClientShellInner>
      </AdminStatsProvider>
    </AdminAuthProvider>
  )
}

function AdminClientShellInner({ children }: { children: React.ReactNode }) {
  const { isAdmin, isChecking, logout } = useAdminAuth()
  const { pendingCount } = useAdminStats()

  if (isChecking) {
    return (
      <div className="min-h-screen flex flex-col bg-[#F7F9F9]">
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-[#0F1419] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-[#536471]">Memeriksa sesi...</p>
          </div>
        </main>
      </div>
    )
  }

  if (!isAdmin) {
    return <AdminLoginDialog />
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F9F9]">
      <AdminHeader onLogout={logout} pendingCount={pendingCount} />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
        {children}
      </main>
      <footer className="mt-auto py-4 text-center text-xs text-[#71767B]">
        Tweetfess Admin &copy; {new Date().getFullYear()} · v{APP_VERSION}
      </footer>
    </div>
  )
}
