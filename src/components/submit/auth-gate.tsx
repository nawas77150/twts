'use client'

import { Loader2, AlertTriangle, RotateCcw, LogOut, Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { XLogo } from '@/components/shared/x-logo'
import type { SubmitterInfo } from '@/types'

interface AuthGateProps {
  submitter: SubmitterInfo | null
  isChecking: boolean
  authError: string | null
  isBlocked: boolean
  isAnonUser: boolean
  onLogin: () => void
  onLogout: () => void
  onRetry: () => void
  children: React.ReactNode
}

export function AuthGate({
  submitter,
  isChecking,
  authError,
  isBlocked,
  isAnonUser,
  onLogin,
  onLogout,
  onRetry,
  children,
}: AuthGateProps) {
  const isLoggedOut = !submitter

  if (isChecking) {
    return (
      <Card className="max-w-lg mx-auto py-12">
        <CardContent className="flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-[#536471]" />
        </CardContent>
      </Card>
    )
  }

  if (authError) {
    return (
      <AlertCard icon={<AlertTriangle className="w-7 h-7 text-amber-500" />}>
        <h3 className="text-lg font-semibold text-[#0F1419]">Koneksi Bermasalah</h3>
        <p className="text-sm text-[#536471]">{authError}</p>
        <Button onClick={onRetry} variant="outline" className="border-[#EFF3F4]">
          <RotateCcw className="w-4 h-4 mr-2" /> Coba Lagi
        </Button>
      </AlertCard>
    )
  }

  if (isLoggedOut) {
    return (
      <Card className="max-w-lg mx-auto shadow-lg border-[#EFF3F4]">
        <CardContent className="py-10 text-center space-y-5">
          <div className="w-14 h-14 rounded-2xl bg-[#F7F9F9] flex items-center justify-center mx-auto">
            <XLogo className="w-7 h-7 text-[#0F1419]" />
          </div>
          <h3 className="text-lg font-semibold text-[#0F1419]">Login Dulu Ya!</h3>
          <p className="text-sm text-[#536471]">
            Login dengan akun X untuk mengirim pesan. <br />
            <span className="text-[#71767B] text-xs">Tenang, identitasmu tetap anonim di X!</span>
          </p>
          <Button
            onClick={onLogin}
            className="bg-[#0F1419] hover:bg-[#272c30] text-white h-11 text-base px-8"
            size="lg"
          >
            <XLogo className="w-5 h-5 mr-2" /> Login dengan X
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (isAnonUser) {
    return (
      <AlertCard icon={<AlertTriangle className="w-7 h-7 text-amber-500" />}>
        <h3 className="text-lg font-semibold text-[#0F1419]">Profil X Gagal Dimuat</h3>
        <p className="text-sm text-[#536471]">
          Login berhasil tapi profil X kamu tidak bisa dimuat. <br />
          <span className="text-[#71767B] text-xs">Coba login ulang untuk mengirim pesan.</span>
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button onClick={onLogout} variant="outline" className="border-[#EFF3F4]">
            <LogOut className="w-4 h-4 mr-2" /> Logout & Coba Lagi
          </Button>
          <Button onClick={onLogin} className="bg-[#0F1419] hover:bg-[#272c30] text-white">
            <RotateCcw className="w-4 h-4 mr-2" /> Re-Login X
          </Button>
        </div>
      </AlertCard>
    )
  }

  if (isBlocked) {
    return (
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
          <div className="flex items-center justify-center gap-3">
            <Button onClick={onRetry} variant="outline" className="border-[#EFF3F4]">
              <RotateCcw className="w-4 h-4 mr-2" /> Cek Ulang
            </Button>
            <Button onClick={onLogout} variant="outline" className="border-[#EFF3F4]">
              <LogOut className="w-4 h-4 mr-2" /> Logout
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return <>{children}</>
}

/** Amber warning card shared by authError and isAnonUser states. */
function AlertCard({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="max-w-lg mx-auto shadow-lg border-amber-200">
      <CardContent className="py-10 text-center space-y-5">
        <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto">
          {icon}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}
