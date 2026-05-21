'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { apiClient, ApiError, onUnauthorized } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'

interface AdminAuthState {
  isAdmin: boolean
  isChecking: boolean
  login: (password: string) => Promise<boolean>
  logout: () => Promise<void>
  registerResetCallback: (cb: () => void) => void
  unregisterResetCallback: (cb: () => void) => void
  loginPassword: string
  setLoginPassword: (v: string) => void
  loginOpen: boolean
  setLoginOpen: (v: boolean) => void
}

const AdminAuthContext = createContext<AdminAuthState | null>(null)

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false)
  const [isChecking, setIsChecking] = useState(true)
  const [loginPassword, setLoginPassword] = useState('')
  const [loginOpen, setLoginOpen] = useState(false)
  const { toast } = useToast()
  const initialCheckDone = useRef(false)
  const resetCallbacks = useRef<Set<() => void>>(new Set())
  const handled401Ref = useRef(false)

  // Register 401 interceptor — auto-logout on session expiry
  // Dedup: if multiple requests fail with 401 simultaneously, only show one toast
  useEffect(() => {
    const unsub = onUnauthorized(() => {
      if (isAdmin && !handled401Ref.current) {
        handled401Ref.current = true
        setIsAdmin(false)
        toast({ title: 'Sesi kadaluarsa', description: 'Sesi admin telah berakhir. Silakan login ulang.', variant: 'destructive' })
      }
    })
    return unsub
  }, [isAdmin, toast])

  // Reset 401 dedup guard when user successfully logs back in
  useEffect(() => {
    if (isAdmin) handled401Ref.current = false
  }, [isAdmin])

  useEffect(() => {
    if (initialCheckDone.current) return
    initialCheckDone.current = true
    apiClient.checkSession().then(() => {
      setIsAdmin(true)
    }).catch(() => {
      // Not authenticated
    }).finally(() => {
      setIsChecking(false)
    })
  }, [])

  const login = useCallback(async (password: string) => {
    try {
      await apiClient.adminLogin(password)
      setIsAdmin(true)
      setLoginOpen(false)
      setLoginPassword('')
      toast({ title: 'Login berhasil!', description: 'Selamat datang, Admin.' })
      return true
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : (err instanceof Error ? err.message : 'Login gagal')
      toast({ title: 'Login gagal', description: message, variant: 'destructive' })
      return false
    }
  }, [toast])

  const registerResetCallback = useCallback((cb: () => void) => {
    resetCallbacks.current.add(cb)
  }, [])

  const unregisterResetCallback = useCallback((cb: () => void) => {
    resetCallbacks.current.delete(cb)
  }, [])

  const logout = useCallback(async () => {
    try { await apiClient.adminLogout() } catch { /* best effort */ }
    setIsAdmin(false)
    // Reset all settings hooks imperatively at logout (M-2)
    for (const cb of resetCallbacks.current) cb()
    toast({ title: 'Logout berhasil' })
  }, [toast])

  return (
    <AdminAuthContext.Provider value={{ isAdmin, isChecking, login, logout, registerResetCallback, unregisterResetCallback, loginPassword, setLoginPassword, loginOpen, setLoginOpen }}>
      {children}
    </AdminAuthContext.Provider>
  )
}

export function useAdminAuth(): AdminAuthState {
  const ctx = useContext(AdminAuthContext)
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider')
  return ctx
}
