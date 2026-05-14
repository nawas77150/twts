'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Shield, LogOut, LayoutDashboard, Settings } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { XLogo } from '@/components/shared/x-logo'

interface AdminHeaderProps {
  adminToken: string
  onLogout: () => void
  pendingCount?: number
}

export function AdminHeader({ adminToken, onLogout, pendingCount = 0 }: AdminHeaderProps) {
  const pathname = usePathname()

  const navLinks = [
    { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/admin/settings', label: 'Settings', icon: Settings },
  ]

  return (
    <header className="sticky top-0 z-50 border-b border-[#EFF3F4] bg-white/80 backdrop-blur-lg">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#0F1419] flex items-center justify-center shadow-md shadow-gray-200">
            <XLogo className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#0F1419] leading-tight">Autobase</h1>
            <p className="text-xs text-[#536471]">Dashboard</p>
          </div>
        </div>

        <nav className="flex items-center gap-1">
          {navLinks.map((link) => {
            const isActive = pathname === link.href
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-white shadow-sm text-[#0F1419]'
                    : 'text-[#536471] hover:text-[#3D4145] hover:bg-[#F7F9F9]'
                }`}
              >
                <link.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{link.label}</span>
                {link.label === 'Dashboard' && pendingCount > 0 && (
                  <Badge className="bg-yellow-400 text-yellow-900 text-[10px] px-1.5 py-0 h-5 min-w-[20px] flex items-center justify-center">
                    {pendingCount}
                  </Badge>
                )}
                {isActive && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-[#0F1419] rounded-full" />
                )}
              </Link>
            )
          })}

          <div className="flex items-center gap-1 ml-2">
            <Badge variant="outline" className="text-xs gap-1 border-green-300 text-green-700 bg-green-50">
              <Shield className="w-3 h-3" /> <span className="hidden sm:inline">Admin</span>
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={onLogout}
              className="text-[#71767B] h-7 w-7 p-0"
            >
              <LogOut className="w-3.5 h-3.5" />
            </Button>
          </div>
        </nav>
      </div>
    </header>
  )
}
