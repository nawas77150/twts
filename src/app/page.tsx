'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send,
  Shield,
  CheckCircle,
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
  User,
  ChevronDown,
  AlertTriangle,
  RotateCcw,
  EyeOff,
  Settings,
  Activity,
  Key,
  Globe,
  LayoutDashboard,
  Wifi,
  CircleDot,
  Filter,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  UserCheck,
  AlertCircle,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useToast } from '@/hooks/use-toast'
import { DEFAULT_BLOCKED_WORDS, DEFAULT_NSFW_WORDS } from '@/lib/content-filter'

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
  status: 'pending' | 'post_failed' | 'rejected' | 'posted'
  tweetId: string | null
  postMethod: string | null // "direct" | "retry" | "fallback"
  postError: string | null // Error message from last failed post attempt
  category: string | null
  filterReasons: string | null // JSON array of filter reasons
  submitterId: string
  submitter: SubmitterInfo
  createdAt: string
  updatedAt: string
}

interface KeyCredits {
  apiKey: string
  rechargeCredits: number
  bonusCredits: number
  totalCredits: number
  error?: string
}

interface ApiLoginStatus {
  hasLoginCookie: boolean
  lastLoginAt: string | null
  hasCredentials: boolean
  missingCredentials: string[]
}

interface PostMethodStats {
  total: number
  direct: number
  retry: number
  fallback: number
  directRate: number
  retryRate: number
  fallbackRate: number
}

interface FilterRules {
  blockedWords: boolean
  jualan: boolean
  urls: boolean
  mentions: boolean
  phoneNumbers: boolean
  nsfw: boolean
  capsSpam: boolean
  repeatedChars: boolean
  tooShort: boolean
  duplicate24h: boolean
}

interface RateLimitSettings {
  submissionCooldown: number             // minutes
  submissionDailyCap: number             // count
  autoPostCooldown: number               // seconds
  autoPostWindowCap: number              // max posts per window
  autoPostWindowMinutes: number          // window size in minutes
  userPostDailyCap: number               // max posts per user per day on X
  userPendingCap: number                 // max pending submissions per user
  globalSubmissionDailyCap: number       // max submissions from ALL users per day
  circuitBreakerThreshold: number        // consecutive failures before pause
  circuitBreakerCooldownMinutes: number  // how long to pause
}

interface FilterSettings {
  autoApprove: boolean
  blockedWords: string[]
  nsfwWords: string[]
  filterRules: FilterRules
  geminiEnabled: boolean
  geminiApiKeySet: boolean
  rateLimits: RateLimitSettings
  whitelistUsernames: string[]
  blockedUsernames: string[]
}

interface Stats {
  pending: number
  postFailed: number
  rejected: number
  posted: number
  total: number
  submitters: number
  cookieAuthStatus: {
    configured: boolean
    source: string | null
    lastUpdated: string | null
    missing: string[]
  } | null
  postMethodStats: PostMethodStats | null
  apiCredits: KeyCredits[] | null
  apiLoginStatus: ApiLoginStatus | null
  filterSettings: FilterSettings | null
}

// Status config
const statusConfig = {
  pending: { label: 'Menunggu', color: 'bg-yellow-100 text-yellow-800 border-yellow-300', icon: Clock },
  post_failed: { label: 'Gagal Posting', color: 'bg-red-100 text-red-800 border-red-300', icon: AlertCircle },
  rejected: { label: 'Ditolak', color: 'bg-gray-100 text-gray-600 border-gray-300', icon: Ban },
  posted: { label: 'Diposting', color: 'bg-[#F7F9F9] text-[#3D4145] border-[#EFF3F4]', icon: CheckCircle },
}

function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

// Custom hook for submitter auth via cookie-based session
function useSubmitterAuth() {
  const [submitter, setSubmitter] = useState<SubmitterInfo | null>(null)
  const [isChecking, setIsChecking] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [isBlocked, setIsBlocked] = useState(false)

  const checkAuth = useCallback(async () => {
    try {
      setAuthError(null)
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const data = await res.json()
        if (data.authenticated && data.submitter) {
          setSubmitter(data.submitter)
          setIsBlocked(!!data.blocked)
          return true
        }
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

  useEffect(() => {
    async function initialCheck() {
      await checkAuth()
      setIsChecking(false)
    }
    initialCheck()
  }, [checkAuth])

  // Re-check auth after OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const authResult = params.get('auth')
    if (authResult === 'success') {
      const timer = setTimeout(async () => {
        await checkAuth()
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [checkAuth])

  const logout = async () => {
    setSubmitter(null)
    setAuthError(null)
    setIsBlocked(false)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // ignore
    }
  }

  const setBlocked = (val: boolean) => setIsBlocked(val)

  return { submitter, isChecking, authError, isBlocked, setBlocked, logout, checkAuth }
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState('submit')
  const { submitter, isChecking, authError, isBlocked, setBlocked: setSubmitterBlocked, logout: submitterLogout, checkAuth } = useSubmitterAuth()

  // Admin auth state
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminToken, setAdminToken] = useState('')
  const [adminLoginPassword, setAdminLoginPassword] = useState('')
  const [adminLoginOpen, setAdminLoginOpen] = useState(false)

  // Admin sub-tab state
  const [adminSubTab, setAdminSubTab] = useState<'dashboard' | 'settings'>('dashboard')

  // Admin cookie helpers
  const ADMIN_COOKIE = 'tweetfess_admin'
  const setAdminCookie = (token: string) => {
    document.cookie = `${ADMIN_COOKIE}=${encodeURIComponent(token)};path=/;max-age=${7 * 24 * 60 * 60};samesite=strict`
  }
  const getAdminCookie = (): string => {
    const match = document.cookie.match(new RegExp(`(?:^|; )${ADMIN_COOKIE}=([^;]*)`))
    return match ? decodeURIComponent(match[1]) : ''
  }
  const clearAdminCookie = () => {
    document.cookie = `${ADMIN_COOKIE}=;path=/;max-age=0`
  }

  // Submission form state
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Admin state
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [submissionsPage, setSubmissionsPage] = useState(1)
  const [submissionsHasMore, setSubmissionsHasMore] = useState(false)
  const [submissionsTotal, setSubmissionsTotal] = useState(0)
  const [stats, setStats] = useState<Stats | null>(null)
  const [filterStatus, setFilterStatus] = useState('pending')
  const [postSearch, setPostSearch] = useState('')
  const [isLoadingAdmin, setIsLoadingAdmin] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // X Settings state
  const [cookieString, setCookieString] = useState('')
  const [queryId, setQueryId] = useState('')
  const [bearerToken, setBearerToken] = useState('')
  const [cookieStatus, setCookieStatus] = useState<Stats['cookieAuthStatus']>(null)
  const [isSavingSetting, setIsSavingSetting] = useState<string | null>(null) // key being saved
  const [showCookieGuide, setShowCookieGuide] = useState(false)
  const [showCookieValue, setShowCookieValue] = useState(false)
  const [showBearerValue, setShowBearerValue] = useState(false)
  const [showQueryIdGuide, setShowQueryIdGuide] = useState(false)
  const [showBearerGuide, setShowBearerGuide] = useState(false)
  const [isClearingCache, setIsClearingCache] = useState(false)

  // API Settings state
  const [apiKeys, setApiKeys] = useState('') // JSON array string
  const [apiProxy, setApiProxy] = useState('')
  const [postMethodSetting, setPostMethodSetting] = useState<'direct' | 'api' | 'auto'>('auto')
  const [apiCredits, setApiCredits] = useState<KeyCredits[]>([])
  const [isLoadingCredits, setIsLoadingCredits] = useState(false)
  const [postMethodStats, setPostMethodStats] = useState<PostMethodStats | null>(null)
  const [apiLoginStatus, setApiLoginStatus] = useState<ApiLoginStatus | null>(null)

  // X Login Credentials state (for twitterapi.io user_login_v2)
  const [xUsername, setXUsername] = useState('')
  const [xEmail, setXEmail] = useState('')
  const [xPassword, setXPassword] = useState('')
  const [xTotpSecret, setXTotpSecret] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showTotpSecret, setShowTotpSecret] = useState(false)

  // Settings collapsible state
  const [directPostingOpen, setDirectPostingOpen] = useState(true)
  const [apiFallbackOpen, setApiFallbackOpen] = useState(true)
  const [filterOpen, setFilterOpen] = useState(false)

  // Filter & Auto-Approve state
  const [autoApprove, setAutoApprove] = useState(false)
  const [blockedWordsText, setBlockedWordsText] = useState('') // textarea value
  const [nsfwWordsText, setNsfwWordsText] = useState('') // textarea value
  const [filterRules, setFilterRules] = useState<FilterRules>({
    blockedWords: true,
    jualan: true,
    urls: true,
    mentions: true,
    phoneNumbers: true,
    nsfw: false,
    capsSpam: true,
    repeatedChars: true,
    tooShort: true,
    duplicate24h: true,
  })
  const [isSavingFilter, setIsSavingFilter] = useState(false)

  // Gemini AI filter state
  const [geminiEnabled, setGeminiEnabled] = useState(false)
  const [geminiApiKeyInput, setGeminiApiKeyInput] = useState('') // input field value
  const [geminiApiKeySet, setGeminiApiKeySet] = useState(false) // whether a key is saved in DB
  const [showGeminiKey, setShowGeminiKey] = useState(false)

  // Rate limit state
  const [rateLimits, setRateLimits] = useState<RateLimitSettings>({
    submissionCooldown: 2,
    submissionDailyCap: 20,
    autoPostCooldown: 10,
    autoPostWindowCap: 25,
    autoPostWindowMinutes: 30,
    userPostDailyCap: 5,
    userPendingCap: 5,
    globalSubmissionDailyCap: 200,
    circuitBreakerThreshold: 3,
    circuitBreakerCooldownMinutes: 30,
  })
  const [whitelistText, setWhitelistText] = useState('') // textarea value

  // Pengguna dialog state
  const [penggunaDialogOpen, setPenggunaDialogOpen] = useState(false)
  const [penggunaSearch, setPenggunaSearch] = useState('')

  // Circuit breaker state (read-only, from server)
  const [circuitBreakerStatus, setCircuitBreakerStatus] = useState<{ paused: boolean; failCount: number; pausedUntil: number | null; threshold: number } | null>(null)
  // Live countdown computed from pausedUntil — updates every second
  const [liveRemainingMinutes, setLiveRemainingMinutes] = useState(0)

  // Compute live countdown from pausedUntil timestamp
  useEffect(() => {
    if (!circuitBreakerStatus?.paused || !circuitBreakerStatus.pausedUntil) {
      setLiveRemainingMinutes(0)
      return
    }
    const compute = () => {
      const remaining = circuitBreakerStatus.pausedUntil! - Date.now()
      if (remaining <= 0) {
        setLiveRemainingMinutes(0)
        // Auto-clear paused state when timer expires
        setCircuitBreakerStatus((prev) => prev ? { ...prev, paused: false, pausedUntil: null } : null)
        return
      }
      setLiveRemainingMinutes(Math.ceil(remaining / 60000))
    }
    compute() // initial calculation
    const interval = setInterval(compute, 1000)
    return () => clearInterval(interval)
  }, [circuitBreakerStatus?.paused, circuitBreakerStatus?.pausedUntil])

  // Submitters & blocklist state
  const [submitters, setSubmitters] = useState<{ id: string; username: string; displayName: string | null; profileImage: string | null; totalSubmissions: number; posted: number; pending: number; rejected: number; postFailed: number }[]>([])
  const [blockedUsernames, setBlockedUsernames] = useState<string[]>([])
  const [isLoadingSubmitters, setIsLoadingSubmitters] = useState(false)

  // Batch saving state
  const [isSavingAllCredentials, setIsSavingAllCredentials] = useState(false)

  // My Posts state
  const [myPosts, setMyPosts] = useState<Submission[]>([])
  const [myPostsLoading, setMyPostsLoading] = useState(false)

  const { toast } = useToast()

  const isLoggedOut = !submitter
  const submitterUsername = submitter?.username
  const submitterImage = submitter?.profileImage
  const isAnonUser = submitter?.username?.startsWith('anon_')

  // Restore admin session from cookie on page load
  useEffect(() => {
    const savedToken = getAdminCookie()
    if (savedToken) {
      // Verify the token is still valid by calling stats
      fetch('/api/admin/stats', {
        headers: { authorization: `Bearer ${savedToken}` },
      }).then((res) => {
        if (res.ok) {
          setIsAdmin(true)
          setAdminToken(savedToken)
        } else {
          // Token invalid — clear cookie
          clearAdminCookie()
        }
      }).catch(() => {
        clearAdminCookie()
      })
    }
  }, [])

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
      toast({ title: 'Login gagal', description: 'Terjadi kesalahan saat login dengan X. Coba lagi.', variant: 'destructive' })
      window.history.replaceState({}, '', '/')
    }
  }, [toast])

  // Handle logout
  const handleLogout = () => {
    submitterLogout()
    toast({ title: 'Logout berhasil', description: 'Sampai jumpa!' })
  }

  // Fetch my posts
  const fetchMyPosts = useCallback(async () => {
    if (!submitter) return
    setMyPostsLoading(true)
    try {
      const res = await fetch('/api/submissions/mine')
      if (res.ok) {
        const data = await res.json()
        setMyPosts(data.submissions)
      }
    } catch {
      // silently fail
    } finally {
      setMyPostsLoading(false)
    }
  }, [submitter])

  // Fetch my posts when user logs in
  useEffect(() => {
    if (submitter && !isAnonUser) {
      fetchMyPosts()
    } else {
      setMyPosts([])
    }
  }, [submitter, isAnonUser, fetchMyPosts])

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
        setAdminCookie(data.token)
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
    clearAdminCookie()
    setSubmissions([])
    setStats(null)
    setCookieStatus(null)
    setCookieString('')
    setQueryId('')
    setBearerToken('')
    setPostMethodStats(null)
    setApiCredits([])
    setApiKeys('')
    setApiProxy('')
    setPostMethodSetting('auto')
    setApiLoginStatus(null)
    setXUsername('')
    setXEmail('')
    setXPassword('')
    setXTotpSecret('')
    setAutoApprove(false)
    setBlockedWordsText('')
    setNsfwWordsText('')
    setFilterRules({
      blockedWords: true,
      jualan: true,
      urls: true,
      mentions: true,
      phoneNumbers: true,
      nsfw: false,
      capsSpam: true,
      repeatedChars: true,
      tooShort: true,
      duplicate24h: true,
    })
    setGeminiEnabled(false)
    setGeminiApiKeyInput('')
    setGeminiApiKeySet(false)
    setRateLimits({ submissionCooldown: 2, submissionDailyCap: 20, autoPostCooldown: 10, autoPostWindowCap: 25, autoPostWindowMinutes: 30, userPostDailyCap: 5, userPendingCap: 5, globalSubmissionDailyCap: 200, circuitBreakerThreshold: 3, circuitBreakerCooldownMinutes: 30 })
    setWhitelistText('')
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
        if (data.autoPosted) {
          toast({ title: 'Terkirim & diposting!', description: 'Pesanmu langsung diposting ke X.' })
        } else if (data.queued) {
          toast({ title: 'Masuk antrean', description: data.error || 'Pesanmu sudah masuk antrean dan akan diposting oleh admin setelahnya.' })
        } else if (data.filtered) {
          toast({ title: 'Menunggu review', description: 'Pesanmu sedang menunggu review admin.' })
        } else {
          toast({ title: 'Berhasil dikirim!', description: 'Pesanmu sedang menunggu moderasi admin.' })
        }
        setMessage('')
        setCategory('')
        fetchMyPosts()
      } else {
        // If blocked (403), update isBlocked state so UI shows the blocked card
        if (res.status === 403) {
          setSubmitterBlocked(true)
        }
        const errorDesc = data.message || data.error || 'Gagal mengirim pesan'
        toast({ title: data.error || 'Gagal', description: errorDesc, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Tidak dapat terhubung ke server', variant: 'destructive' })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Fetch submissions (admin)
  // silent=true for auto-refresh — no loading spinner flicker, no error toast spam
  const fetchSubmissions = useCallback(async (token?: string, silent = false, page?: number) => {
    const t = token || adminToken
    if (!t) return
    const targetPage = page ?? submissionsPage
    if (!silent) setIsLoadingAdmin(true)
    try {
      const params = new URLSearchParams()
      if (filterStatus !== 'all') params.set('status', filterStatus)
      params.set('page', String(targetPage))
      params.set('limit', '50')
      const res = await fetch(`/api/submissions?${params.toString()}`, {
        headers: { authorization: `Bearer ${t}` },
      })
      if (res.ok) {
        const data = await res.json()
        if (targetPage === 1) {
          setSubmissions(data.submissions)
        } else {
          setSubmissions(prev => [...prev, ...data.submissions])
        }
        setSubmissionsHasMore(data.pagination?.hasMore ?? false)
        setSubmissionsTotal(data.pagination?.total ?? 0)
        setSubmissionsPage(targetPage)
      }
    } catch {
      if (!silent) toast({ title: 'Error', description: 'Gagal memuat data', variant: 'destructive' })
    } finally {
      if (!silent) setIsLoadingAdmin(false)
    }
  }, [adminToken, filterStatus, toast, submissionsPage])

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
        setCookieStatus(data.cookieAuthStatus)
        if (data.postMethodStats) setPostMethodStats(data.postMethodStats)
        if (data.apiCredits) setApiCredits(data.apiCredits)
        if (data.apiLoginStatus) setApiLoginStatus(data.apiLoginStatus)
        if (data.postMethodSetting) setPostMethodSetting(data.postMethodSetting)
        // Load filter settings
        if (data.filterSettings) {
          setAutoApprove(data.filterSettings.autoApprove)
          setBlockedWordsText(data.filterSettings.blockedWords.join(', '))
          setNsfwWordsText(data.filterSettings.nsfwWords.join(', '))
          setFilterRules(data.filterSettings.filterRules)
          setGeminiEnabled(data.filterSettings.geminiEnabled)
          setGeminiApiKeySet(data.filterSettings.geminiApiKeySet)
          if (data.filterSettings.rateLimits) setRateLimits(data.filterSettings.rateLimits)
          if (data.filterSettings.whitelistUsernames) setWhitelistText(data.filterSettings.whitelistUsernames.join(', '))
          if (data.filterSettings.circuitBreaker) setCircuitBreakerStatus(data.filterSettings.circuitBreaker)
          if (data.filterSettings.blockedUsernames) setBlockedUsernames(data.filterSettings.blockedUsernames)
        }
      }
    } catch {
      // silently fail
    }
  }, [adminToken])

  // Fetch submitters (admin)
  const fetchSubmitters = useCallback(async () => {
    if (!adminToken) return
    setIsLoadingSubmitters(true)
    try {
      const res = await fetch('/api/admin/submitters', {
        headers: { authorization: `Bearer ${adminToken}` },
      })
      if (res.ok) {
        const data = await res.json()
        setSubmitters(data.submitters)
      }
    } catch { /* ignore */ } finally {
      setIsLoadingSubmitters(false)
    }
  }, [adminToken])

  // Generic save for any X setting
  const handleSaveSetting = async (key: string, value: string, onSuccess?: () => void) => {
    setIsSavingSetting(key)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ key, value }),
      })
      const data = await res.json()
      if (res.ok) {
        // Cookie string gets parsed confirmation toast
        if (key === 'x_cookie_string' && data.parsed) {
          const parsedInfo = `auth_token: ${data.parsed.auth_token}, ct0: ${data.parsed.ct0}`
          toast({ title: 'Cookie disimpan!', description: parsedInfo })
        } else {
          const labels: Record<string, string> = {
            x_query_id: 'Query ID',
            x_bearer_token: 'Bearer Token',
            twitterapi_keys: 'API Keys',
            twitterapi_proxy: 'Proxy URL',
            post_method: 'Post Method',
            x_username: 'X Username',
            x_email: 'X Email',
            x_password: 'X Password',
            x_totp_secret: '2FA Secret',
          }
          const desc = data.autoLogin?.attempted
            ? data.autoLogin.success
              ? 'Auto-login berhasil — cookie tersimpan.'
              : `Disimpan, tapi auto-login gagal: ${data.autoLogin.error || 'Unknown error'}`
            : undefined
          toast({ title: `${labels[key] || key} disimpan!`, description: desc })
        }
        onSuccess?.()
        fetchStats()
      } else {
        toast({ title: 'Gagal', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Gagal menyimpan', variant: 'destructive' })
    } finally {
      setIsSavingSetting(null)
    }
  }

  // Save all X login credentials in batch
  const handleSaveAllCredentials = async () => {
    setIsSavingAllCredentials(true)
    const fields: { key: string; value: string; label: string }[] = [
      { key: 'x_username', value: xUsername, label: 'Username' },
      { key: 'x_email', value: xEmail, label: 'Email' },
      { key: 'x_password', value: xPassword, label: 'Password' },
      { key: 'x_totp_secret', value: xTotpSecret, label: '2FA Secret' },
    ]

    let savedCount = 0
    let failedFields: string[] = []

    for (const field of fields) {
      if (field.value.trim()) {
        try {
          const res = await fetch('/api/admin/settings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              authorization: `Bearer ${adminToken}`,
            },
            body: JSON.stringify({ key: field.key, value: field.value }),
          })
          if (res.ok) {
            savedCount++
          } else {
            failedFields.push(field.label)
          }
        } catch {
          failedFields.push(field.label)
        }
      }
    }

    if (failedFields.length > 0) {
      toast({
        title: 'Sebagian gagal disimpan',
        description: `Gagal: ${failedFields.join(', ')}. Berhasil: ${savedCount} field.`,
        variant: 'destructive',
      })
    } else {
      toast({
        title: 'Semua kredensial disimpan!',
        description: `${savedCount} field berhasil disimpan.`,
      })
    }

    fetchStats()
    setIsSavingAllCredentials(false)
  }

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
          let desc = 'Pesan otomatis diposting ke X.'
          if (data.postMethod === 'retry') desc = data.description || 'Pesan diposting setelah retry.'
          else if (data.postMethod === 'fallback') desc = data.description || 'Pesan diposting via fallback API.'
          toast({ title: 'Disetujui & diposting!', description: desc })
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
      fetchSubmissions() // initial load — shows spinner
      fetchStats()
      const interval = setInterval(() => { fetchSubmissions(undefined, true); fetchStats() }, 15000)
      return () => clearInterval(interval)
    }
  }, [isAdmin, filterStatus, fetchSubmissions, fetchStats])

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  // Pending count for badge
  const pendingCount = stats?.pending ?? 0

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F9F9]">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-[#EFF3F4] bg-white/80 backdrop-blur-lg">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#0F1419] flex items-center justify-center shadow-md shadow-gray-200">
              <XLogo className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#0F1419] leading-tight">Autobase</h1>
              <p className="text-xs text-[#536471]">X Menfess</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* User info / login */}
            {isChecking ? (
              <div className="flex items-center gap-2 text-[#71767B]">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs hidden sm:inline">Memeriksa...</span>
              </div>
            ) : !isLoggedOut ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center gap-2 px-2 h-9 hover:bg-[#F7F9F9]">
                    <Avatar className="w-6 h-6">
                      {submitterImage ? (
                        <AvatarImage src={submitterImage} alt={submitterUsername || ''} />
                      ) : null}
                      <AvatarFallback className="bg-[#272c30] text-white text-[10px] font-bold">
                        {(submitterUsername || 'U').charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <Badge variant="outline" className="text-xs gap-1 border-[#EFF3F4] text-[#3D4145] bg-[#F7F9F9] hidden sm:inline-flex">
                      @{submitterUsername || 'user'}
                    </Badge>
                    <ChevronDown className="w-3 h-3 text-[#71767B]" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">{submitter?.displayName || submitterUsername}</p>
                      <p className="text-xs leading-none text-mutedforeground">@{submitterUsername}</p>
                      {isAnonUser && (
                        <p className="text-xs text-amber-600 flex items-center gap-1 mt-1">
                          <AlertTriangle className="w-3 h-3" /> Profil X gagal dimuat
                        </p>
                      )}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {isAnonUser && (
                    <DropdownMenuItem onClick={handleLogout} className="text-amber-600 focus:text-amber-700">
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Coba Login Ulang
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={handleLogout} variant="destructive">
                    <LogOut className="w-4 h-4 mr-2" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                size="sm"
                onClick={handleTwitterLogin}
                className="bg-[#0F1419] hover:bg-[#272c30] text-white h-9 px-4"
              >
                <XLogo className="w-4 h-4 mr-2" /> Login X
              </Button>
            )}

            <Separator orientation="vertical" className="h-5 hidden sm:block" />

            {/* Admin */}
            {isAdmin ? (
              <div className="flex items-center gap-1">
                <Badge variant="outline" className="text-xs gap-1 border-green-300 text-green-700 bg-green-50">
                  <Shield className="w-3 h-3" /> <span className="hidden sm:inline">Admin</span>
                </Badge>
                <Button variant="ghost" size="sm" onClick={handleAdminLogout} className="text-[#71767B] h-7 w-7 p-0">
                  <LogOut className="w-3.5 h-3.5" />
                </Button>
              </div>
            ) : (
              <Dialog open={adminLoginOpen} onOpenChange={setAdminLoginOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-[#71767B] hover:text-[#536471]">
                    <Shield className="w-4 h-4 mr-1" /> Admin
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Shield className="w-5 h-5 text-[#536471]" /> Login Admin
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
                    <Button onClick={handleAdminLogin} className="w-full bg-[#0F1419] hover:bg-[#272c30]">
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
          <TabsList className="grid w-full grid-cols-2 mb-6 bg-[#F7F9F9] p-1 rounded-xl">
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
                <h2 className="text-2xl font-bold text-[#0F1419] mb-2">Kirim Pesan Anonim</h2>
                <p className="text-[#536471]">Tulis pesanmu, admin akan memeriksa dan mempostingnya ke X.</p>
              </div>

              {isChecking ? (
                <Card className="max-w-lg mx-auto py-12">
                  <CardContent className="flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-[#536471]" />
                  </CardContent>
                </Card>
              ) : authError ? (
                <Card className="max-w-lg mx-auto shadow-lg border-amber-200">
                  <CardContent className="py-10 text-center space-y-5">
                    <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto">
                      <AlertTriangle className="w-7 h-7 text-amber-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-[#0F1419]">Koneksi Bermasalah</h3>
                    <p className="text-sm text-[#536471]">{authError}</p>
                    <Button
                      onClick={checkAuth}
                      variant="outline"
                      className="border-[#EFF3F4]"
                    >
                      <RotateCcw className="w-4 h-4 mr-2" /> Coba Lagi
                    </Button>
                  </CardContent>
                </Card>
              ) : isLoggedOut ? (
                <Card className="max-w-lg mx-auto shadow-lg border-[#EFF3F4]">
                  <CardContent className="py-10 text-center space-y-5">
                    <div className="w-14 h-14 rounded-2xl bg-[#F7F9F9] flex items-center justify-center mx-auto">
                      <XLogo className="w-7 h-7 text-[#0F1419]" />
                    </div>
                    <h3 className="text-lg font-semibold text-[#0F1419]">Login Dulu Ya!</h3>
                    <p className="text-sm text-[#536471]">
                      Login dengan akun X untuk mengirim pesan. <br />
                      <span className="text-[#71767B] text-xs">Tenang, identitasmu tetap anonim di tweet!</span>
                    </p>
                    <Button
                      onClick={handleTwitterLogin}
                      className="bg-[#0F1419] hover:bg-[#272c30] text-white h-11 text-base px-8"
                      size="lg"
                    >
                      <XLogo className="w-5 h-5 mr-2" /> Login dengan X
                    </Button>
                  </CardContent>
                </Card>
              ) : isAnonUser ? (
                /* Logged in as anonymous fallback — profile fetch failed, suggest re-login */
                <Card className="max-w-lg mx-auto shadow-lg border-amber-200">
                  <CardContent className="py-10 text-center space-y-5">
                    <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto">
                      <AlertTriangle className="w-7 h-7 text-amber-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-[#0F1419]">Profil X Gagal Dimuat</h3>
                    <p className="text-sm text-[#536471]">
                      Login berhasil tapi profil X kamu tidak bisa dimuat. <br />
                      <span className="text-[#71767B] text-xs">Kamu tetap bisa mengirim pesan, atau coba login ulang.</span>
                    </p>
                    <div className="flex items-center justify-center gap-3">
                      <Button
                        onClick={handleLogout}
                        variant="outline"
                        className="border-[#EFF3F4]"
                      >
                        <LogOut className="w-4 h-4 mr-2" /> Logout & Coba Lagi
                      </Button>
                      <Button
                        onClick={handleTwitterLogin}
                        className="bg-[#0F1419] hover:bg-[#272c30] text-white"
                      >
                        <RotateCcw className="w-4 h-4 mr-2" /> Re-Login X
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : isBlocked ? (
                /* User is blocked — cannot submit */
                <Card className="max-w-lg mx-auto shadow-lg border-red-200">
                  <CardContent className="py-10 text-center space-y-5">
                    <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mx-auto">
                      <Ban className="w-7 h-7 text-red-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-[#0F1419]">Akun Diblokir</h3>
                    <p className="text-sm text-[#536471]">
                      Akun kamu tidak diperbolehkan mengirim pesan. <br />
                      <span className="text-[#71767B] text-xs">Hubungi admin jika kamu rasa ini salah.</span>
                    </p>
                    <Button
                      onClick={handleLogout}
                      variant="outline"
                      className="border-[#EFF3F4]"
                    >
                      <LogOut className="w-4 h-4 mr-2" /> Logout
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <Card className="max-w-lg mx-auto shadow-lg border-[#EFF3F4]">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-[#536471]" /> Tulis Pesan
                    </CardTitle>
                    <CardDescription className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs sm:text-sm">
                      {submitterImage ? (
                        <img src={submitterImage} alt="" className="w-4 h-4 rounded-full shrink-0" />
                      ) : null}
                      <span className="inline-flex items-center gap-1">
                        Login sebagai <span className="font-medium text-[#0F1419]">@{submitterUsername || 'user'}</span>
                      </span>
                      <span className="text-[#71767B]">·</span>
                      <span>Pesan akan diperiksa admin sebelum diposting</span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Textarea
                        placeholder="Tulis pesan anonimmu di sini..."
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        className="min-h-[120px] resize-none border-[#EFF3F4]"
                        maxLength={280}
                      />
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-[#71767B]">Maks 280 karakter (batas tweet X)</span>
                        <span className={`text-xs font-medium ${message.length > 280 ? 'text-red-500' : message.length > 220 ? 'text-amber-500' : 'text-[#71767B]'}`}>
                          {message.length}/280
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Input
                        placeholder="Kategori (opsional, contoh: curhat, confes, dll)"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="border-[#EFF3F4]"
                        maxLength={30}
                      />
                    </div>
                    <Button
                      onClick={handleSubmit}
                      disabled={isSubmitting || !message.trim()}
                      className="w-full bg-[#0F1419] hover:bg-[#272c30] disabled:opacity-50"
                      size="lg"
                    >
                      {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                      {isSubmitting ? 'Mengirim...' : 'Kirim Pesan'}
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* My Posts Section */}
              {!isLoggedOut && !isAnonUser && (
                <Card className="max-w-lg mx-auto mt-6 shadow-lg border-[#EFF3F4]">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <User className="w-4 h-4 text-[#536471]" /> Postinganku
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={fetchMyPosts}
                        disabled={myPostsLoading}
                        className="h-6 w-6 p-0 text-[#71767B]"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${myPostsLoading ? 'animate-spin' : ''}`} />
                      </Button>
                    </div>
                    <CardDescription>Pesan yang sudah kamu kirim dan statusnya</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {myPosts.length === 0 ? (
                      <div className="text-center py-6">
                        <MessageSquare className="w-8 h-8 text-[#EFF3F4] mx-auto mb-2" />
                        <p className="text-sm text-[#71767B]">Belum ada pesan yang dikirim</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-[#EFF3F4] border border-[#EFF3F4] rounded-lg max-h-72 overflow-y-auto">
                        {myPosts.map((post) => {
                          const config = statusConfig[post.status as keyof typeof statusConfig]
                          return (
                            <div key={post.id} className="px-3 py-2 hover:bg-[#F7F9F9]/50 transition-colors">
                              <div className="flex items-center gap-2 mb-0.5">
                                <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 ${config.color}`}>
                                  {config.label}
                                </Badge>
                                <span className="text-[10px] text-[#71767B]">{formatDate(post.createdAt)}</span>
                                {post.status === 'posted' && post.tweetId && (
                                  <a
                                    href={`https://x.com/i/status/${post.tweetId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[#71767B] hover:text-[#0F1419] ml-auto"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                              <p className="text-sm text-[#0F1419] whitespace-pre-wrap break-words leading-snug line-clamp-2">{post.message}</p>
                              {/* Filter reasons */}
                              {post.filterReasons && (() => {
                                try {
                                  const reasons: string[] = JSON.parse(post.filterReasons)
                                  if (reasons.length === 0) return null
                                  return (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      <Badge variant="outline" className="text-[8px] px-1 py-0 bg-amber-50 text-amber-700 border-amber-200 gap-0.5">
                                        <ShieldAlert className="w-2.5 h-2.5" />
                                        {reasons.length} filter flag{reasons.length > 1 ? 's' : ''}
                                      </Badge>
                                      {reasons.slice(0, 3).map((reason, i) => {
                                        const label = reason.startsWith('blocked_word:')
                                          ? `"${reason.replace('blocked_word:', '').replace(/(.).+(.)/, (_, a, b) => a + '***' + b)}"`
                                          : reason.startsWith('ai:')
                                          ? `AI: ${reason.replace('ai:', '')}`
                                          : reason.startsWith('jualan:')
                                          ? 'Jualan'
                                          : reason === 'contains_url'
                                          ? 'Link'
                                          : reason.startsWith('contains_mention')
                                          ? '@Mention'
                                          : reason === 'contains_phone_number'
                                          ? 'No. HP'
                                          : reason === 'caps_spam'
                                          ? 'ALL CAPS'
                                          : reason === 'repeated_characters'
                                          ? 'Spam chars'
                                          : reason === 'too_short'
                                          ? 'Terlalu pendek'
                                          : reason === 'duplicate_24h'
                                          ? 'Duplikat (24j)'
                                          : reason
                                        return (
                                          <span key={i} className="text-[8px] px-1 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
                                            {label}
                                          </span>
                                        )
                                      })}
                                      {reasons.length > 3 && (
                                        <span className="text-[8px] text-[#71767B]">+{reasons.length - 3} more</span>
                                      )}
                                    </div>
                                  )
                                } catch {
                                  return null
                                }
                              })()}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg mx-auto mt-6">
                <div className="flex items-center gap-2 p-3 rounded-xl bg-[#F7F9F9] border border-[#EFF3F4]">
                  <Shield className="w-4 h-4 text-[#536471] shrink-0" />
                  <span className="text-xs text-[#536471]">Dimoderasi admin</span>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 border border-green-100">
                  <Eye className="w-4 h-4 text-green-500 shrink-0" />
                  <span className="text-xs text-green-700">Anonim di X</span>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-100">
                  <Zap className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-xs text-amber-700">Gratis selamanya</span>
                </div>
              </div>
              <p className="text-center text-xs text-[#71767B] mt-4">
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
                    <div className="w-16 h-16 rounded-2xl bg-[#F7F9F9] flex items-center justify-center mx-auto">
                      <Shield className="w-8 h-8 text-[#71767B]" />
                    </div>
                    <h3 className="text-lg font-semibold text-[#3D4145]">Akses Terbatas</h3>
                    <p className="text-sm text-[#536471]">Login sebagai admin untuk mengelola pesan masuk.</p>
                    <Dialog open={adminLoginOpen} onOpenChange={setAdminLoginOpen}>
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
                            value={adminLoginPassword}
                            onChange={(e) => setAdminLoginPassword(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
                          />
                          <Button onClick={handleAdminLogin} className="w-full bg-[#0F1419] hover:bg-[#272c30]">
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
                {/* Admin Sub-Tabs */}
                <div className="flex items-center gap-1 bg-[#F7F9F9] p-1 rounded-xl">
                  <button
                    onClick={() => setAdminSubTab('dashboard')}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      adminSubTab === 'dashboard'
                        ? 'bg-white shadow-sm text-[#0F1419]'
                        : 'text-[#536471] hover:text-[#3D4145]'
                    }`}
                  >
                    <LayoutDashboard className="w-4 h-4" />
                    Dashboard
                    {pendingCount > 0 && (
                      <Badge className="bg-yellow-400 text-yellow-900 text-[10px] px-1.5 py-0 h-5 min-w-[20px] flex items-center justify-center">
                        {pendingCount}
                      </Badge>
                    )}
                  </button>
                  <button
                    onClick={() => setAdminSubTab('settings')}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      adminSubTab === 'settings'
                        ? 'bg-white shadow-sm text-[#0F1419]'
                        : 'text-[#536471] hover:text-[#3D4145]'
                    }`}
                  >
                    <Settings className="w-4 h-4" />
                    Settings
                  </button>
                </div>

                {/* ===== DASHBOARD SUB-TAB ===== */}
                {adminSubTab === 'dashboard' && (
                  <motion.div
                    key="dashboard"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-6"
                  >
                    {/* Stats Grid */}
                    {stats && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                        {[
                          { label: 'Total', value: stats.total, icon: BarChart3, color: 'bg-[#F7F9F9] text-[#3D4145]' },
                          { label: 'Menunggu', value: stats.pending, icon: Clock, color: stats.pending > 0 ? 'bg-yellow-50 text-yellow-700 ring-2 ring-yellow-300' : 'bg-yellow-50 text-yellow-700' },
                          { label: 'Gagal Posting', value: stats.postFailed, icon: AlertCircle, color: stats.postFailed > 0 ? 'bg-red-50 text-red-700 ring-2 ring-red-300' : 'bg-red-50 text-red-700' },
                          { label: 'Ditolak', value: stats.rejected, icon: Ban, color: 'bg-red-50 text-red-700' },
                          { label: 'Diposting', value: stats.posted, icon: CheckCircle, color: 'bg-[#F7F9F9] text-[#536471]' },
                          { label: 'Pengguna', value: stats.submitters, icon: Users, color: 'bg-purple-50 text-purple-700' },
                        ].map((stat) => {
                          const isPengguna = stat.label === 'Pengguna'
                          return (
                            <Card
                              key={stat.label}
                              className={`border-0 shadow-sm ${isPengguna ? 'cursor-pointer hover:ring-2 hover:ring-purple-200 hover:shadow-md transition-all' : ''}`}
                              onClick={isPengguna ? () => {
                                setPenggunaDialogOpen(true)
                                fetchSubmitters()
                              } : undefined}
                            >
                              <CardContent className="p-4">
                                <div className="flex items-center gap-2 mb-1">
                                  <div className={`w-7 h-7 rounded-lg ${stat.color} flex items-center justify-center`}>
                                    <stat.icon className="w-3.5 h-3.5" />
                                  </div>
                                  <span className="text-xs text-[#536471] hidden sm:inline">{stat.label}</span>
                                </div>
                                <p className="text-2xl font-bold text-[#0F1419]">{stat.value}</p>
                                <span className="text-xs text-[#71767B] sm:hidden">{stat.label}</span>
                              </CardContent>
                            </Card>
                          )
                        })}
                      </div>
                    )}

                    {/* Pengguna Dialog */}
                    <Dialog open={penggunaDialogOpen} onOpenChange={(open) => { setPenggunaDialogOpen(open); if (!open) setPenggunaSearch('') }}>
                      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
                        <DialogHeader>
                          <DialogTitle className="flex items-center gap-2">
                            <Users className="w-5 h-5 text-purple-600" /> Pengguna
                          </DialogTitle>
                          <DialogDescription>
                            Kelola pengguna — blokir yang spam atau bermasalah.
                          </DialogDescription>
                        </DialogHeader>

                        {/* Search */}
                        <div className="relative">
                          <Input
                            placeholder="Cari username..."
                            value={penggunaSearch}
                            onChange={(e) => setPenggunaSearch(e.target.value)}
                            className="pl-8 h-8 text-xs border-[#EFF3F4]"
                          />
                          <Filter className="w-3.5 h-3.5 text-[#71767B] absolute left-2.5 top-1/2 -translate-y-1/2" />
                          {penggunaSearch && (
                            <button
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#71767B] hover:text-[#0F1419]"
                              onClick={() => setPenggunaSearch('')}
                            >
                              ×
                            </button>
                          )}
                        </div>

                        <div className="flex-1 overflow-y-auto space-y-4 pr-1" style={{ scrollbarWidth: 'thin' }}>
                          {/* Blocklist */}
                          {blockedUsernames.filter((u) => u.includes(penggunaSearch.toLowerCase())).length > 0 && (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <Ban className="w-4 h-4 text-red-500" />
                                <span className="text-sm font-semibold text-[#0F1419]">Blocklist</span>
                                <Badge variant="destructive" className="text-[9px] px-1.5 py-0">
                                  {blockedUsernames.length} diblokir
                                </Badge>
                              </div>
                              <div className="space-y-1">
                                {blockedUsernames.filter((u) => u.includes(penggunaSearch.toLowerCase())).map((username) => (
                                  <div key={username} className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded-lg text-xs">
                                    <div className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                                      <Ban className="w-3.5 h-3.5 text-red-400" />
                                    </div>
                                    <span className="font-medium text-[#0F1419]">@{username}</span>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="text-[10px] h-6 px-2 ml-auto text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200 flex-shrink-0"
                                      onClick={async () => {
                                        try {
                                          const res = await fetch('/api/admin/submitters/unblock', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json', authorization: `Bearer ${adminToken}` },
                                            body: JSON.stringify({ username }),
                                          })
                                          if (res.ok) {
                                            setBlockedUsernames(blockedUsernames.filter((u) => u !== username))
                                            toast({ title: `@${username} dibebaskan` })
                                            fetchSubmitters()
                                          } else {
                                            const data = await res.json()
                                            toast({ title: 'Gagal', description: data.error, variant: 'destructive' })
                                          }
                                        } catch {
                                          toast({ title: 'Gagal', description: 'Tidak dapat terhubung ke server', variant: 'destructive' })
                                        }
                                      }}
                                    >
                                      Unblock
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* All Users */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <Users className="w-4 h-4 text-[#536471]" />
                              <span className="text-sm font-semibold text-[#0F1419]">Semua Pengguna</span>
                              {submitters.length > 0 && (
                                <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                                  {submitters.length}
                                </Badge>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-[10px] h-6 px-2 ml-auto"
                                onClick={fetchSubmitters}
                                disabled={isLoadingSubmitters}
                              >
                                {isLoadingSubmitters ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                              </Button>
                            </div>
                            {isLoadingSubmitters ? (
                              <div className="flex items-center justify-center py-8">
                                <Loader2 className="w-5 h-5 animate-spin text-[#536471]" />
                              </div>
                            ) : submitters.length === 0 ? (
                              <p className="text-xs text-[#71767B] text-center py-6">Klik refresh untuk memuat daftar pengguna</p>
                            ) : (
                              <div className="max-h-96 overflow-y-auto space-y-1 pr-1" style={{ scrollbarWidth: 'thin' }}>
                                {(() => {
                                  const filtered = submitters.filter((s) => {
                                    if (!penggunaSearch) return true
                                    const q = penggunaSearch.toLowerCase()
                                    return s.username.toLowerCase().includes(q) || (s.displayName?.toLowerCase().includes(q) ?? false)
                                  })
                                  if (filtered.length === 0 && penggunaSearch) {
                                    return (
                                      <div className="text-center py-6">
                                        <p className="text-xs text-[#536471]">Tidak ada hasil untuk &ldquo;{penggunaSearch}&rdquo;</p>
                                        <Button variant="link" className="text-xs text-[#71767B] mt-1" onClick={() => setPenggunaSearch('')}>Hapus pencarian</Button>
                                      </div>
                                    )
                                  }
                                  return filtered.map((s) => {
                                    const isBlocked = blockedUsernames.includes(s.username.toLowerCase())
                                    return (
                                      <div key={s.id} className={`flex items-center gap-2 p-2 rounded-lg text-xs ${isBlocked ? 'bg-red-50 border border-red-200' : 'bg-[#F7F9F9] border border-[#EFF3F4]'}`}>
                                        {s.profileImage ? (
                                          <img src={s.profileImage} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
                                        ) : (
                                          <div className="w-8 h-8 rounded-full bg-[#EFF3F4] flex items-center justify-center flex-shrink-0">
                                            <User className="w-4 h-4 text-[#71767B]" />
                                          </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-1">
                                            <span className="font-medium text-[#0F1419] truncate">@{s.username}</span>
                                            {isBlocked && <Badge variant="destructive" className="text-[8px] px-1 py-0">BLOCKED</Badge>}
                                          </div>
                                          <span className="text-[#71767B]">{s.totalSubmissions} pesan · {s.posted} posted · {s.pending} pending</span>
                                        </div>
                                        {!isBlocked ? (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="text-[10px] h-6 px-2 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 flex-shrink-0"
                                            onClick={async () => {
                                              try {
                                                const res = await fetch('/api/admin/submitters/block', {
                                                  method: 'POST',
                                                  headers: { 'Content-Type': 'application/json', authorization: `Bearer ${adminToken}` },
                                                  body: JSON.stringify({ username: s.username }),
                                                })
                                                if (res.ok) {
                                                  setBlockedUsernames([...blockedUsernames, s.username.toLowerCase()])
                                                  toast({ title: `@${s.username} diblokir` })
                                                } else {
                                                  const data = await res.json()
                                                  toast({ title: 'Gagal', description: data.error, variant: 'destructive' })
                                                }
                                              } catch {
                                                toast({ title: 'Gagal', description: 'Tidak dapat terhubung ke server', variant: 'destructive' })
                                              }
                                            }}
                                          >
                                            <Ban className="w-3 h-3 mr-1" /> Block
                                          </Button>
                                        ) : (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="text-[10px] h-6 px-2 text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200 flex-shrink-0"
                                            onClick={async () => {
                                              try {
                                                const res = await fetch('/api/admin/submitters/unblock', {
                                                  method: 'POST',
                                                  headers: { 'Content-Type': 'application/json', authorization: `Bearer ${adminToken}` },
                                                  body: JSON.stringify({ username: s.username }),
                                                })
                                                if (res.ok) {
                                                  setBlockedUsernames(blockedUsernames.filter((u) => u !== s.username.toLowerCase()))
                                                  toast({ title: `@${s.username} dibebaskan` })
                                                } else {
                                                  const data = await res.json()
                                                  toast({ title: 'Gagal', description: data.error, variant: 'destructive' })
                                                }
                                              } catch {
                                                toast({ title: 'Gagal', description: 'Tidak dapat terhubung ke server', variant: 'destructive' })
                                              }
                                            }}
                                          >
                                            Unblock
                                          </Button>
                                        )}
                                      </div>
                                    )
                                  })
                                })()}
                              </div>
                            )}
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>

                    {/* Connection Status Banner */}
                    <Card className="shadow-sm border-[#EFF3F4]">
                      <CardContent className="p-3">
                        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-x-4 sm:gap-y-2 text-xs">
                          <span className="font-medium text-[#536471] flex items-center gap-1.5">
                            <Wifi className="w-3.5 h-3.5" /> Connection
                          </span>
                          {/* Direct (Cookie) Status */}
                          <span className="flex items-center gap-1.5">
                            <CircleDot className={`w-3 h-3 ${
                              cookieStatus?.configured
                                ? 'text-green-500 fill-green-500'
                                : 'text-red-500 fill-red-500'
                            }`} />
                            <span className={cookieStatus?.configured ? 'text-green-700 font-medium' : 'text-red-600'}>
                              Direct: {cookieStatus?.configured ? 'Connected' : 'Not configured'}
                            </span>
                            {cookieStatus?.source && (
                              <span className="text-[#71767B]">(via {cookieStatus.source === 'database' ? 'Database' : 'Env Var'})</span>
                            )}
                          </span>
                          <span className="text-[#71767B] hidden sm:inline">|</span>
                          {/* API (Login Cookie) Status */}
                          <span className="flex items-center gap-1.5">
                            <CircleDot className={`w-3 h-3 ${
                              apiLoginStatus?.hasLoginCookie
                                ? 'text-green-500 fill-green-500'
                                : apiLoginStatus?.hasCredentials
                                ? 'text-amber-500 fill-amber-500'
                                : 'text-red-500 fill-red-500'
                            }`} />
                            <span className={
                              apiLoginStatus?.hasLoginCookie
                                ? 'text-green-700 font-medium'
                                : apiLoginStatus?.hasCredentials
                                ? 'text-amber-600 font-medium'
                                : 'text-red-600'
                            }>
                              API: {apiLoginStatus?.hasLoginCookie ? 'Logged in' : apiLoginStatus?.hasCredentials ? 'Need login' : 'Not configured'}
                            </span>
                            {apiLoginStatus?.lastLoginAt && (
                              <span className="text-[#71767B]">
                                Last: {new Date(apiLoginStatus.lastLoginAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'numeric', year: 'numeric' })}
                              </span>
                            )}
                          </span>
                          {/* Missing credentials warning */}
                          {(cookieStatus?.missing && cookieStatus.missing.length > 0 && !cookieStatus.configured) && (
                            <>
                              <span className="text-[#71767B] hidden sm:inline">|</span>
                              <span className="text-red-500 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                Missing: {cookieStatus.missing
                                  .filter(k => k !== 'x_query_id')
                                  .map(k => k.replace('x_', '').replace(/_/g, ' '))
                                  .join(', ')
                                }
                                {cookieStatus.missing.includes('x_query_id') && (
                                  <span className="text-[#71767B]">(query ID: auto-fetch)</span>
                                )}
                              </span>
                            </>
                          )}
                          {(apiLoginStatus?.missingCredentials && apiLoginStatus.missingCredentials.length > 0 && !apiLoginStatus.hasLoginCookie) && (
                            <>
                              <span className="text-[#71767B] hidden sm:inline">|</span>
                              <span className="text-amber-600">
                                API missing: {apiLoginStatus.missingCredentials.join(', ')}
                              </span>
                            </>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Post Method Rate (compact) */}
                    {postMethodStats && postMethodStats.total > 0 && (
                      <Card className="shadow-sm border-[#EFF3F4]">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Activity className="w-4 h-4 text-[#536471]" /> Post Method Rate
                            <span className="text-[10px] text-[#71767B] font-normal">
                              {postMethodStats.total} post terakhir
                            </span>
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {/* Direct */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-[#536471] flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full bg-green-500" />
                                Normal POST
                              </span>
                              <span className="text-xs font-bold text-[#0F1419]">{postMethodStats.directRate}%</span>
                            </div>
                            <div className="w-full bg-[#F7F9F9] rounded-full h-2">
                              <div
                                className="bg-green-500 h-2 rounded-full transition-all duration-500"
                                style={{ width: `${postMethodStats.directRate}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-[#71767B]">{postMethodStats.direct}/{postMethodStats.total} via direct cookie</span>
                          </div>
                          {/* Retry */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-[#536471] flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full bg-amber-500" />
                                Retry (226/empty)
                              </span>
                              <span className="text-xs font-bold text-[#0F1419]">{postMethodStats.retryRate}%</span>
                            </div>
                            <div className="w-full bg-[#F7F9F9] rounded-full h-2">
                              <div
                                className="bg-amber-500 h-2 rounded-full transition-all duration-500"
                                style={{ width: `${postMethodStats.retryRate}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-[#71767B]">{postMethodStats.retry}/{postMethodStats.total} setelah retry</span>
                          </div>
                          {/* Fallback */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-[#536471] flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full bg-purple-500" />
                                API Fallback
                              </span>
                              <span className="text-xs font-bold text-[#0F1419]">{postMethodStats.fallbackRate}%</span>
                            </div>
                            <div className="w-full bg-[#F7F9F9] rounded-full h-2">
                              <div
                                className="bg-purple-500 h-2 rounded-full transition-all duration-500"
                                style={{ width: `${postMethodStats.fallbackRate}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-[#71767B]">{postMethodStats.fallback}/{postMethodStats.total} via twitterapi.io</span>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* API Credits (compact) */}
                    {apiCredits.length > 0 && (
                      <Card className="shadow-sm border-[#EFF3F4]">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <BarChart3 className="w-4 h-4 text-purple-500" /> API Credits
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0 ml-1"
                              onClick={async () => {
                                setIsLoadingCredits(true)
                                await fetchStats()
                                setIsLoadingCredits(false)
                              }}
                            >
                              <RefreshCw className={`w-3 h-3 ${isLoadingCredits ? 'animate-spin' : ''}`} />
                            </Button>
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-1.5">
                            {apiCredits.map((credit, idx) => (
                              <div key={idx} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 bg-[#F7F9F9] rounded-lg p-2 border border-[#EFF3F4]">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-mono text-[#536471]">{credit.apiKey}</span>
                                  {credit.error && (
                                    <Badge variant="outline" className="text-[8px] px-1 bg-red-50 text-red-600 border-red-200">
                                      {credit.error}
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-1 sm:gap-2">
                                  <span className="text-[10px] text-[#71767B]">Bonus: {credit.bonusCredits}</span>
                                  <span className="text-[10px] font-medium text-[#3D4145]">Total: {credit.totalCredits}</span>
                                  <span className="text-[8px] text-[#71767B]">(~{Math.floor(credit.totalCredits / 300)} tweets)</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Filter Bar + Submission List */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                        {['all', 'pending', 'post_failed', 'rejected', 'posted'].map((status) => {
                          const statsKey = status === 'post_failed' ? 'postFailed' : status
                          const statusCount = status === 'all' ? stats?.total : stats?.[statsKey as keyof Stats] as number | undefined
                          return (
                            <button
                              key={status}
                              onClick={() => { setFilterStatus(status); setSubmissionsPage(1) }}
                              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all shrink-0 ${
                                filterStatus === status
                                  ? 'bg-[#0F1419] text-white'
                                  : 'bg-white border border-[#EFF3F4] text-[#536471] hover:bg-[#F7F9F9]'
                              }`}
                            >
                              {status === 'all' ? 'Semua' : statusConfig[status as keyof typeof statusConfig]?.label}
                              {statusCount != null && statusCount > 0 && (
                                <span className={`text-[10px] ${filterStatus === status ? 'text-white/70' : 'text-[#71767B]'}`}>
                                  {statusCount}
                                </span>
                              )}
                            </button>
                          )
                        })}
                        <div className="relative ml-2 shrink-0">
                          <Input
                            placeholder="Cari pesan..."
                            value={postSearch}
                            onChange={(e) => setPostSearch(e.target.value)}
                            className="pl-7 h-7 text-xs w-32 sm:w-44 border-[#EFF3F4]"
                          />
                          <Filter className="w-3 h-3 text-[#71767B] absolute left-2 top-1/2 -translate-y-1/2" />
                          {postSearch && (
                            <button
                              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#71767B] hover:text-[#0F1419] text-xs leading-none"
                              onClick={() => setPostSearch('')}
                            >
                              ×
                            </button>
                          )}
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => { fetchSubmissions(); fetchStats() }} className="ml-auto shrink-0 text-[#71767B] h-7 w-7 p-0">
                          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAdmin ? 'animate-spin' : ''}`} />
                        </Button>
                      </div>

                      <div className="space-y-3 max-h-[calc(100vh-260px)] overflow-y-auto pr-1">
                        {isLoadingAdmin ? (
                          <Card className="py-12">
                            <CardContent className="flex items-center justify-center gap-2 text-[#71767B]">
                              <Loader2 className="w-5 h-5 animate-spin" /> Memuat data...
                            </CardContent>
                          </Card>
                        ) : submissions.length === 0 ? (
                          <Card className="py-12">
                            <CardContent className="text-center">
                              <div className="w-12 h-12 rounded-xl bg-[#F7F9F9] flex items-center justify-center mx-auto mb-3">
                                <MessageSquare className="w-6 h-6 text-[#71767B]" />
                              </div>
                              <p className="text-[#536471]">Belum ada pesan</p>
                              <p className="text-xs text-[#71767B] mt-1">Pesan yang masuk akan muncul di sini</p>
                            </CardContent>
                          </Card>
                        ) : (
                          <>
                          <AnimatePresence mode="popLayout">
                            {(() => {
                              const filtered = submissions.filter((sub) => {
                                if (!postSearch) return true
                                const q = postSearch.toLowerCase()
                                return (
                                  sub.message.toLowerCase().includes(q) ||
                                  sub.submitter.username.toLowerCase().includes(q) ||
                                  (sub.submitter.displayName?.toLowerCase().includes(q) ?? false)
                                )
                              })
                              if (filtered.length === 0 && postSearch) {
                                return (
                                  <Card className="py-8" key="no-results">
                                    <CardContent className="text-center">
                                      <div className="w-10 h-10 rounded-xl bg-[#F7F9F9] flex items-center justify-center mx-auto mb-2">
                                        <Filter className="w-5 h-5 text-[#71767B]" />
                                      </div>
                                      <p className="text-sm text-[#536471]">Tidak ada hasil untuk &ldquo;{postSearch}&rdquo;</p>
                                      <Button variant="link" className="text-xs text-[#71767B] mt-1" onClick={() => setPostSearch('')}>Hapus pencarian</Button>
                                    </CardContent>
                                  </Card>
                                )
                              }
                              return filtered.map((sub) => {
                              const config = statusConfig[sub.status as keyof typeof statusConfig]
                              return (
                                <motion.div key={sub.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                                  <Card className="shadow-sm border-[#EFF3F4] hover:shadow-md transition-shadow">
                                    <CardContent className="p-4">
                                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 mb-2">
                                            {sub.submitter.profileImage ? (
                                              <img src={sub.submitter.profileImage} alt="" className="w-6 h-6 rounded-full border border-[#EFF3F4]" />
                                            ) : (
                                              <div className="w-6 h-6 rounded-full bg-[#272c30] flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                                                {sub.submitter.username.charAt(0).toUpperCase()}
                                              </div>
                                            )}
                                            <span className="text-xs font-medium text-[#536471]">
                                              @{sub.submitter.username}
                                            </span>
                                            {sub.submitter.twitterId && (
                                              <a
                                                href={`https://x.com/i/user/${sub.submitter.twitterId}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-[#536471] hover:underline flex items-center gap-0.5"
                                              >
                                                <XLogo className="w-3 h-3" />
                                              </a>
                                            )}
                                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${config.color}`}>
                                              {config.label}
                                            </Badge>
                                            {sub.status === 'posted' && sub.postMethod && sub.postMethod !== 'direct' && (
                                              <Badge variant="outline" className={`text-[8px] px-1 py-0 ${
                                                sub.postMethod === 'retry'
                                                  ? 'bg-amber-50 text-amber-600 border-amber-200'
                                                  : sub.postMethod === 'fallback'
                                                  ? 'bg-purple-50 text-purple-600 border-purple-200'
                                                  : 'bg-[#F7F9F9] text-[#536471] border-[#EFF3F4]'
                                              }`}>
                                                {sub.postMethod === 'retry' ? 'retry' : sub.postMethod === 'fallback' ? 'API' : sub.postMethod}
                                              </Badge>
                                            )}
                                          </div>
                                          <p className="text-sm text-[#0F1419] whitespace-pre-wrap break-words">{sub.message}</p>
                                          {sub.category && (
                                            <span className="inline-block text-xs text-[#71767B] mt-1">#{sub.category}</span>
                                          )}
                                          {/* Filter reasons */}
                                          {sub.filterReasons && (() => {
                                            try {
                                              const reasons: string[] = JSON.parse(sub.filterReasons)
                                              if (reasons.length === 0) return null
                                              return (
                                                <div className="flex flex-wrap gap-1 mt-1">
                                                  <Badge variant="outline" className="text-[8px] px-1 py-0 bg-amber-50 text-amber-700 border-amber-200 gap-0.5">
                                                    <ShieldAlert className="w-2.5 h-2.5" />
                                                    {reasons.length} filter flag{reasons.length > 1 ? 's' : ''}
                                                  </Badge>
                                                  {reasons.slice(0, 3).map((reason, i) => {
                                                    const label = reason.startsWith('blocked_word:')
                                                      ? `"${reason.replace('blocked_word:', '').replace(/(.).+(.)/, (_, a, b) => a + '***' + b)}"`
                                                      : reason.startsWith('ai:')
                                                      ? `AI: ${reason.replace('ai:', '')}`
                                                      : reason.startsWith('jualan:')
                                                      ? 'Jualan'
                                                      : reason === 'contains_url'
                                                      ? 'Link'
                                                      : reason.startsWith('contains_mention')
                                                      ? '@Mention'
                                                      : reason === 'contains_phone_number'
                                                      ? 'No. HP'
                                                      : reason === 'caps_spam'
                                                      ? 'ALL CAPS'
                                                      : reason === 'repeated_characters'
                                                      ? 'Spam chars'
                                                      : reason === 'too_short'
                                                      ? 'Terlalu pendek'
                                                      : reason === 'duplicate_24h'
                                                      ? 'Duplikat (24j)'
                                                      : reason
                                                    return (
                                                      <span key={i} className="text-[8px] px-1 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
                                                        {label}
                                                      </span>
                                                    )
                                                  })}
                                                  {reasons.length > 3 && (
                                                    <span className="text-[8px] text-[#71767B]">+{reasons.length - 3} more</span>
                                                  )}
                                                </div>
                                              )
                                            } catch {
                                              return null
                                            }
                                          })()}
                                          {/* Post error */}
                                          {sub.status === 'post_failed' && sub.postError && (
                                            <div className="flex items-start gap-1.5 mt-1.5 p-1.5 rounded-md bg-red-50 border border-red-200">
                                              <AlertCircle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
                                              <span className="text-[10px] text-red-700 leading-tight break-words">{sub.postError}</span>
                                            </div>
                                          )}
                                          <p className="text-[10px] text-[#71767B] mt-1">{formatDate(sub.createdAt)}</p>
                                          {sub.tweetId && (
                                            <a
                                              href={`https://x.com/i/status/${sub.tweetId}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-[10px] text-[#536471] hover:underline mt-0.5 inline-flex items-center gap-0.5"
                                            >
                                              Lihat tweet <ExternalLink className="w-2.5 h-2.5" />
                                            </a>
                                          )}
                                        </div>

                                        {/* Action buttons */}
                                        <div className="flex items-center gap-1 shrink-0 self-end sm:self-start">
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
                                          {sub.status === 'post_failed' && (
                                            <Button
                                              size="sm"
                                              onClick={() => handlePostToX(sub.id)}
                                              disabled={actionLoading === `post-${sub.id}`}
                                              className="h-7 px-2 text-xs bg-[#0F1419] hover:bg-[#272c30] text-white"
                                            >
                                              {actionLoading === `post-${sub.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <XLogo className="w-3 h-3 mr-1" />}
                                              Retry Post
                                            </Button>
                                          )}
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => handleDelete(sub.id)}
                                            disabled={actionLoading === `del-${sub.id}`}
                                            className="h-7 w-7 p-0 text-[#71767B] hover:text-red-500"
                                          >
                                            {actionLoading === `del-${sub.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <span className="text-xs">&times;</span>}
                                          </Button>
                                        </div>
                                      </div>
                                    </CardContent>
                                  </Card>
                                </motion.div>
                              )
                            })
                            })()}
                          </AnimatePresence>
                          {submissionsHasMore && (
                            <div className="flex justify-center py-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs"
                                onClick={() => fetchSubmissions(undefined, false, submissionsPage + 1)}
                              >
                                Muat lebih banyak {'('}{submissions.length}/{submissionsTotal}{')'}
                              </Button>
                            </div>
                          )}
                          </>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* ===== SETTINGS SUB-TAB ===== */}
                {adminSubTab === 'settings' && (
                  <motion.div
                    key="settings"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-4"
                  >
                    {/* Section 1: Direct Posting (Cookie Method) */}
                    <Collapsible open={directPostingOpen} onOpenChange={setDirectPostingOpen}>
                      <Card className="shadow-sm border-[#EFF3F4]">
                        <CollapsibleTrigger asChild>
                          <CardHeader className="pb-3 cursor-pointer hover:bg-[#F7F9F9]/50 rounded-t-lg transition-colors">
                            <CardTitle className="text-base flex items-center gap-2">
                              <Settings className="w-4 h-4 text-[#536471]" /> Direct Posting (Cookie Method)
                              {cookieStatus?.configured ? (
                                <Badge variant="outline" className="text-[10px] px-1.5 bg-green-50 text-green-700 border-green-300">
                                  <CircleDot className="w-2.5 h-2.5 mr-1 fill-green-500 text-green-500" />
                                  Connected
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] px-1.5 bg-red-50 text-red-700 border-red-300">
                                  <CircleDot className="w-2.5 h-2.5 mr-1 fill-red-500 text-red-500" />
                                  Not configured
                                </Badge>
                              )}
                              <ChevronDown className={`w-4 h-4 text-[#71767B] ml-auto transition-transform ${directPostingOpen ? 'rotate-180' : ''}`} />
                            </CardTitle>
                          </CardHeader>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <CardContent className="space-y-4">
                            {/* Cookie String */}
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-[#536471]">Cookie String</label>
                              <div className="flex flex-col sm:flex-row gap-2">
                                <div className="flex-1 relative">
                                  <Input
                                    type={showCookieValue ? 'text' : 'password'}
                                    placeholder="auth_token=...; ct0=...; ..."
                                    value={cookieString}
                                    onChange={(e) => setCookieString(e.target.value)}
                                    className="pr-10 border-[#EFF3F4]"
                                  />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="absolute right-1 top-1 h-7 w-7 p-0"
                                    onClick={() => setShowCookieValue(!showCookieValue)}
                                  >
                                    {showCookieValue ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                  </Button>
                                </div>
                                <Button
                                  onClick={() => handleSaveSetting('x_cookie_string', cookieString, () => setCookieString(''))}
                                  disabled={!!isSavingSetting || !cookieString.trim()}
                                  className="bg-[#0F1419] hover:bg-[#272c30]"
                                >
                                  {isSavingSetting === 'x_cookie_string' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Simpan'}
                                </Button>
                              </div>
                              <button
                                onClick={() => setShowCookieGuide(!showCookieGuide)}
                                className="text-xs text-[#536471] hover:underline flex items-center gap-1"
                              >
                                <ChevronDown className={`w-3 h-3 transition-transform ${showCookieGuide ? 'rotate-180' : ''}`} />
                                Cara mendapatkan cookie string
                              </button>
                              {showCookieGuide && (
                                <div className="bg-[#F7F9F9] rounded-lg p-3 text-xs text-[#536471] space-y-2 border border-[#EFF3F4]">
                                  <ol className="list-decimal list-inside space-y-1">
                                    <li>Login ke <strong>x.com</strong> di browser (Chrome/Firefox)</li>
                                    <li>Tekan <kbd className="bg-[#EFF3F4] px-1 rounded">F12</kbd> → tab <strong>Application</strong></li>
                                    <li>Klik <strong>Cookies</strong> → <strong>https://x.com</strong></li>
                                    <li>Temukan baris <code className="bg-[#EFF3F4] px-1 rounded">auth_token</code> → copy value-nya</li>
                                    <li>Temukan baris <code className="bg-[#EFF3F4] px-1 rounded">ct0</code> → copy value-nya</li>
                                    <li>Temukan baris <code className="bg-[#EFF3F4] px-1 rounded">guest_id</code> → copy value-nya</li>
                                    <li>Gabungkan: <code className="bg-[#EFF3F4] px-1 rounded">auth_token=...; ct0=...; guest_id=...</code></li>
                                    <li>Paste di atas, lalu klik <strong>Simpan</strong></li>
                                  </ol>
                                  <div className="flex items-start gap-1.5 text-amber-600 pt-1">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                    <span>Gunakan akun X yang ingin kamu jadikan autobase! Cookie dari akun lain tidak akan bekerja.</span>
                                  </div>
                                  <div className="flex items-start gap-1.5 text-[#536471] pt-1">
                                    <Zap className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                    <span>Sertikan semua cookie dari browser untuk hasil terbaik. Cookie yang lengkap membuat request lebih mirip browser asli.</span>
                                  </div>
                                </div>
                              )}
                            </div>

                            <Separator />

                            {/* Bearer Token */}
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-[#536471]">Bearer Token</label>
                              <div className="flex flex-col sm:flex-row gap-2">
                                <div className="flex-1 relative">
                                  <Input
                                    type={showBearerValue ? 'text' : 'password'}
                                    placeholder="AAAAAAAAAAAAAAAAAAAAANRILg..."
                                    value={bearerToken}
                                    onChange={(e) => setBearerToken(e.target.value)}
                                    className="pr-10 border-[#EFF3F4]"
                                  />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="absolute right-1 top-1 h-7 w-7 p-0"
                                    onClick={() => setShowBearerValue(!showBearerValue)}
                                  >
                                    {showBearerValue ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                  </Button>
                                </div>
                                <Button
                                  onClick={() => handleSaveSetting('x_bearer_token', bearerToken, () => setBearerToken(''))}
                                  disabled={!!isSavingSetting || !bearerToken.trim()}
                                  className="bg-[#0F1419] hover:bg-[#272c30]"
                                >
                                  {isSavingSetting === 'x_bearer_token' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Simpan'}
                                </Button>
                              </div>
                              <button
                                onClick={() => setShowBearerGuide(!showBearerGuide)}
                                className="text-xs text-[#536471] hover:underline flex items-center gap-1"
                              >
                                <ChevronDown className={`w-3 h-3 transition-transform ${showBearerGuide ? 'rotate-180' : ''}`} />
                                Cara mendapatkan Bearer Token
                              </button>
                              {showBearerGuide && (
                                <div className="bg-[#F7F9F9] rounded-lg p-3 text-xs text-[#536471] space-y-2 border border-[#EFF3F4]">
                                  <ol className="list-decimal list-inside space-y-1">
                                    <li>Login ke <strong>x.com</strong> di browser</li>
                                    <li>Tekan <kbd className="bg-[#EFF3F4] px-1 rounded">F12</kbd> → tab <strong>Network</strong></li>
                                    <li>Lakukan aksi apapun (scroll, like, dll)</li>
                                    <li>Klik salah satu request ke <code className="bg-[#EFF3F4] px-1 rounded">/i/api/</code></li>
                                    <li>Cek header <strong>Authorization</strong> → copy value setelah <code className="bg-[#EFF3F4] px-1 rounded">Bearer </code></li>
                                    <li>Paste di atas, lalu klik <strong>Simpan</strong></li>
                                  </ol>
                                  <p className="text-[#71767B] pt-1">Token ini sama untuk semua user X (public consumer token). Jarang berubah.</p>
                                </div>
                              )}
                            </div>

                            <Separator />

                            {/* Query ID (auto-fetch, manual fallback) */}
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <label className="text-xs font-medium text-[#536471]">Query ID</label>
                                <Badge variant="outline" className="text-[9px] px-1 py-0 bg-[#F7F9F9] text-[#536471] border-[#EFF3F4]">
                                  Auto-fetch
                                </Badge>
                              </div>
                              <div className="flex flex-col sm:flex-row gap-2">
                                <Input
                                  type="text"
                                  placeholder="Manual fallback (optional)"
                                  value={queryId}
                                  onChange={(e) => setQueryId(e.target.value)}
                                  className="border-[#EFF3F4]"
                                />
                                <Button
                                  onClick={() => handleSaveSetting('x_query_id', queryId, () => setQueryId(''))}
                                  disabled={!!isSavingSetting || !queryId.trim()}
                                  className="bg-[#0F1419] hover:bg-[#272c30]"
                                >
                                  {isSavingSetting === 'x_query_id' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Simpan'}
                                </Button>
                              </div>
                              <button
                                onClick={() => setShowQueryIdGuide(!showQueryIdGuide)}
                                className="text-xs text-[#536471] hover:underline flex items-center gap-1"
                              >
                                <ChevronDown className={`w-3 h-3 transition-transform ${showQueryIdGuide ? 'rotate-180' : ''}`} />
                                Tentang auto-fetch & manual fallback
                              </button>
                              {showQueryIdGuide && (
                                <div className="bg-[#F7F9F9] rounded-lg p-3 text-xs text-[#536471] space-y-2 border border-[#EFF3F4]">
                                  <p>Query ID otomatis di-fetch dari JS bundle X sebelum setiap post. Kamu <strong>tidak perlu mengisi ini manual</strong>.</p>
                                  <p>Isi manual hanya jika auto-fetch gagal (jarang terjadi). Cara manual:</p>
                                  <ol className="list-decimal list-inside space-y-1">
                                    <li>Step 1 — ambil nama bundle terbaru:<br />
                                      <code className="bg-[#EFF3F4] px-1 rounded text-[10px]">curl -sL &apos;https://x.com&apos; | grep -oP &apos;main\.[a-z0-9]+\.js&apos; | head -1</code>
                                    </li>
                                    <li>Step 2 — extract dari bundle tersebut:<br />
                                      <code className="bg-[#EFF3F4] px-1 rounded text-[10px] break-all">curl -sL &apos;https://abs.twimg.com/responsive-web/client-web/&lt;BUNDLE&gt;.js&apos; | grep -oP &apos;queryId:&quot;[^&quot;]+&quot;,operationName:&quot;CreateTweet&apos;</code>
                                    </li>
                                    <li>Copy value setelah <code className="bg-[#EFF3F4] px-1 rounded">queryId:</code> → paste di atas</li>
                                  </ol>
                                </div>
                              )}
                            </div>

                            <Separator />

                            {/* Clear Cache + Last Updated */}
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                              <div className="space-y-1">
                                <div className="text-xs text-[#536471]">
                                  <span className="font-medium">Cache</span> — queryId & transaction ID di-cache di memori (4 jam). Bersihkan jika X update frontend-nya.
                                </div>
                                {cookieStatus?.lastUpdated && (
                                  <span className="text-[10px] text-[#71767B]">
                                    Terakhir diperbarui: {new Date(cookieStatus.lastUpdated).toLocaleString('id-ID')}
                                  </span>
                                )}
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={async () => {
                                  setIsClearingCache(true)
                                  try {
                                    const res = await fetch('/api/admin/clear-cache', {
                                      method: 'POST',
                                      headers: { authorization: `Bearer ${adminToken}` },
                                    })
                                    if (res.ok) {
                                      toast({ title: 'Cache dibersihkan!', description: 'Query ID & transaction ID cache telah direset.' })
                                    } else {
                                      toast({ title: 'Gagal', description: 'Tidak dapat membersihkan cache', variant: 'destructive' })
                                    }
                                  } catch {
                                    toast({ title: 'Error', description: 'Tidak dapat terhubung ke server', variant: 'destructive' })
                                  } finally {
                                    setIsClearingCache(false)
                                  }
                                }}
                                disabled={isClearingCache}
                                className="border-[#EFF3F4] text-[#536471] shrink-0"
                              >
                                {isClearingCache ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5 mr-1" />}
                                Clear Cache
                              </Button>
                            </div>
                          </CardContent>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>

                    {/* Section 2: API Fallback (twitterapi.io) */}
                    <Collapsible open={apiFallbackOpen} onOpenChange={setApiFallbackOpen}>
                      <Card className="shadow-sm border-[#EFF3F4]">
                        <CollapsibleTrigger asChild>
                          <CardHeader className="pb-3 cursor-pointer hover:bg-[#F7F9F9]/50 rounded-t-lg transition-colors">
                            <CardTitle className="text-base flex items-center gap-2">
                              <Key className="w-4 h-4 text-purple-500" /> API Fallback (twitterapi.io)
                              {apiLoginStatus?.hasLoginCookie ? (
                                <Badge variant="outline" className="text-[10px] px-1.5 bg-green-50 text-green-700 border-green-300">
                                  <CircleDot className="w-2.5 h-2.5 mr-1 fill-green-500 text-green-500" />
                                  Logged in
                                </Badge>
                              ) : apiLoginStatus?.hasCredentials ? (
                                <Badge variant="outline" className="text-[10px] px-1.5 bg-amber-50 text-amber-700 border-amber-300">
                                  <CircleDot className="w-2.5 h-2.5 mr-1 fill-amber-500 text-amber-500" />
                                  Need login
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] px-1.5 bg-[#F7F9F9] text-[#536471] border-[#EFF3F4]">
                                  <CircleDot className="w-2.5 h-2.5 mr-1 fill-[#71767B] text-[#71767B]" />
                                  Not configured
                                </Badge>
                              )}
                              <ChevronDown className={`w-4 h-4 text-[#71767B] ml-auto transition-transform ${apiFallbackOpen ? 'rotate-180' : ''}`} />
                            </CardTitle>
                          </CardHeader>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <CardContent className="space-y-4">
                            {/* Post Method Toggle */}
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-[#536471]">Post Method</label>
                              <div className="flex flex-wrap gap-2">
                                {([
                                  { value: 'direct', label: 'Direct', desc: 'Cookie only' },
                                  { value: 'auto', label: 'Auto', desc: 'Cookie → Retry → API' },
                                  { value: 'api', label: 'API Only', desc: 'TwitterAPI.io only' },
                                ] as const).map((opt) => (
                                  <Button
                                    key={opt.value}
                                    size="sm"
                                    variant={postMethodSetting === opt.value ? 'default' : 'outline'}
                                    onClick={() => {
                                      setPostMethodSetting(opt.value)
                                      handleSaveSetting('post_method', opt.value)
                                    }}
                                    className={`text-xs h-8 ${postMethodSetting === opt.value ? 'bg-purple-500 hover:bg-purple-600' : 'border-[#EFF3F4]'}`}
                                  >
                                    {opt.label}
                                  </Button>
                                ))}
                              </div>
                              <p className="text-[10px] text-[#71767B]">
                                {postMethodSetting === 'direct' && 'Hanya cookie-based posting, tanpa fallback.'}
                                {postMethodSetting === 'auto' && 'Coba direct → retry 226/empty → fallback ke API jika gagal.'}
                                {postMethodSetting === 'api' && 'Selalu gunakan twitterapi.io (untuk testing).'}
                              </p>
                            </div>

                            {/* X Login Credentials — Single Save */}
                            <div className="space-y-3 p-4 bg-amber-50/50 rounded-lg border border-amber-100">
                              <label className="text-xs font-medium text-[#536471] flex items-center gap-1.5">
                                <User className="w-3 h-3" /> X Login Credentials
                                <span className="text-[10px] text-amber-600 font-normal">(required for API fallback)</span>
                              </label>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {/* X Username */}
                                <Input
                                  placeholder="X username"
                                  value={xUsername}
                                  onChange={(e) => setXUsername(e.target.value)}
                                  className="border-[#EFF3F4] text-xs"
                                />

                                {/* X Email */}
                                <Input
                                  placeholder="X email"
                                  type="email"
                                  value={xEmail}
                                  onChange={(e) => setXEmail(e.target.value)}
                                  className="border-[#EFF3F4] text-xs"
                                />

                                {/* X Password */}
                                <div className="relative">
                                  <Input
                                    placeholder="X password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={xPassword}
                                    onChange={(e) => setXPassword(e.target.value)}
                                    className="border-[#EFF3F4] text-xs pr-8"
                                  />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 p-0"
                                    onClick={() => setShowPassword(!showPassword)}
                                  >
                                    {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                  </Button>
                                </div>

                                {/* 2FA Secret (TOTP) */}
                                <div className="relative">
                                  <Input
                                    placeholder="2FA secret (TOTP base32 seed)"
                                    type={showTotpSecret ? 'text' : 'password'}
                                    value={xTotpSecret}
                                    onChange={(e) => setXTotpSecret(e.target.value)}
                                    className="border-[#EFF3F4] text-xs pr-8"
                                  />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 p-0"
                                    onClick={() => setShowTotpSecret(!showTotpSecret)}
                                  >
                                    {showTotpSecret ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                  </Button>
                                </div>
                              </div>

                              {/* Single Save All Button */}
                              <Button
                                onClick={handleSaveAllCredentials}
                                disabled={isSavingAllCredentials || !!isSavingSetting || (!xUsername.trim() && !xEmail.trim() && !xPassword.trim() && !xTotpSecret.trim())}
                                className="w-full bg-amber-500 hover:bg-amber-600 text-white"
                              >
                                {isSavingAllCredentials ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Key className="w-4 h-4 mr-2" />}
                                {isSavingAllCredentials ? 'Menyimpan...' : 'Save All Credentials'}
                              </Button>

                              <p className="text-[10px] text-[#71767B]">
                                Semua field disimpan terenkripsi. Untuk mendapatkan TOTP secret: X → Settings → Security → 2FA → Authentication App → &quot;Can&apos;t scan the QR code?&quot; → copy the base32 string.
                              </p>
                            </div>

                            {/* API Keys */}
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-[#536471] flex items-center gap-1.5">
                                <Key className="w-3 h-3" /> API Keys (JSON array)
                              </label>
                              <div className="flex flex-col sm:flex-row gap-2">
                                <Input
                                  placeholder='["key1","key2","key3"]'
                                  value={apiKeys}
                                  onChange={(e) => setApiKeys(e.target.value)}
                                  className="border-[#EFF3F4] text-xs"
                                />
                                <Button
                                  onClick={() => handleSaveSetting('twitterapi_keys', apiKeys, () => setApiKeys(''))}
                                  disabled={!!isSavingSetting || !apiKeys.trim()}
                                  className="bg-purple-500 hover:bg-purple-600 shrink-0"
                                >
                                  {isSavingSetting === 'twitterapi_keys' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                                </Button>
                              </div>
                              <p className="text-[10px] text-[#71767B]">
                                Format: JSON array. Setiap key ~33 tweet gratis (10k credits).
                              </p>
                            </div>

                            {/* Proxy */}
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-[#536471] flex items-center gap-1.5">
                                <Globe className="w-3 h-3" /> Proxy URL (required)
                              </label>
                              <div className="flex flex-col sm:flex-row gap-2">
                                <Input
                                  placeholder="http://user:pass@ip:port"
                                  value={apiProxy}
                                  onChange={(e) => setApiProxy(e.target.value)}
                                  className="border-[#EFF3F4] text-xs"
                                />
                                <Button
                                  onClick={() => handleSaveSetting('twitterapi_proxy', apiProxy, () => setApiProxy(''))}
                                  disabled={!!isSavingSetting || !apiProxy.trim()}
                                  variant="outline"
                                  className="border-purple-200 text-purple-700 hover:bg-purple-50 shrink-0"
                                >
                                  {isSavingSetting === 'twitterapi_proxy' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                                </Button>
                              </div>
                              <p className="text-[10px] text-[#71767B]">
                                Wajib untuk user_login_v2. Gunakan residential proxy (contoh: Webshare). Proxy digunakan oleh twitterapi.io saat login ke X.
                              </p>
                            </div>

                            {/* Login Cookie Status */}
                            {apiLoginStatus && (
                              <div className="space-y-2">
                                <label className="text-xs font-medium text-[#536471] flex items-center gap-1.5">
                                  <Shield className="w-3 h-3" /> API Login Status
                                </label>
                                <div className="flex items-center gap-2 bg-[#F7F9F9] rounded-lg p-2 border border-[#EFF3F4]">
                                  {apiLoginStatus.hasLoginCookie ? (
                                    <>
                                      <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-300">
                                        ✅ Active
                                      </Badge>
                                      {apiLoginStatus.lastLoginAt && (
                                        <span className="text-[10px] text-[#71767B]">
                                          Last login: {new Date(apiLoginStatus.lastLoginAt).toLocaleString('id-ID')}
                                        </span>
                                      )}
                                    </>
                                  ) : apiLoginStatus.hasCredentials ? (
                                    <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-300">
                                      ⚠️ Not logged in — will auto-login on first post
                                    </Badge>
                                  ) : (
                                    <span className="text-[10px] text-[#71767B]">
                                      Enter X credentials above to enable API login
                                    </span>
                                  )}
                                </div>
                                {apiLoginStatus.missingCredentials.length > 0 && (
                                  <p className="text-[10px] text-amber-600">
                                    Missing: {apiLoginStatus.missingCredentials.join(', ')}
                                  </p>
                                )}
                              </div>
                            )}

                            {/* Credit Status */}
                            {apiCredits.length > 0 && (
                              <div className="space-y-2">
                                <label className="text-xs font-medium text-[#536471] flex items-center gap-1.5">
                                  <BarChart3 className="w-3 h-3" /> Credit Status
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-5 w-5 p-0 ml-1"
                                    onClick={async () => {
                                      setIsLoadingCredits(true)
                                      await fetchStats()
                                      setIsLoadingCredits(false)
                                    }}
                                  >
                                    <RefreshCw className={`w-3 h-3 ${isLoadingCredits ? 'animate-spin' : ''}`} />
                                  </Button>
                                </label>
                                <div className="space-y-1.5">
                                  {apiCredits.map((credit, idx) => (
                                    <div key={idx} className="flex items-center justify-between bg-[#F7F9F9] rounded-lg p-2 border border-[#EFF3F4]">
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-mono text-[#536471]">{credit.apiKey}</span>
                                        {credit.error && (
                                          <Badge variant="outline" className="text-[8px] px-1 bg-red-50 text-red-600 border-red-200">
                                            {credit.error}
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-[#71767B]">Bonus: {credit.bonusCredits}</span>
                                        <span className="text-[10px] font-medium text-[#3D4145]">Total: {credit.totalCredits}</span>
                                        <span className="text-[8px] text-[#71767B]">(~{Math.floor(credit.totalCredits / 300)} tweets)</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>

                    {/* Section 3: Filter & Auto-Approve */}
                    <Collapsible open={filterOpen} onOpenChange={setFilterOpen}>
                      <Card className="shadow-sm border-[#EFF3F4]">
                        <CollapsibleTrigger asChild>
                          <CardHeader className="pb-3 cursor-pointer hover:bg-[#F7F9F9]/50 rounded-t-lg transition-colors">
                            <CardTitle className="text-base flex items-center gap-2">
                              <Filter className="w-4 h-4 text-[#536471]" /> Filter & Auto-Approve
                              {autoApprove ? (
                                <Badge variant="outline" className="text-[10px] px-1.5 bg-green-50 text-green-700 border-green-300">
                                  <ShieldCheck className="w-2.5 h-2.5 mr-1" />
                                  Auto-Approve ON
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] px-1.5 bg-[#F7F9F9] text-[#71767B] border-[#EFF3F4]">
                                  Manual Review
                                </Badge>
                              )}
                              {geminiEnabled && geminiApiKeySet && (
                                <Badge variant="outline" className="text-[9px] px-1 py-0 bg-purple-50 text-purple-700 border-purple-200 gap-0.5">
                                  <Sparkles className="w-2.5 h-2.5" /> Gemini
                                </Badge>
                              )}
                              <ChevronDown className={`w-4 h-4 text-[#71767B] ml-auto transition-transform ${filterOpen ? 'rotate-180' : ''}`} />
                            </CardTitle>
                          </CardHeader>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <CardContent className="space-y-4">
                            {/* Auto-Approve Toggle */}
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <label className="text-xs font-medium text-[#536471]">Auto-Approve</label>
                                <button
                                  onClick={() => {
                                    const newVal = !autoApprove
                                    setAutoApprove(newVal)
                                  }}
                                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoApprove ? 'bg-green-500' : 'bg-[#EFF3F4]'}`}
                                >
                                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${autoApprove ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                              </div>
                              {autoApprove && (
                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-700 flex items-start gap-1.5">
                                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                  <span>Submissions that pass the filter will be <strong>auto-posted to X</strong> without admin review. Flagged submissions still need manual approval.</span>
                                </div>
                              )}
                            </div>

                            <Separator />

                            {/* Blocked Words */}
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-[#536471] flex items-center justify-between">
                                <span>Blocked Words</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 text-[10px] text-[#71767B] hover:text-[#0F1419]"
                                  onClick={() => {
                                    // Reset to default
                                    setBlockedWordsText(DEFAULT_BLOCKED_WORDS.join(', '))
                                  }}
                                >
                                  <RotateCcw className="w-3 h-3 mr-1" /> Reset Default
                                </Button>
                              </label>
                              <Textarea
                                placeholder="kontol, memek, ngentot, wts, wtb, ..."
                                value={blockedWordsText}
                                onChange={(e) => setBlockedWordsText(e.target.value)}
                                className="min-h-[100px] resize-y border-[#EFF3F4] text-xs"
                              />
                              <p className="text-[10px] text-[#71767B]">
                                Comma-separated. Matches whole words only (case-insensitive). Submissions containing these words will be flagged for manual review.
                              </p>
                            </div>

                            <Separator />

                            {/* NSFW Words */}
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-[#536471] flex items-center justify-between">
                                <span>NSFW Words</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 text-[10px] text-[#71767B] hover:text-[#0F1419]"
                                  onClick={() => {
                                    setNsfwWordsText(DEFAULT_NSFW_WORDS.join(', '))
                                  }}
                                >
                                  <RotateCcw className="w-3 h-3 mr-1" /> Reset Default
                                </Button>
                              </label>
                              <Textarea
                                placeholder="bokep, telanjang, milf, ..."
                                value={nsfwWordsText}
                                onChange={(e) => setNsfwWordsText(e.target.value)}
                                className="min-h-[80px] resize-y border-[#EFF3F4] text-xs"
                              />
                              <p className="text-[10px] text-[#71767B]">
                                Comma-separated. Used when "Block NSFW/explicit content" rule is ON.
                              </p>
                            </div>

                            <Separator />

                            {/* Filter Rules */}
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-[#536471]">Filter Rules</label>
                              <div className="space-y-2">
                                {/* Toggleable rules */}
                                {[
                                  { key: 'blockedWords' as const, label: 'Block profanity & blocked words', desc: 'Match against the blocked words list above' },
                                  { key: 'jualan' as const, label: 'Block jualan/promosi (WTS/WTB/WTT/LF)', desc: 'Marketplace tags are not confessions' },
                                  { key: 'urls' as const, label: 'Block links/URLs', desc: 'Prevents spam links and phishing' },
                                  { key: 'mentions' as const, label: 'Block @mentions', desc: 'Prevents targeted harassment via @username' },
                                  { key: 'phoneNumbers' as const, label: 'Block phone numbers', desc: 'Prevents doxxing and privacy leaks' },
                                  { key: 'nsfw' as const, label: 'Block NSFW/explicit content', desc: 'OFF by default for Alter menfess — toggle on if needed', defaultOff: true },
                                ].map((rule) => (
                                  <div key={rule.key} className="flex items-center justify-between bg-[#F7F9F9] rounded-lg p-2 border border-[#EFF3F4]">
                                    <div>
                                      <span className="text-xs font-medium text-[#0F1419]">{rule.label}</span>
                                      <p className="text-[10px] text-[#71767B]">{rule.desc}</p>
                                    </div>
                                    <button
                                      onClick={() => setFilterRules({ ...filterRules, [rule.key]: !filterRules[rule.key] })}
                                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ml-2 ${filterRules[rule.key] ? 'bg-green-500' : 'bg-[#EFF3F4]'}`}
                                    >
                                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${filterRules[rule.key] ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                    </button>
                                  </div>
                                ))}

                                {/* Always-on rules (not toggleable) */}
                                <div className="mt-2">
                                  <p className="text-[10px] text-[#71767B] mb-1.5">Always on (cannot be disabled):</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {[
                                      { key: 'capsSpam', label: 'ALL CAPS spam' },
                                      { key: 'repeatedChars', label: 'Repeated chars' },
                                      { key: 'tooShort', label: 'Too short (&lt;5)' },
                                      { key: 'duplicate24h', label: 'Duplicate (24h)' },
                                    ].map((rule) => (
                                      <Badge key={rule.key} variant="outline" className="text-[9px] px-1.5 py-0 bg-[#F7F9F9] text-[#536471] border-[#EFF3F4] gap-0.5">
                                        <ShieldCheck className="w-2.5 h-2.5 text-green-500" />
                                        {rule.label}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>

                            <Separator />

                            {/* Gemini AI Filter */}
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <label className="text-xs font-medium text-[#536471] flex items-center gap-1.5">
                                  <Sparkles className="w-3.5 h-3.5" /> Gemini AI Filter
                                  {geminiEnabled && geminiApiKeySet && (
                                    <Badge variant="outline" className="text-[8px] px-1 py-0 bg-green-50 text-green-700 border-green-300">
                                      Active
                                    </Badge>
                                  )}
                                  {geminiEnabled && !geminiApiKeySet && (
                                    <Badge variant="outline" className="text-[8px] px-1 py-0 bg-amber-50 text-amber-700 border-amber-300">
                                      No API Key
                                    </Badge>
                                  )}
                                </label>
                                <button
                                  onClick={() => setGeminiEnabled(!geminiEnabled)}
                                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${geminiEnabled ? 'bg-green-500' : 'bg-[#EFF3F4]'}`}
                                >
                                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${geminiEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                              </div>
                              <p className="text-[10px] text-[#71767B]">
                                Uses Gemini AI for nuanced content moderation — catches coded language, subtle harassment, and context-dependent hate speech that word filters miss.
                                {!geminiApiKeySet && ' Works even without an API key — just uses rule-based filter only.'}
                              </p>
                              {geminiEnabled && !geminiApiKeySet && (
                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[10px] text-amber-700 flex items-start gap-1.5">
                                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                                  <span>Set your Gemini API key below to enable AI filtering. Without a key, only rule-based filter will be used.</span>
                                </div>
                              )}
                              <div className="flex flex-col sm:flex-row gap-2">
                                <div className="flex-1 relative">
                                  <Input
                                    type={showGeminiKey ? 'text' : 'password'}
                                    placeholder={geminiApiKeySet ? 'Key is set — enter new key to replace' : 'AIzaSy...'}
                                    value={geminiApiKeyInput}
                                    onChange={(e) => setGeminiApiKeyInput(e.target.value)}
                                    className="pr-10 border-[#EFF3F4] text-xs"
                                  />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="absolute right-1 top-1 h-6 w-6 p-0"
                                    onClick={() => setShowGeminiKey(!showGeminiKey)}
                                  >
                                    {showGeminiKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                  </Button>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs border-[#EFF3F4] h-8"
                                  disabled={!geminiApiKeyInput.trim()}
                                  onClick={async () => {
                                    try {
                                      const res = await fetch('/api/admin/filter-settings', {
                                        method: 'POST',
                                        headers: {
                                          'Content-Type': 'application/json',
                                          authorization: `Bearer ${adminToken}`,
                                        },
                                        body: JSON.stringify({ geminiApiKey: geminiApiKeyInput.trim() }),
                                      })
                                      if (res.ok) {
                                        setGeminiApiKeyInput('')
                                        setGeminiApiKeySet(true)
                                        toast({ title: 'Gemini API key saved!' })
                                        fetchStats()
                                      } else {
                                        const data = await res.json()
                                        toast({ title: 'Failed', description: data.error, variant: 'destructive' })
                                      }
                                    } catch {
                                      toast({ title: 'Error', description: 'Failed to save API key', variant: 'destructive' })
                                    }
                                  }}
                                >
                                  Save Key
                                </Button>
                              </div>
                              {geminiApiKeySet && (
                                <p className="text-[10px] text-green-600 flex items-center gap-1">
                                  <ShieldCheck className="w-3 h-3" /> API key is configured
                                </p>
                              )}
                              <div className="bg-[#F7F9F9] rounded-lg p-2 border border-[#EFF3F4] space-y-1">
                                <p className="text-[10px] font-medium text-[#536471]">How it works:</p>
                                <ul className="text-[10px] text-[#71767B] space-y-0.5 list-disc list-inside">
                                  <li>Runs <strong>after</strong> rule-based filter passes (saves API calls)</li>
                                  <li>If Gemini is down or errors → submission goes to pending (admin reviews)</li>
                                  <li>Only blocks genuinely harmful content (hate speech, threats, doxxing)</li>
                                  <li>Does NOT block typical alter content (venting, profanity, drama)</li>
                                </ul>
                              </div>
                            </div>

                            <Separator />

                            {/* Rate Limiting */}
                            <div className="space-y-3">
                              <div className="flex items-center gap-2">
                                <Clock className="w-4 h-4 text-[#536471]" />
                                <span className="text-sm font-semibold text-[#0F1419]">Rate Limiting</span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                <div>
                                  <label className="text-[10px] font-medium text-[#536471] block mb-1">Cooldown (menit)</label>
                                  <Input
                                    type="number"
                                    min={0}
                                    max={60}
                                    value={rateLimits.submissionCooldown}
                                    onChange={(e) => setRateLimits({ ...rateLimits, submissionCooldown: parseInt(e.target.value) || 0 })}
                                    className="text-xs h-8"
                                  />
                                  <p className="text-[9px] text-[#71767B] mt-0.5">Antar pesan per user</p>
                                </div>
                                <div>
                                  <label className="text-[10px] font-medium text-[#536471] block mb-1">Batas harian</label>
                                  <Input
                                    type="number"
                                    min={1}
                                    max={100}
                                    value={rateLimits.submissionDailyCap}
                                    onChange={(e) => setRateLimits({ ...rateLimits, submissionDailyCap: parseInt(e.target.value) || 1 })}
                                    className="text-xs h-8"
                                  />
                                  <p className="text-[9px] text-[#71767B] mt-0.5">Pesan/user/hari</p>
                                </div>
                                <div>
                                  <label className="text-[10px] font-medium text-[#536471] block mb-1">Batas antrean/user</label>
                                  <Input
                                    type="number"
                                    min={1}
                                    max={50}
                                    value={rateLimits.userPendingCap}
                                    onChange={(e) => setRateLimits({ ...rateLimits, userPendingCap: parseInt(e.target.value) || 1 })}
                                    className="text-xs h-8"
                                  />
                                  <p className="text-[9px] text-[#71767B] mt-0.5">Maks pesan pending per user</p>
                                </div>
                                <div>
                                  <label className="text-[10px] font-medium text-[#536471] block mb-1">Batas harian global</label>
                                  <Input
                                    type="number"
                                    min={0}
                                    max={10000}
                                    value={rateLimits.globalSubmissionDailyCap}
                                    onChange={(e) => setRateLimits({ ...rateLimits, globalSubmissionDailyCap: parseInt(e.target.value) || 0 })}
                                    className="text-xs h-8"
                                  />
                                  <p className="text-[9px] text-[#71767B] mt-0.5">Maks pesan dari semua user/hari</p>
                                </div>
                                <div>
                                  <label className="text-[10px] font-medium text-[#536471] block mb-1">Auto-post jeda (detik)</label>
                                  <Input
                                    type="number"
                                    min={0}
                                    max={120}
                                    value={rateLimits.autoPostCooldown}
                                    onChange={(e) => setRateLimits({ ...rateLimits, autoPostCooldown: parseInt(e.target.value) || 0 })}
                                    className="text-xs h-8"
                                  />
                                  <p className="text-[9px] text-[#71767B] mt-0.5">Antar tweet ke X</p>
                                </div>
                                <div>
                                  <label className="text-[10px] font-medium text-[#536471] block mb-1">Batas auto-post</label>
                                  <Input
                                    type="number"
                                    min={0}
                                    max={500}
                                    value={rateLimits.autoPostWindowCap}
                                    onChange={(e) => setRateLimits({ ...rateLimits, autoPostWindowCap: parseInt(e.target.value) || 0 })}
                                    className="text-xs h-8"
                                  />
                                  <p className="text-[9px] text-[#71767B] mt-0.5">Maks tweet per window</p>
                                </div>
                                <div>
                                  <label className="text-[10px] font-medium text-[#536471] block mb-1">Window (menit)</label>
                                  <Input
                                    type="number"
                                    min={1}
                                    max={1440}
                                    value={rateLimits.autoPostWindowMinutes}
                                    onChange={(e) => setRateLimits({ ...rateLimits, autoPostWindowMinutes: parseInt(e.target.value) || 1 })}
                                    className="text-xs h-8"
                                  />
                                  <p className="text-[9px] text-[#71767B] mt-0.5">Ukuran window waktu</p>
                                </div>
                                <div>
                                  <label className="text-[10px] font-medium text-[#536471] block mb-1">Batas post/user/hari</label>
                                  <Input
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={rateLimits.userPostDailyCap}
                                    onChange={(e) => setRateLimits({ ...rateLimits, userPostDailyCap: parseInt(e.target.value) || 0 })}
                                    className="text-xs h-8"
                                  />
                                  <p className="text-[9px] text-[#71767B] mt-0.5">Maks tweet per user per hari di X</p>
                                </div>
                              </div>
                              {/* Circuit Breaker */}
                              <div className="bg-[#F7F9F9] rounded-lg p-2 border border-[#EFF3F4] space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-medium text-[#536471]">Circuit Breaker</span>
                                  {circuitBreakerStatus?.paused && (
                                    <Badge variant="destructive" className="text-[9px] px-1.5 py-0">
                                      PAUSED — {liveRemainingMinutes}m tersisa
                                    </Badge>
                                  )}
                                  {!circuitBreakerStatus?.paused && circuitBreakerStatus && circuitBreakerStatus.failCount > 0 && (
                                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                                      {circuitBreakerStatus.failCount}/{circuitBreakerStatus.threshold} gagal
                                    </Badge>
                                  )}
                                  {circuitBreakerStatus?.paused && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="text-[9px] h-5 px-2 ml-auto"
                                      onClick={async () => {
                                        try {
                                          await fetch('/api/admin/circuit-breaker/reset', {
                                            method: 'POST',
                                            headers: { authorization: `Bearer ${adminToken}` },
                                          })
                                          setCircuitBreakerStatus({ ...circuitBreakerStatus, paused: false, failCount: 0, pausedUntil: null })
                                          toast({ title: 'Circuit breaker direset' })
                                        } catch { /* ignore */ }
                                      }}
                                    >
                                      Reset
                                    </Button>
                                  )}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-[10px] font-medium text-[#536471] block mb-1">Kegagalan berturut-turut</label>
                                    <Input
                                      type="number"
                                      min={1}
                                      max={20}
                                      value={rateLimits.circuitBreakerThreshold}
                                      onChange={(e) => setRateLimits({ ...rateLimits, circuitBreakerThreshold: parseInt(e.target.value) || 1 })}
                                      className="text-xs h-8"
                                    />
                                    <p className="text-[9px] text-[#71767B] mt-0.5">Gagal N kali → pause auto-post</p>
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-medium text-[#536471] block mb-1">Jeda circuit breaker (menit)</label>
                                    <Input
                                      type="number"
                                      min={1}
                                      max={1440}
                                      value={rateLimits.circuitBreakerCooldownMinutes}
                                      onChange={(e) => setRateLimits({ ...rateLimits, circuitBreakerCooldownMinutes: parseInt(e.target.value) || 1 })}
                                      className="text-xs h-8"
                                    />
                                    <p className="text-[9px] text-[#71767B] mt-0.5">Durasi pause auto-post</p>
                                  </div>
                                </div>
                              </div>
                              <div className="bg-[#F7F9F9] rounded-lg p-2 border border-[#EFF3F4] space-y-1">
                                <p className="text-[10px] font-medium text-[#536471]">Cara kerja:</p>
                                <ul className="text-[10px] text-[#71767B] space-y-0.5 list-disc list-inside">
                                  <li><strong>Cooldown</strong> — user harus menunggu sebelum kirim pesan lagi</li>
                                  <li><strong>Batas harian</strong> — maksimal pesan per user per 24 jam</li>
                                  <li><strong>Batas antrean/user</strong> — maks {rateLimits.userPendingCap} pesan pending per user, sisanya ditolak</li>
                                  <li><strong>Batas harian global</strong> — maks {rateLimits.globalSubmissionDailyCap} pesan dari semua user per hari</li>
                                  <li><strong>Auto-post jeda</strong> — jika ada pesan baru dalam {rateLimits.autoPostCooldown} detik setelah auto-post terakhir, masuk antrean admin</li>
                                  <li><strong>Batas auto-post</strong> — maks {rateLimits.autoPostWindowCap} tweet per {rateLimits.autoPostWindowMinutes} menit, mencegah 226 dari X</li>
                                  <li><strong>Batas post/user</strong> — maks {rateLimits.userPostDailyCap} tweet per user per hari di X, sisanya masuk antrean</li>
                                  <li><strong>Circuit breaker</strong> — jika {rateLimits.circuitBreakerThreshold}x gagal posting berturut-turut, pause auto-post selama {rateLimits.circuitBreakerCooldownMinutes} menit</li>
                                </ul>
                              </div>
                            </div>

                            <Separator />

                            {/* Whitelist */}
                            <div className="space-y-3">
                              <div className="flex items-center gap-2">
                                <UserCheck className="w-4 h-4 text-[#536471]" />
                                <span className="text-sm font-semibold text-[#0F1419]">Whitelist</span>
                                {whitelistText.split(/[,\n]+/).filter(u => u.trim()).length > 0 && (
                                  <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                                    {whitelistText.split(/[,\n]+/).filter(u => u.trim()).length} user
                                  </Badge>
                                )}
                              </div>
                              <div>
                                <label className="text-[10px] font-medium text-[#536471] block mb-1">Username X (bypass rate limit)</label>
                                <Textarea
                                  value={whitelistText}
                                  onChange={(e) => setWhitelistText(e.target.value)}
                                  placeholder="username1, username2, username3"
                                  className="text-xs min-h-[60px] font-mono"
                                />
                                <p className="text-[9px] text-[#71767B] mt-1">Pisahkan dengan koma atau baris baru. User ini bebas dari cooldown & batas harian. Berguna untuk testing.</p>
                              </div>
                            </div>

                            <Separator />

                            {/* Save Filter Settings */}
                            <Button
                              onClick={async () => {
                                setIsSavingFilter(true)
                                try {
                                  const words = blockedWordsText
                                    .split(/[,\n]+/)
                                    .map(w => w.trim().toLowerCase())
                                    .filter(w => w.length > 0)

                                  const nsfwWords = nsfwWordsText
                                    .split(/[,\n]+/)
                                    .map(w => w.trim().toLowerCase())
                                    .filter(w => w.length > 0)

                                  const whitelist = whitelistText
                                    .split(/[,\n]+/)
                                    .map(u => u.trim().toLowerCase())
                                    .filter(u => u.length > 0)

                                  const res = await fetch('/api/admin/filter-settings', {
                                    method: 'POST',
                                    headers: {
                                      'Content-Type': 'application/json',
                                      authorization: `Bearer ${adminToken}`,
                                    },
                                    body: JSON.stringify({
                                      autoApprove,
                                      blockedWords: words,
                                      nsfwWords,
                                      filterRules,
                                      geminiEnabled,
                                      rateLimits,
                                      whitelistUsernames: whitelist,
                                    }),
                                  })
                                  const data = await res.json()
                                  if (res.ok) {
                                    toast({ title: 'Filter settings saved!', description: `Auto-approve: ${autoApprove ? 'ON' : 'OFF'}, ${words.length} blocked words, Gemini: ${geminiEnabled ? 'ON' : 'OFF'}, Cooldown: ${rateLimits.submissionCooldown}m, Daily cap: ${rateLimits.submissionDailyCap}` })
                                    fetchStats()
                                  } else {
                                    toast({ title: 'Failed', description: data.error, variant: 'destructive' })
                                  }
                                } catch {
                                  toast({ title: 'Error', description: 'Failed to save filter settings', variant: 'destructive' })
                                } finally {
                                  setIsSavingFilter(false)
                                }
                              }}
                              disabled={isSavingFilter}
                              className="w-full bg-[#0F1419] hover:bg-[#272c30]"
                            >
                              {isSavingFilter ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Shield className="w-4 h-4 mr-2" />}
                              Save Filter Settings
                            </Button>
                          </CardContent>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>
                  </motion.div>
                )}
              </motion.div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-[#EFF3F4] bg-white/80 backdrop-blur-lg">
        <div className="max-w-4xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-1 text-center">
          <p className="text-xs text-[#71767B]">Autobase Menfess &mdash; X Base Indonesia</p>
          <p className="text-xs text-[#71767B]">Login with X only &middot; Anonim di tweet</p>
        </div>
      </footer>
    </div>
  )
}
