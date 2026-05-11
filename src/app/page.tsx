'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send,
  Shield,
  CheckCircle,
  Twitter,
  LogOut,
  Clock,
  CheckCheck,
  Ban,
  BarChart3,
  RefreshCw,
  Eye,
  MessageSquare,
  Zap,
  Loader2,
  LogIn,
  Users,
  ExternalLink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'

// Types
interface SubmitterInfo {
  id: string
  username: string
  displayName: string | null
  profileImage: string | null
  twitterId: string | null
}

interface Submission {
  id: string
  message: string
  status: 'pending' | 'approved' | 'rejected' | 'posted'
  tweetId: string | null
  category: string | null
  submitterId: string
  submitter: SubmitterInfo
  createdAt: string
  updatedAt: string
}

interface Stats {
  pending: number
  approved: number
  rejected: number
  posted: number
  total: number
  submitters: number
}

// Status config
const statusConfig = {
  pending: { label: 'Menunggu', color: 'bg-yellow-100 text-yellow-800 border-yellow-300', icon: Clock },
  approved: { label: 'Disetujui', color: 'bg-green-100 text-green-800 border-green-300', icon: CheckCheck },
  rejected: { label: 'Ditolak', color: 'bg-red-100 text-red-800 border-red-300', icon: Ban },
  posted: { label: 'Diposting', color: 'bg-sky-100 text-sky-800 border-sky-300', icon: CheckCircle },
}

// Custom hook for submitter auth via cookie-based session
function useSubmitterAuth() {
  const [submitter, setSubmitter] = useState<SubmitterInfo | null>(null)
  const [isChecking, setIsChecking] = useState(true)

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const data = await res.json()
        if (data.authenticated && data.submitter) {
          setSubmitter(data.submitter)
          return true
        }
      }
    } catch {
      // ignore - not logged in
    }
    return false
  }, [])

  useEffect(() => {
    async function initialCheck() {
      await checkAuth()
      setIsChecking(false)
    }
    initialCheck()
  }, [checkAuth])

  // Re-check auth after OAuth callback
  // The callback now sets the session via /api/auth/set-session (fetch from HTML page)
  // So by the time this runs, the cookie should already be set
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const authResult = params.get('auth')
    if (authResult === 'success') {
      // Give a small delay for the cookie to be fully processed
      const timer = setTimeout(async () => {
        await checkAuth()
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [checkAuth])

  const logout = async () => {
    setSubmitter(null)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // ignore
    }
  }

  return { submitter, isChecking, logout, checkAuth }
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState('submit')
  const { submitter, isChecking, logout: submitterLogout } = useSubmitterAuth()

  // Admin auth state
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminToken, setAdminToken] = useState('')
  const [adminLoginPassword, setAdminLoginPassword] = useState('')
  const [adminLoginOpen, setAdminLoginOpen] = useState(false)

  // Submission form state
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Admin state
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [filterStatus, setFilterStatus] = useState('pending')
  const [isLoadingAdmin, setIsLoadingAdmin] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const { toast } = useToast()

  const isLoggedOut = !submitter
  const submitterUsername = submitter?.username
  const submitterImage = submitter?.profileImage

  // Check for auth callback params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const authResult = params.get('auth')
    if (authResult === 'success') {
      toast({ title: 'Login berhasil!', description: 'Selamat datang!' })
      window.history.replaceState({}, '', '/')
    } else if (authResult === 'denied') {
      toast({ title: 'Login dibatalkan', description: 'Kamu menolak akses ke akun X.', variant: 'destructive' })
      window.history.replaceState({}, '', '/')
    } else if (authResult === 'error') {
      toast({ title: 'Login gagal', description: 'Terjadi kesalahan saat login dengan X.', variant: 'destructive' })
      window.history.replaceState({}, '', '/')
    }
  }, [toast])

  // Handle logout
  const handleLogout = () => {
    submitterLogout()
    toast({ title: 'Logout berhasil' })
  }

  // Twitter OAuth login
  const handleTwitterLogin = () => {
    window.location.href = '/api/auth/twitter'
  }

  // Admin login
  const handleAdminLogin = async () => {
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminLoginPassword }),
      })
      const data = await res.json()
      if (res.ok) {
        setIsAdmin(true)
        setAdminToken(data.token)
        setAdminLoginOpen(false)
        setAdminLoginPassword('')
        toast({ title: 'Login berhasil!', description: 'Selamat datang, Admin.' })
        fetchSubmissions(data.token)
        fetchStats(data.token)
      } else {
        toast({ title: 'Login gagal', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Tidak dapat terhubung ke server', variant: 'destructive' })
    }
  }

  const handleAdminLogout = () => {
    setIsAdmin(false)
    setAdminToken('')
    setSubmissions([])
    setStats(null)
    toast({ title: 'Logout berhasil' })
  }

  // Submit message
  const handleSubmit = async () => {
    if (isLoggedOut) {
      toast({ title: 'Login dulu!', description: 'Login dengan akun X untuk mengirim pesan.', variant: 'destructive' })
      return
    }
    if (!message.trim()) {
      toast({ title: 'Error', description: 'Pesan tidak boleh kosong', variant: 'destructive' })
      return
    }
    if (message.trim().length > 280) {
      toast({ title: 'Error', description: 'Pesan maksimal 280 karakter', variant: 'destructive' })
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, category: category || undefined }),
      })
      const data = await res.json()

      if (res.ok) {
        toast({ title: 'Berhasil dikirim!', description: 'Pesanmu sedang menunggu moderasi admin.' })
        setMessage('')
        setCategory('')
      } else {
        toast({ title: 'Gagal', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Tidak dapat terhubung ke server', variant: 'destructive' })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Fetch submissions (admin)
  const fetchSubmissions = useCallback(async (token?: string) => {
    const t = token || adminToken
    if (!t) return
    setIsLoadingAdmin(true)
    try {
      const statusParam = filterStatus !== 'all' ? `?status=${filterStatus}` : ''
      const res = await fetch(`/api/submissions${statusParam}`, {
        headers: { authorization: `Bearer ${t}` },
      })
      if (res.ok) {
        const data = await res.json()
        setSubmissions(data.submissions)
      }
    } catch {
      toast({ title: 'Error', description: 'Gagal memuat data', variant: 'destructive' })
    } finally {
      setIsLoadingAdmin(false)
    }
  }, [adminToken, filterStatus, toast])

  // Fetch stats (admin)
  const fetchStats = useCallback(async (token?: string) => {
    const t = token || adminToken
    if (!t) return
    try {
      const res = await fetch('/api/admin/stats', {
        headers: { authorization: `Bearer ${t}` },
      })
      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
    } catch {
      // silently fail
    }
  }, [adminToken])

  // Approve submission (auto-posts to X)
  const handleApprove = async (id: string) => {
    setActionLoading(id)
    try {
      const res = await fetch(`/api/submissions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ status: 'approved' }),
      })
      const data = await res.json()
      if (res.ok) {
        if (data.autoPosted) {
          toast({ title: 'Disetujui & diposting!', description: 'Pesan otomatis diposting ke X.' })
        } else if (data.warning) {
          toast({ title: 'Disetujui', description: data.warning })
        } else if (data.error) {
          toast({ title: 'Disetujui, tapi gagal posting', description: data.error, variant: 'destructive' })
        } else {
          toast({ title: 'Disetujui', description: 'Pesan telah disetujui.' })
        }
        fetchSubmissions()
        fetchStats()
      } else {
        toast({ title: 'Gagal', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Gagal menyetujui', variant: 'destructive' })
    } finally {
      setActionLoading(null)
    }
  }

  // Reject submission
  const handleReject = async (id: string) => {
    setActionLoading(id)
    try {
      const res = await fetch(`/api/submissions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ status: 'rejected' }),
      })
      if (res.ok) {
        toast({ title: 'Ditolak', description: 'Pesan telah ditolak.' })
        fetchSubmissions()
        fetchStats()
      } else {
        const data = await res.json()
        toast({ title: 'Gagal', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Gagal menolak', variant: 'destructive' })
    } finally {
      setActionLoading(null)
    }
  }

  // Post to X (manual fallback)
  const handlePostToX = async (id: string) => {
    setActionLoading(`post-${id}`)
    try {
      const res = await fetch(`/api/submissions/${id}/post`, {
        method: 'POST',
        headers: { authorization: `Bearer ${adminToken}` },
      })
      const data = await res.json()
      if (res.ok) {
        toast({ title: 'Berhasil diposting ke X!', description: data.tweetId ? `Tweet ID: ${data.tweetId}` : undefined })
        fetchSubmissions()
        fetchStats()
      } else {
        toast({ title: 'Gagal posting', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Gagal posting ke X', variant: 'destructive' })
    } finally {
      setActionLoading(null)
    }
  }

  // Delete submission
  const handleDelete = async (id: string) => {
    setActionLoading(`del-${id}`)
    try {
      const res = await fetch(`/api/submissions/${id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${adminToken}` },
      })
      if (res.ok) {
        toast({ title: 'Dihapus' })
        fetchSubmissions()
        fetchStats()
      }
    } catch {
      toast({ title: 'Error', description: 'Gagal menghapus', variant: 'destructive' })
    } finally {
      setActionLoading(null)
    }
  }

  // Auto-refresh for admin
  useEffect(() => {
    if (isAdmin) {
      fetchSubmissions()
      fetchStats()
      const interval = setInterval(() => { fetchSubmissions(); fetchStats() }, 15000)
      return () => clearInterval(interval)
    }
  }, [isAdmin, filterStatus, fetchSubmissions, fetchStats])

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 via-white to-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-white/80 backdrop-blur-lg">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-sky-600 flex items-center justify-center shadow-md shadow-sky-200">
              <Twitter className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-tight">Autobase</h1>
              <p className="text-xs text-slate-500">Twitter Menfess</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* User info / login */}
            {isChecking ? (
              <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
            ) : !isLoggedOut ? (
              <div className="flex items-center gap-2">
                {submitterImage ? (
                  <img src={submitterImage} alt="" className="w-6 h-6 rounded-full border border-sky-200" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center text-white text-[10px] font-bold">
                    {(submitterUsername || 'U').charAt(0).toUpperCase()}
                  </div>
                )}
                <Badge variant="outline" className="text-xs gap-1 border-sky-300 text-sky-700 bg-sky-50">
                  @{submitterUsername || 'user'}
                </Badge>
                <Button variant="ghost" size="sm" onClick={handleLogout} className="text-slate-400 h-7 w-7 p-0">
                  <LogOut className="w-3.5 h-3.5" />
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                onClick={handleTwitterLogin}
                className="bg-sky-500 hover:bg-sky-600 text-white h-8 px-3"
              >
                <Twitter className="w-3.5 h-3.5 mr-1.5" /> Login X
              </Button>
            )}

            <Separator orientation="vertical" className="h-5" />

            {/* Admin */}
            {isAdmin ? (
              <div className="flex items-center gap-1">
                <Badge variant="outline" className="text-xs gap-1 border-green-300 text-green-700 bg-green-50">
                  <Shield className="w-3 h-3" /> Admin
                </Badge>
                <Button variant="ghost" size="sm" onClick={handleAdminLogout} className="text-slate-400 h-7 w-7 p-0">
                  <LogOut className="w-3.5 h-3.5" />
                </Button>
              </div>
            ) : (
              <Dialog open={adminLoginOpen} onOpenChange={setAdminLoginOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-slate-400 hover:text-slate-600">
                    <Shield className="w-4 h-4 mr-1" /> Admin
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Shield className="w-5 h-5 text-sky-500" /> Login Admin
                    </DialogTitle>
                    <DialogDescription>Masukkan password admin untuk mengakses dashboard.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 pt-2">
                    <Input
                      type="password"
                      placeholder="Password admin..."
                      value={adminLoginPassword}
                      onChange={(e) => setAdminLoginPassword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
                    />
                    <Button onClick={handleAdminLogin} className="w-full bg-sky-500 hover:bg-sky-600">
                      Masuk
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2 mb-6 bg-slate-100 p-1 rounded-xl">
            <TabsTrigger value="submit" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <Send className="w-4 h-4 mr-2" /> Kirim Pesan
            </TabsTrigger>
            <TabsTrigger value="admin" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <Shield className="w-4 h-4 mr-2" /> Dashboard
            </TabsTrigger>
          </TabsList>

          {/* Submit Tab */}
          <TabsContent value="submit">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Kirim Pesan Anonim</h2>
                <p className="text-slate-500">Tulis pesanmu, admin akan memeriksa dan mempostingnya ke Twitter.</p>
              </div>

              {isChecking ? (
                <Card className="max-w-lg mx-auto py-12">
                  <CardContent className="flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-sky-500" />
                  </CardContent>
                </Card>
              ) : isLoggedOut ? (
                <Card className="max-w-lg mx-auto shadow-lg border-slate-200">
                  <CardContent className="py-10 text-center space-y-5">
                    <div className="w-14 h-14 rounded-2xl bg-sky-50 flex items-center justify-center mx-auto">
                      <Twitter className="w-7 h-7 text-sky-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-800">Login Dulu Ya!</h3>
                    <p className="text-sm text-slate-500">
                      Login dengan akun X untuk mengirim pesan. <br />
                      <span className="text-slate-400 text-xs">Tenang, identitasmu tetap anonim di tweet!</span>
                    </p>
                    <Button
                      onClick={handleTwitterLogin}
                      className="bg-sky-500 hover:bg-sky-600 text-white h-11 text-base px-8"
                      size="lg"
                    >
                      <Twitter className="w-5 h-5 mr-2" /> Login dengan X
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <Card className="max-w-lg mx-auto shadow-lg border-slate-200">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-sky-500" /> Tulis Pesan
                    </CardTitle>
                    <CardDescription className="flex items-center gap-1.5">
                      {submitterImage ? (
                        <img src={submitterImage} alt="" className="w-4 h-4 rounded-full" />
                      ) : null}
                      Login sebagai <span className="font-medium text-sky-600">@{submitterUsername || 'user'}</span> · Pesan akan diperiksa admin sebelum diposting
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Textarea
                        placeholder="Tulis pesan anonimmu di sini..."
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        className="min-h-[120px] resize-none border-slate-200 focus:border-sky-400 focus:ring-sky-400"
                        maxLength={280}
                      />
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-400">Maks 280 karakter (batas tweet X)</span>
                        <span className={`text-xs font-medium ${message.length > 280 ? 'text-red-500' : message.length > 220 ? 'text-amber-500' : 'text-slate-400'}`}>
                          {message.length}/280
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Input
                        placeholder="Kategori (opsional, contoh: curhat, confes, dll)"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="border-slate-200 focus:border-sky-400 focus:ring-sky-400"
                        maxLength={30}
                      />
                    </div>
                    <Button
                      onClick={handleSubmit}
                      disabled={isSubmitting || !message.trim()}
                      className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-50"
                      size="lg"
                    >
                      {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                      {isSubmitting ? 'Mengirim...' : 'Kirim Pesan'}
                    </Button>
                  </CardContent>
                </Card>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg mx-auto mt-6">
                <div className="flex items-center gap-2 p-3 rounded-xl bg-sky-50 border border-sky-100">
                  <Shield className="w-4 h-4 text-sky-500 shrink-0" />
                  <span className="text-xs text-sky-700">Dimoderasi admin</span>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 border border-green-100">
                  <Eye className="w-4 h-4 text-green-500 shrink-0" />
                  <span className="text-xs text-green-700">Anonim di Twitter</span>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-100">
                  <Zap className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-xs text-amber-700">Gratis selamanya</span>
                </div>
              </div>
              <p className="text-center text-xs text-slate-400 mt-4">
                * Identitasmu hanya diketahui admin untuk moderasi. Tweet yang diposting 100% anonim.
              </p>
            </motion.div>
          </TabsContent>

          {/* Admin Tab */}
          <TabsContent value="admin">
            {!isAdmin ? (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="max-w-md mx-auto text-center py-12">
                  <CardContent className="space-y-4">
                    <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto">
                      <Shield className="w-8 h-8 text-slate-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-700">Akses Terbatas</h3>
                    <p className="text-sm text-slate-500">Login sebagai admin untuk mengelola pesan masuk.</p>
                    <Dialog open={adminLoginOpen} onOpenChange={setAdminLoginOpen}>
                      <DialogTrigger asChild>
                        <Button className="bg-sky-500 hover:bg-sky-600">
                          <LogIn className="w-4 h-4 mr-2" /> Login Admin
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-sm">
                        <DialogHeader>
                          <DialogTitle className="flex items-center gap-2">
                            <Shield className="w-5 h-5 text-sky-500" /> Login Admin
                          </DialogTitle>
                          <DialogDescription>Masukkan password admin.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 pt-2">
                          <Input
                            type="password"
                            placeholder="Password admin..."
                            value={adminLoginPassword}
                            onChange={(e) => setAdminLoginPassword(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
                          />
                          <Button onClick={handleAdminLogin} className="w-full bg-sky-500 hover:bg-sky-600">
                            Masuk
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </CardContent>
                </Card>
              </motion.div>
            ) : (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                {stats && (
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                    {[
                      { label: 'Total', value: stats.total, icon: BarChart3, color: 'bg-slate-100 text-slate-700' },
                      { label: 'Menunggu', value: stats.pending, icon: Clock, color: 'bg-yellow-50 text-yellow-700' },
                      { label: 'Disetujui', value: stats.approved, icon: CheckCheck, color: 'bg-green-50 text-green-700' },
                      { label: 'Ditolak', value: stats.rejected, icon: Ban, color: 'bg-red-50 text-red-700' },
                      { label: 'Diposting', value: stats.posted, icon: CheckCircle, color: 'bg-sky-50 text-sky-700' },
                      { label: 'Pengguna', value: stats.submitters, icon: Users, color: 'bg-purple-50 text-purple-700' },
                    ].map((stat) => (
                      <Card key={stat.label} className="border-0 shadow-sm">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2 mb-1">
                            <div className={`w-7 h-7 rounded-lg ${stat.color} flex items-center justify-center`}>
                              <stat.icon className="w-3.5 h-3.5" />
                            </div>
                            <span className="text-xs text-slate-500 hidden sm:inline">{stat.label}</span>
                          </div>
                          <p className="text-2xl font-bold text-slate-900">{stat.value}</p>
                          <span className="text-xs text-slate-400 sm:hidden">{stat.label}</span>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-600">Filter:</span>
                  {['all', 'pending', 'approved', 'rejected', 'posted'].map((status) => (
                    <Button
                      key={status}
                      variant={filterStatus === status ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setFilterStatus(status)}
                      className={filterStatus === status ? 'bg-sky-500 hover:bg-sky-600' : 'border-slate-200'}
                    >
                      {status === 'all' ? 'Semua' : statusConfig[status as keyof typeof statusConfig]?.label}
                    </Button>
                  ))}
                  <Button variant="ghost" size="sm" onClick={() => { fetchSubmissions(); fetchStats() }} className="ml-auto text-slate-400">
                    <RefreshCw className={`w-4 h-4 ${isLoadingAdmin ? 'animate-spin' : ''}`} />
                  </Button>
                </div>

                <div className="space-y-3 max-h-[calc(100vh-400px)] overflow-y-auto pr-1">
                  {isLoadingAdmin ? (
                    <Card className="py-12">
                      <CardContent className="flex items-center justify-center gap-2 text-slate-400">
                        <Loader2 className="w-5 h-5 animate-spin" /> Memuat data...
                      </CardContent>
                    </Card>
                  ) : submissions.length === 0 ? (
                    <Card className="py-12">
                      <CardContent className="text-center">
                        <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-3">
                          <MessageSquare className="w-6 h-6 text-slate-300" />
                        </div>
                        <p className="text-slate-500">Belum ada pesan</p>
                        <p className="text-xs text-slate-400 mt-1">Pesan yang masuk akan muncul di sini</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <AnimatePresence mode="popLayout">
                      {submissions.map((sub) => {
                        const config = statusConfig[sub.status as keyof typeof statusConfig]
                        return (
                          <motion.div key={sub.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                            <Card className="shadow-sm border-slate-200 hover:shadow-md transition-shadow">
                              <CardContent className="p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-2">
                                      {sub.submitter.profileImage ? (
                                        <img src={sub.submitter.profileImage} alt="" className="w-6 h-6 rounded-full border border-slate-200" />
                                      ) : (
                                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                                          {sub.submitter.username.charAt(0).toUpperCase()}
                                        </div>
                                      )}
                                      <span className="text-xs font-medium text-slate-600">
                                        @{sub.submitter.username}
                                      </span>
                                      {sub.submitter.twitterId && (
                                        <a
                                          href={`https://x.com/i/user/${sub.submitter.twitterId}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-xs text-sky-500 hover:underline flex items-center gap-0.5"
                                        >
                                          <Twitter className="w-3 h-3" />
                                          <ExternalLink className="w-2.5 h-2.5" />
                                        </a>
                                      )}
                                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${config.color}`}>
                                        {config.label}
                                      </Badge>
                                    </div>
                                    <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{sub.message}</p>
                                    {sub.category && (
                                      <span className="inline-block text-xs text-slate-400 mt-1">#{sub.category}</span>
                                    )}
                                    <p className="text-[10px] text-slate-300 mt-1">{formatDate(sub.createdAt)}</p>
                                    {sub.tweetId && (
                                      <a
                                        href={`https://x.com/i/status/${sub.tweetId}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[10px] text-sky-500 hover:underline mt-0.5 inline-flex items-center gap-0.5"
                                      >
                                        Lihat tweet <ExternalLink className="w-2.5 h-2.5" />
                                      </a>
                                    )}
                                  </div>

                                  {/* Action buttons */}
                                  <div className="flex items-center gap-1 shrink-0">
                                    {sub.status === 'pending' && (
                                      <>
                                        <Button
                                          size="sm"
                                          onClick={() => handleApprove(sub.id)}
                                          disabled={actionLoading === sub.id}
                                          className="h-7 px-2 text-xs bg-green-500 hover:bg-green-600 text-white"
                                        >
                                          {actionLoading === sub.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-1" />}
                                          Setujui
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="destructive"
                                          onClick={() => handleReject(sub.id)}
                                          disabled={actionLoading === sub.id}
                                          className="h-7 px-2 text-xs"
                                        >
                                          Tolak
                                        </Button>
                                      </>
                                    )}
                                    {sub.status === 'approved' && (
                                      <Button
                                        size="sm"
                                        onClick={() => handlePostToX(sub.id)}
                                        disabled={actionLoading === `post-${sub.id}`}
                                        className="h-7 px-2 text-xs bg-sky-500 hover:bg-sky-600 text-white"
                                      >
                                        {actionLoading === `post-${sub.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Twitter className="w-3 h-3 mr-1" />}
                                        Post
                                      </Button>
                                    )}
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleDelete(sub.id)}
                                      disabled={actionLoading === `del-${sub.id}`}
                                      className="h-7 w-7 p-0 text-slate-300 hover:text-red-500"
                                    >
                                      {actionLoading === `del-${sub.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <span className="text-xs">&times;</span>}
                                    </Button>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          </motion.div>
                        )
                      })}
                    </AnimatePresence>
                  )}
                </div>
              </motion.div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t bg-white/80 backdrop-blur-lg">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <p className="text-xs text-slate-400">Autobase Menfess &mdash; Twitter Base Indonesia</p>
          <p className="text-xs text-slate-400">Login with X only &middot; Anonim di tweet</p>
        </div>
      </footer>
    </div>
  )
}
