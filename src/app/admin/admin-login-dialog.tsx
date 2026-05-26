'use client'

import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Shield, LogIn, Loader2 } from 'lucide-react'
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
import { useAdminAuth } from '@/contexts/admin-auth-context'
import { APP_VERSION } from '@/lib/constants'

export function AdminLoginDialog() {
  const { login, loginPassword, setLoginPassword, loginOpen, setLoginOpen } = useAdminAuth()
  const [isLoggingIn, setIsLoggingIn] = useState(false)

  const handleLogin = useCallback(async () => {
    setIsLoggingIn(true)
    await login(loginPassword)
    setIsLoggingIn(false)
  }, [login, loginPassword])

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
                      onChange={(e) => { setLoginPassword(e.target.value); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleLogin() }}
                    />
                    <Button
                      onClick={handleLogin}
                      disabled={isLoggingIn}
                      className="w-full bg-[#0F1419] hover:bg-[#272c30]"
                    >
                      {isLoggingIn && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
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
