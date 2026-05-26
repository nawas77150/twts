'use client'

import { useState, useCallback } from 'react'
import { Users, Ban, RefreshCw, Loader2, Settings2, X, ShieldOff, Search } from 'lucide-react'
import { CensoredAvatar } from '@/components/shared/censored-avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { type SubmitterWithStats, PER_USER_LIMIT_KEYS, PER_USER_LIMIT_LABELS, type PerUserLimits } from '@/types'
import { useToast } from '@/hooks/use-toast'
import { safeAccess } from '@/lib/utils'

interface UsersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  submitters: SubmitterWithStats[]
  blockedUsernames: string[]
  censored: boolean
  isLoading: boolean
  page: number
  totalPages: number
  totalCount: number
  search: string
  onSearchChange: (search: string) => void
  onFetchSubmitters: () => void
  onGoToPage: (page: number) => void
  onBlock: (username: string, reason?: string) => Promise<void>
  onUnblock: (username: string) => Promise<void>
  onSetCustomLimits: (username: string, customLimits: Record<string, number | null> | null) => Promise<boolean>
  globalRateLimits: PerUserLimits | null
}

export function UsersDialog({
  open,
  onOpenChange,
  submitters,
  blockedUsernames,
  censored,
  isLoading,
  page,
  totalPages,
  totalCount,
  search,
  onSearchChange,
  onFetchSubmitters,
  onGoToPage,
  onBlock,
  onUnblock,
  onSetCustomLimits,
  globalRateLimits,
}: UsersDialogProps) {
  const [editingUsername, setEditingUsername] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Map<string, string>>(new Map())
  const [isSaving, setIsSaving] = useState(false)
  const [pendingBlockUsername, setPendingBlockUsername] = useState<string | null>(null)
  const [blockReasonInput, setBlockReasonInput] = useState('')
  const { toast } = useToast()

  // Reset state when dialog closes
  const handleOpenChange = useCallback((isOpen: boolean) => {
    onOpenChange(isOpen)
    if (!isOpen) {
      onSearchChange('')
      setEditingUsername(null)
      setEditValues(new Map())
      setPendingBlockUsername(null)
      setBlockReasonInput('')
    }
  }, [onOpenChange, onSearchChange])

  // Map (not Record) avoids the "Generic Object Injection Sink" SAST warning:
  // plain objects have a prototype chain (__proto__, constructor) that SAST
  // flags on dynamic-key access. Map.get() / Map.set() have no prototype chain.
  const startEditing = useCallback((submitter: SubmitterWithStats) => {
    setEditingUsername(submitter.username)
    const vals = new Map<string, string>()
    for (const key of PER_USER_LIMIT_KEYS) {
      const limits = submitter.customLimits as Partial<PerUserLimits> | null
      const override = limits ? safeAccess(limits, key) : undefined
      vals.set(key, String(override))
    }
    setEditValues(vals)
  }, [])

  const handleSaveLimits = useCallback(async (username: string) => {
    setIsSaving(true)
    try {
      const customLimits = new Map<string, number | null>()
      let hasAnyOverride = false

      for (const key of PER_USER_LIMIT_KEYS) {
        const raw = (editValues.get(key) ?? '').trim()
        if (raw === '') {
          // Empty = remove this override (send null to clear)
          customLimits.set(key, null)
        } else {
          const num = parseInt(raw, 10)
          if (!isNaN(num) && num >= 0) {
            customLimits.set(key, num)
            hasAnyOverride = true
          } else {
            // Invalid input — abort and show error
            toast({ title: 'Input tidak valid', description: `${safeAccess(PER_USER_LIMIT_LABELS, key)}: masukkan angka tidak negatif atau kosongkan`, variant: 'destructive' })
            return false
          }
        }
      }

      // If no fields have values, clear all custom limits
      // Convert Map → plain object at API boundary (onSetCustomLimits expects Record)
      const payload = hasAnyOverride ? Object.fromEntries(customLimits) : null
      const success = await onSetCustomLimits(username, payload)
      if (success) {
        setEditingUsername(null)
        setEditValues(new Map())
      }
      return success
    } finally {
      setIsSaving(false)
    }
  }, [editValues, onSetCustomLimits, toast])

  const handleClearLimits = useCallback(async (username: string) => {
    setIsSaving(true)
    try {
      await onSetCustomLimits(username, null)
      setEditingUsername(null)
      setEditValues(new Map())
    } finally {
      setIsSaving(false)
    }
  }, [onSetCustomLimits])

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-hidden flex flex-col p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-600" /> Pengguna
          </DialogTitle>
          <DialogDescription>
            Kelola pengguna — blokir yang spam, atur batas custom.
          </DialogDescription>
        </DialogHeader>

        {/* Search + Refresh inline (matches submissions panel style) */}
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-[#71767B] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input
              className="text-xs border-[#EFF3F4] pl-7 h-7 w-full"
              placeholder="Cari username..."
              value={search}
              onChange={(e) => { onSearchChange(e.target.value) }}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0 text-[#71767B] hover:text-accent-foreground shrink-0"
            onClick={onFetchSubmitters}
            disabled={isLoading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin-reverse' : ''}`} />
          </Button>
        </div>

        <div
          className="flex-1 overflow-y-auto space-y-4 pr-1"
          style={{ scrollbarWidth: 'thin' }}
        >
          {/* All Users */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#536471]" />
              <span className="text-sm font-semibold text-[#0F1419]">
                Semua Pengguna
              </span>
              {totalCount > 0 && (
                <Badge
                  variant="secondary"
                  className="text-[9px] px-1.5 py-0"
                >
                  {totalCount}
                </Badge>
              )}
            </div>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-[#536471]" />
              </div>
            ) : submitters.length === 0 && search ? (
              <div className="text-center py-6">
                <div className="w-10 h-10 rounded-xl bg-[#F7F9F9] flex items-center justify-center mx-auto mb-2">
                  <Search className="w-5 h-5 text-[#71767B]" />
                </div>
                <p className="text-xs text-[#536471]">
                  Tidak ada hasil untuk &ldquo;{search}&rdquo;
                </p>
                <Button
                  variant="link"
                  className="text-xs text-[#71767B] mt-1"
                  onClick={() => { onSearchChange('') }}
                >
                  Hapus pencarian
                </Button>
              </div>
            ) : submitters.length === 0 ? (
              <p className="text-xs text-[#71767B] text-center py-6">
                Klik refresh untuk memuat daftar pengguna
              </p>
            ) : (
              <div className="space-y-1">
                {submitters.map((s) => {
                  const isBlocked = blockedUsernames.includes(
                    s.username.toLowerCase()
                  )
                  const isEditing = editingUsername === s.username
                  const hasCustom = s.customLimits && Object.keys(s.customLimits).length > 0

                  return (
                    <div
                      key={s.id}
                      className={`rounded-lg text-xs ${
                        isEditing
                          ? 'bg-purple-50 border border-purple-200'
                          : isBlocked
                          ? 'bg-red-50 border border-red-200'
                          : 'bg-[#F7F9F9] border border-[#EFF3F4]'
                      }`}
                    >
                      {/* User row */}
                      <div className="flex items-center gap-2 p-2">
                        <CensoredAvatar
                          src={s.profileImage}
                          username={s.username}
                          censored={censored}
                          size={32}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="font-medium text-[#0F1419] truncate">
                              {censored ? '@*****' : `@${s.username}`}
                            </span>
                            {isBlocked && (
                              <Badge
                                variant="destructive"
                                className="text-[8px] px-1 py-0"
                              >
                                BLOCKED
                              </Badge>
                            )}
                            {hasCustom && !isBlocked && (
                              <Badge
                                className="text-[8px] px-1.5 py-0 bg-purple-100 text-purple-700 border-purple-200 hover:bg-purple-100"
                              >
                                CUSTOM
                              </Badge>
                            )}
                          </div>
                          <span className="text-[#71767B]">
                            {s.totalSubmissions} pesan · {s.posted} posted ·{' '}
                            {s.pending} pending
                          </span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {!isBlocked && (
                            <Button
                              variant="outline"
                              size="sm"
                              className={`text-[10px] h-6 px-2 ${
                                isEditing
                                  ? 'text-purple-600 hover:text-purple-700 hover:bg-purple-50 border-purple-200'
                                  : 'text-[#536471] hover:text-purple-600 hover:bg-purple-50 border-[#EFF3F4]'
                              }`}
                              onClick={() => { if (isEditing) { setEditingUsername(null) } else { startEditing(s) } }}
                            >
                            <Settings2 className="w-3 h-3 mr-0.5" />
                            <span className="hidden sm:inline">{isEditing ? 'Tutup' : 'Limits'}</span>
                            </Button>
                          )}
                          {!isBlocked ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-[10px] h-6 px-2 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                              onClick={() => { setPendingBlockUsername(s.username) }}
                            >
                            <Ban className="w-3 h-3 mr-0.5 sm:mr-1" />
                            <span className="hidden sm:inline">Block</span>
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-[10px] h-6 px-2 text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200"
                              onClick={() => { void onUnblock(s.username) }}
                            >
                            <ShieldOff className="w-3 h-3 mr-0.5 sm:mr-1" />
                            <span className="hidden sm:inline">Unblock</span>
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Limits editor (expandable) */}
                      {isEditing && (
                        <div className="px-2 pb-2 pt-1">
                          <Separator className="mb-2" />
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {PER_USER_LIMIT_KEYS.map((key) => (
                              <div key={key} className="space-y-0.5">
                                <label htmlFor={`limit-${key}`} className="text-[10px] text-[#536471] font-medium flex items-center gap-1">
                                  {safeAccess(PER_USER_LIMIT_LABELS, key)}
                                  {globalRateLimits && (
                                    <span className="text-[9px] text-[#71767B]">
                                      (default: {safeAccess(globalRateLimits, key)})
                                    </span>
                                  )}
                                </label>
                                <Input
                                  id={`limit-${key}`}
                                  type="number"
                                  min="0"
                                  placeholder={globalRateLimits ? String(safeAccess(globalRateLimits, key)) : '—'}
                                  value={editValues.get(key) ?? ''}
                                  onChange={(e) => { setEditValues(prev => { const next = new Map(prev); next.set(key, e.target.value); return next }) }}
                                  className="h-7 text-xs border-[#EFF3F4]"
                                />
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <Button
                              size="sm"
                              className="text-[10px] h-6 px-3 bg-purple-600 hover:bg-purple-700 text-white"
                              onClick={() => { void handleSaveLimits(s.username) }}
                              disabled={isSaving}
                            >
                              {isSaving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                              Simpan
                            </Button>
                            {hasCustom && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-[10px] h-6 px-3 text-amber-600 hover:text-amber-700 hover:bg-amber-50 border-amber-200"
                                onClick={() => { void handleClearLimits(s.username) }}
                                disabled={isSaving}
                              >
                                Reset ke Default
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-[10px] h-6 px-2 ml-auto text-[#71767B]"
                              onClick={() => { setEditingUsername(null) }}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Pagination — matches submissions panel style */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1 pt-2 border-t border-[#EFF3F4]">
            <Button
              variant="outline"
              className="h-7 w-7 p-0 text-xs"
              disabled={page <= 1}
              onClick={() => { onGoToPage(page - 1) }}
            >
              ‹
            </Button>
            {(() => {
              const pages: (number | 'ellipsis-start' | 'ellipsis-end')[] = []
              const tp = totalPages
              const cp = page
              if (tp <= 7) {
                for (let i = 1; i <= tp; i++) pages.push(i)
              } else {
                pages.push(1)
                if (cp > 3) pages.push('ellipsis-start')
                const start = Math.max(2, cp - 1)
                const end = Math.min(tp - 1, cp + 1)
                for (let i = start; i <= end; i++) pages.push(i)
                if (cp < tp - 2) pages.push('ellipsis-end')
                pages.push(tp)
              }
              return pages.map((p) =>
                typeof p !== 'number' ? (
                  <span key={p} className="px-1 text-xs text-[#71767B]">
                    …
                  </span>
                ) : (
                  <Button
                    key={p}
                    variant={p === page ? 'default' : 'outline'}
                    className={`h-7 w-7 p-0 text-xs ${
                      p === page ? 'bg-[#0F1419] hover:bg-[#272c30]' : ''
                    }`}
                    onClick={() => { onGoToPage(p) }}
                  >
                    {p}
                  </Button>
                )
              )
            })()}
            <Button
              variant="outline"
              className="h-7 w-7 p-0 text-xs"
              disabled={page >= totalPages}
              onClick={() => { onGoToPage(page + 1) }}
            >
              ›
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>

    {/* Block Confirmation Dialog */}
    {pendingBlockUsername && (
      <AlertDialog open onOpenChange={(open) => { if (!open) { setPendingBlockUsername(null); setBlockReasonInput('') } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Ban className="w-4 h-4 text-red-500" />
              Block @{pendingBlockUsername}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              User yang diblokir tidak bisa mengirim pesan. Pesan yang menunggu akan otomatis ditolak.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Input
              value={blockReasonInput}
              onChange={(e) => { setBlockReasonInput(e.target.value) }}
              placeholder="Alasan pemblokiran (opsional, dilihat user)"
              className="text-xs h-8 border-[#EFF3F4]"
            />
            <p className="text-[9px] text-[#71767B] mt-1">
              Jika diisi, alasan ini akan ditampilkan ke user yang diblokir.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setPendingBlockUsername(null); setBlockReasonInput('') }}>
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => {
                void onBlock(pendingBlockUsername, blockReasonInput.trim() || undefined)
                setPendingBlockUsername(null)
                setBlockReasonInput('')
              }}
            >
              Block
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )}
    </>
  )
}
