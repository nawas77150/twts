'use client'

import { Loader2, LogOut, ChevronDown, AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { XLogo } from '@/components/shared/x-logo'
import type { SubmitterInfo } from '@/types'

interface PublicHeaderProps {
  submitter: SubmitterInfo | null
  isChecking: boolean
  isAnonUser: boolean
  onLogin: () => void
  onLogout: () => void
}

export function PublicHeader({ submitter, isChecking, isAnonUser, onLogin, onLogout }: PublicHeaderProps) {
  const isLoggedOut = !submitter
  const submitterUsername = submitter?.username
  const submitterImage = submitter?.profileImage

  return (
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
                  <DropdownMenuItem onClick={onLogout} className="text-amber-600 focus:text-amber-700">
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Coba Login Ulang
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={onLogout} variant="destructive">
                  <LogOut className="w-4 h-4 mr-2" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              size="sm"
              onClick={onLogin}
              className="bg-[#0F1419] hover:bg-[#272c30] text-white h-9 px-4"
            >
              <XLogo className="w-4 h-4 mr-2" /> Login X
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
