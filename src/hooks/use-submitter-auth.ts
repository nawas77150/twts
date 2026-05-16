'use client'

import { useState, useEffect, useCallback } from 'react'
import type { SubmitterInfo } from '@/types'
import { apiClient } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'

export function useSubmitterAuth() {
  const [submitter, setSubmitter] = useState<SubmitterInfo | null>(null)
  const [isChecking, setIsChecking] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [isBlocked, setIsBlocked] = useState(false)
  const { toast } = useToast()

  const checkAuth = useCallback(async () => {
    try {
      setAuthError(null)
      const data = await apiClient.checkAuth()
      if (data.authenticated && data.submitter) {
        setSubmitter(data.submitter)
        setIsBlocked(!!data.blocked)
        return true
      }
      setSubmitter(null)
      setIsBlocked(false)
    } catch {
      setAuthError('Tidak dapat terhubung ke server')
      setSubmitter(null)
      setIsBlocked(false)
    }
    return false
  }, [])

  // Initial auth check on mount
  useEffect(() => {
    async function initialCheck() {
      await checkAuth()
      setIsChecking(false)
    }
    initialCheck()
  }, [checkAuth])

  // Re-check auth after OAuth callback with retry (server may need time
  // to set the session cookie, especially on cold starts).
  // Toast is shown ONLY after auth is confirmed — not prematurely.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const authResult = params.get('auth')
    if (authResult === 'success') {
      let attempts = 0
      const maxAttempts = 4
      const tryAuth = async () => {
        const ok = await checkAuth()
        if (ok) {
          toast({ title: 'Login berhasil!', description: 'Selamat datang!' })
          window.history.replaceState({}, '', '/')
        } else if (attempts < maxAttempts) {
          attempts++
          setTimeout(tryAuth, 500 * attempts) // 500ms, 1000ms, 1500ms, 2000ms
        } else {
          // All retries exhausted — auth could not be confirmed
          toast({ title: 'Login gagal', description: 'Gagal memverifikasi sesi. Coba login ulang.', variant: 'destructive' })
          window.history.replaceState({}, '', '/')
        }
      }
      const timer = setTimeout(tryAuth, 300)
      return () => clearTimeout(timer)
    }
  }, [checkAuth, toast])

  // Handle non-success auth callback params (denied / error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const authResult = params.get('auth')
    if (authResult === 'denied') {
      toast({ title: 'Login dibatalkan', description: 'Kamu menolak akses ke akun X.', variant: 'destructive' })
      window.history.replaceState({}, '', '/')
    } else if (authResult === 'error') {
      toast({ title: 'Login gagal', description: 'Terjadi kesalahan saat login dengan X. Coba lagi.', variant: 'destructive' })
      window.history.replaceState({}, '', '/')
    }
  }, [toast])

  const logout = async () => {
    setSubmitter(null)
    setAuthError(null)
    setIsBlocked(false)
    try {
      await apiClient.logout()
    } catch {
      // Server-side cookie cleanup failed — session cookie may still be active.
      // The httpOnly cookie persists for 30 days, so on shared devices the user
      // should clear browser cookies manually for full session invalidation.
      toast({
        title: 'Logout tidak lengkap di server',
        description: 'Cookie sesi mungkin masih aktif. Jika menggunakan perangkat umum, hapus cookie browser secara manual.',
        variant: 'default',
        duration: 7000,
      })
    }
  }

  const setBlocked = (val: boolean) => setIsBlocked(val)

  return { submitter, isChecking, authError, isBlocked, setBlocked, logout, checkAuth }
}
