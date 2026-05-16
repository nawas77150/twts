'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Shield, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useAdminAuth } from '@/hooks/use-admin-auth'
import { AdminHeader } from '@/components/layout/admin-header'
import { apiClient } from '@/lib/api-client'
import { APP_VERSION } from '@/lib/constants'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin, isChecking, adminToken, login, logout, loginPassword, setLoginPassword, loginOpen, setLoginOpen } = useAdminAuth()
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)

  // Fetch pending count for the header badge
  useEffect(() => {
    if (!isAdmin || !adminToken) return
    const fetchPending = async () => {
      try {
        const stats = await apiClient.getStats()
        setPendingCount(stats.pending)
      } catch {
        // silently fail
      }
    }
    void fetchPending()
    const interval = setInterval(() => { void fetchPending() }, 30000)
    return () => clearInterval(interval)
  }, [isAdmin, adminToken])

  const handleLogin = async () => {
    setIsLoggingIn(true)
    await login(loginPassword)
    setIsLoggingIn(false)
  }

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
    return (
      <div className="min-h-screen flex flex-col bg-[#F7F9F9]">
        <main className="flex-1 flex items-center justify-center px-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="max-w-md mx-auto text-center py-12">
              <CardContent className="space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-[#F7F9F9] flex items-center justify-center mx-auto">
                  <Shield className="w-8 h-8 text-[#71767B]" />
                </div>
                <h3 className="text-lg font-semibold text-[#3D4145]">Akses Terbatas</h3>
                <p className="text-sm text-[#536471]">Login sebagai admin untuk mengelola pesan masuk.</p>
                <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
                  <DialogTrigger asChild>
                    <Button className="bg-[#0F1419] hover:bg-[#272c30]">
                      <LogIn className="w-4 h-4 mr-2" /> Login Admin
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <Shield className="w-5 h-5 text-[#536471]" /> Login Admin
                      </DialogTitle>
                      <DialogDescription>Masukkan password admin.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 pt-2">
                      <Input
                        type="password"
                        placeholder="Password admin..."
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                      />
                      <Button
                        onClick={handleLogin}
                        disabled={isLoggingIn}
                        className="w-full bg-[#0F1419] hover:bg-[#272c30]"
                      >
                        {isLoggingIn ? 'Memproses...' : 'Masuk'}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>
          </motion.div>
        </main>
        <footer className="mt-auto py-4 text-center text-xs text-[#71767B]">
          Tweetfess Admin &copy; {new Date().getFullYear()} · v{APP_VERSION}
        </footer>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F9F9]">
      <AdminHeader adminToken={adminToken} onLogout={logout} pendingCount={pendingCount} />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
        {children}
      </main>
      <footer className="mt-auto py-4 text-center text-xs text-[#71767B]">
        Tweetfess Admin &copy; {new Date().getFullYear()} · v{APP_VERSION}
      </footer>
    </div>
  )
}
