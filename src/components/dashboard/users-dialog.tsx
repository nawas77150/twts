'use client'

import { useState } from 'react'
import { Users, Ban, RefreshCw, Loader2, User, Settings2, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { SearchInput } from '@/components/ui/search-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { SubmitterWithStats } from '@/types'
import { PER_USER_LIMIT_KEYS, PER_USER_LIMIT_LABELS, type PerUserLimits } from '@/types'
import { useToast } from '@/hooks/use-toast'

interface UsersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  submitters: SubmitterWithStats[]
  blockedUsernames: string[]
  isLoading: boolean
  onFetchSubmitters: () => void
  onBlock: (username: string) => Promise<void>
  onUnblock: (username: string) => Promise<void>
  onSetCustomLimits: (username: string, customLimits: Record<string, number | null> | null) => Promise<boolean>
  globalRateLimits: PerUserLimits | null
}

export function UsersDialog({
  open,
  onOpenChange,
  submitters,
  blockedUsernames,
  isLoading,
  onFetchSubmitters,
  onBlock,
  onUnblock,
  onSetCustomLimits,
  globalRateLimits,
}: UsersDialogProps) {
  const [search, setSearch] = useState('')
  const [editingUsername, setEditingUsername] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Map<string, string>>(new Map())
  const [isSaving, setIsSaving] = useState(false)
  const { toast } = useToast()

  // Reset state when dialog closes
  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen)
    if (!isOpen) {
      setSearch('')
      setEditingUsername(null)
      setEditValues(new Map())
    }
  }

  // Map (not Record) avoids the "Generic Object Injection Sink" SAST warning:
  // plain objects have a prototype chain (__proto__, constructor) that SAST
  // flags on dynamic-key access. Map.get() / Map.set() have no prototype chain.
  const startEditing = (submitter: SubmitterWithStats) => {
    setEditingUsername(submitter.username)
    const vals = new Map<string, string>()
    for (const key of PER_USER_LIMIT_KEYS) {
      const override = submitter.customLimits?.[key]
      vals.set(key, override !== undefined && override !== null ? String(override) : '')
    }
    setEditValues(vals)
  }

  const handleSaveLimits = async (username: string) => {
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
            toast({ title: 'Input tidak valid', description: `${PER_USER_LIMIT_LABELS[key]}: masukkan angka tidak negatif atau kosongkan`, variant: 'destructive' })
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
  }

  const handleClearLimits = async (username: string) => {
    setIsSaving(true)
    try {
      await onSetCustomLimits(username, null)
      setEditingUsername(null)
      setEditValues(new Map())
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-600" /> Pengguna
          </DialogTitle>
          <DialogDescription>
            Kelola pengguna — blokir yang spam, atur batas custom.
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Cari username..."
        />

        <div
          className="flex-1 overflow-y-auto space-y-4 pr-1"
          style={{ scrollbarWidth: 'thin' }}
        >
          {/* Blocklist */}
          {blockedUsernames.filter((u) =>
            u.includes(search.toLowerCase())
          ).length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Ban className="w-4 h-4 text-red-500" />
                <span className="text-sm font-semibold text-[#0F1419]">
                  Blocklist
                </span>
                <Badge
                  variant="destructive"
                  className="text-[9px] px-1.5 py-0"
                >
                  {blockedUsernames.length} diblokir
                </Badge>
              </div>
              <div className="space-y-1">
                {blockedUsernames
                  .filter((u) => u.includes(search.toLowerCase()))
                  .map((username) => (
                    <div
                      key={username}
                      className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded-lg text-xs"
                    >
                      <div className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                        <Ban className="w-3.5 h-3.5 text-red-400" />
                      </div>
                      <span className="font-medium text-[#0F1419]">
                        @{username}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-[10px] h-6 px-2 ml-auto text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200 flex-shrink-0"
                        onClick={() => { void onUnblock(username) }}
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
              <span className="text-sm font-semibold text-[#0F1419]">
                Semua Pengguna
              </span>
              {submitters.length > 0 && (
                <Badge
                  variant="secondary"
                  className="text-[9px] px-1.5 py-0"
                >
                  {submitters.length}
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                className="text-[10px] h-6 px-2 ml-auto"
                onClick={onFetchSubmitters}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
              </Button>
            </div>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-[#536471]" />
              </div>
            ) : submitters.length === 0 ? (
              <p className="text-xs text-[#71767B] text-center py-6">
                Klik refresh untuk memuat daftar pengguna
              </p>
            ) : (
              <div
                className="max-h-96 overflow-y-auto space-y-1 pr-1"
                style={{ scrollbarWidth: 'thin' }}
              >
                {(() => {
                  const filtered = submitters.filter((s) => {
                    if (!search) return true
                    const q = search.toLowerCase()
                    return (
                      s.username.toLowerCase().includes(q) ||
                      (s.displayName?.toLowerCase().includes(q) ?? false)
                    )
                  })
                  if (filtered.length === 0 && search) {
                    return (
                      <div className="text-center py-6">
                        <p className="text-xs text-[#536471]">
                          Tidak ada hasil untuk &ldquo;{search}&rdquo;
                        </p>
                        <Button
                          variant="link"
                          className="text-xs text-[#71767B] mt-1"
                          onClick={() => { setSearch('') }}
                        >
                          Hapus pencarian
                        </Button>
                      </div>
                    )
                  }
                  return filtered.map((s) => {
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
                          {s.profileImage ? (
                            <img
                              src={s.profileImage}
                              alt=""
                              width={32}
                              height={32}
                              className="w-8 h-8 rounded-full flex-shrink-0"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-[#EFF3F4] flex items-center justify-center flex-shrink-0">
                              <User className="w-4 h-4 text-[#71767B]" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1">
                              <span className="font-medium text-[#0F1419] truncate">
                                @{s.username}
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
                                {isEditing ? 'Tutup' : 'Limits'}
                              </Button>
                            )}
                            {!isBlocked ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-[10px] h-6 px-2 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                                onClick={() => { void onBlock(s.username) }}
                              >
                                <Ban className="w-3 h-3 mr-1" /> Block
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-[10px] h-6 px-2 text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200"
                                onClick={() => { void onUnblock(s.username) }}
                              >
                                Unblock
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Limits editor (expandable) */}
                        {isEditing && (
                          <div className="px-2 pb-2 pt-1">
                            <Separator className="mb-2" />
                            <div className="grid grid-cols-2 gap-2">
                              {PER_USER_LIMIT_KEYS.map((key) => (
                                <div key={key} className="space-y-0.5">
                                  <label htmlFor={`limit-${key}`} className="text-[10px] text-[#536471] font-medium flex items-center gap-1">
                                    {PER_USER_LIMIT_LABELS[key]}
                                    {globalRateLimits && (
                                      <span className="text-[9px] text-[#71767B]">
                                        (default: {globalRateLimits[key]})
                                      </span>
                                    )}
                                  </label>
                                  <Input
                                    id={`limit-${key}`}
                                    type="number"
                                    min="0"
                                    placeholder={globalRateLimits ? String(globalRateLimits[key]) : '—'}
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
                  })
                })()}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
