'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { apiClient, ApiError } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'

interface AdminAuthState {
  isAdmin: boolean
  isChecking: boolean
  login: (password: string) => Promise<boolean>
  logout: () => Promise<void>
  loginPassword: string
  setLoginPassword: (v: string) => void
  loginOpen: boolean
  setLoginOpen: (v: boolean) => void
  /** @deprecated Use isAdmin instead — auth is via HttpOnly cookie */
  adminToken: string
}

const AdminAuthContext = createContext<AdminAuthState | null>(null)

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false)
  const [isChecking, setIsChecking] = useState(true)
  const [adminToken, setAdminToken] = useState('') // backward compat sentinel
  const [loginPassword, setLoginPassword] = useState('')
  const [loginOpen, setLoginOpen] = useState(false)
  const { toast } = useToast()
  const initialCheckDone = useRef(false)

  useEffect(() => {
    if (initialCheckDone.current) return
    initialCheckDone.current = true
    apiClient.checkSession().then(() => {
      setIsAdmin(true)
      setAdminToken('session')
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
      setAdminToken('session')
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

  const logout = useCallback(async () => {
    try { await apiClient.adminLogout() } catch { /* best effort */ }
    setIsAdmin(false)
    setAdminToken('')
    toast({ title: 'Logout berhasil' })
  }, [toast])

  return (
    <AdminAuthContext.Provider value={{ isAdmin, isChecking, login, logout, loginPassword, setLoginPassword, loginOpen, setLoginOpen, adminToken }}>
      {children}
    </AdminAuthContext.Provider>
  )
}

export function useAdminAuth(): AdminAuthState {
  const ctx = useContext(AdminAuthContext)
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider')
  return ctx
}
