'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Send, Loader2, MessageSquare, Zap, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Image from 'next/image'
import type { SubmissionLimitsData } from '@/types'
import { useCountdown } from '@/hooks/use-countdown'

interface ConfessionFormProps {
  submitterUsername: string
  submitterImage: string | null
  onSubmit: (message: string, category: string) => Promise<boolean>
  isSubmitting: boolean
  limits: SubmissionLimitsData | null
  autoApprove?: boolean
  onCooldownExpired?: () => void
}

export function ConfessionForm({
  submitterUsername,
  submitterImage,
  onSubmit,
  isSubmitting,
  limits,
  autoApprove = false,
  onCooldownExpired,
}: ConfessionFormProps) {
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState('')

  const handleSubmit = useCallback(async () => {
    const success = await onSubmit(message, category)
    if (success) {
      setMessage('')
      setCategory('')
    }
  }, [onSubmit, message, category])

  const maxLen = limits?.maxMessageLength ?? 280
  // Proportional amber threshold: same ratio as 220/280 ≈ 0.786
  const amberThreshold = Math.round(maxLen * 220 / 280)

  const isWhitelisted = limits?.isWhitelisted ?? false
  const remainingDaily = isWhitelisted ? null : (limits ? Math.max(0, limits.dailyCap - limits.dailyUsed) : null)
  const isCustom = limits?.isCustom ?? false
  const pendingOverCap = isWhitelisted ? false : (limits ? limits.pendingUsed > limits.pendingCap : false)

  // Pre-computed styling for limits bar (whitelisted → green, custom → purple, default → neutral)
  const valueColor = isWhitelisted ? 'text-green-700' : isCustom ? 'text-purple-700' : 'text-[#536471]'
  const dotColor = isWhitelisted ? 'text-green-400' : isCustom ? 'text-purple-400' : 'text-[#71767B]'
  const bgColor = isWhitelisted ? 'bg-green-50 border border-green-100' : isCustom ? 'bg-purple-50 border border-purple-100' : 'bg-[#F7F9F9] border border-[#EFF3F4]'
  const fmtCap = (cap: number) => isWhitelisted ? '∞' : cap

  const cooldownRemaining = useCountdown(limits?.cooldownSeconds ?? 0)

  const wasCountingRef = useRef(false)
  useEffect(() => {
    if (cooldownRemaining > 0) { wasCountingRef.current = true; return }
    if (wasCountingRef.current) {
      wasCountingRef.current = false
      onCooldownExpired?.()
    }
  }, [cooldownRemaining, onCooldownExpired])

  return (
    <Card className="max-w-lg mx-auto shadow-lg border-[#EFF3F4]">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-[#536471]" /> Tulis Pesan
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs sm:text-sm">
          {submitterImage ? (
            <Image src={submitterImage} alt="" width={16} height={16} className="w-4 h-4 rounded-full shrink-0" />
          ) : null}
          <span className="inline-flex items-center gap-1">
            Login sebagai <span className="font-medium text-[#0F1419]">@{submitterUsername || 'user'}</span>
          </span>
          <span className="text-[#71767B]">&middot;</span>
          <span>{autoApprove
            ? 'Pesan akan otomatis diposting setelah lulus filter'
            : 'Pesan akan diperiksa admin sebelum diposting'}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          onSubmit={(e) => { e.preventDefault(); void handleSubmit() }}
          className="space-y-4"
          aria-label="Kirim pesan anonim"
        >
          <div className="space-y-2">
            <Textarea
              id="message"
              name="message"
              placeholder="Tulis pesan anonimmu di sini..."
              value={message}
              onChange={(e) => { setMessage(e.target.value) }}
              className="min-h-[120px] resize-none border-[#EFF3F4]"
              maxLength={maxLen}
            />
            <div className="flex justify-between items-center">
              <span className="text-xs text-[#71767B]">
                {limits?.hashtags
                  ? `Maks ${maxLen} karakter (${limits.hashtags.length + 1} untuk ${limits.hashtags})`
                  : 'Maks 280 karakter (batas tweet X)'}
              </span>
              <span className={`text-xs font-medium ${message.length > maxLen ? 'text-red-500' : message.length > amberThreshold ? 'text-amber-500' : 'text-[#71767B]'}`}>
                {message.length}/{maxLen}
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <Input
              id="category"
              name="category"
              placeholder="Kategori (opsional, contoh: curhat, confes, dll)"
              value={category}
              onChange={(e) => { setCategory(e.target.value) }}
              className="border-[#EFF3F4]"
              maxLength={30}
            />
          </div>
          <Button
            type="submit"
            disabled={isSubmitting || !message.trim() || cooldownRemaining > 0 || remainingDaily === 0 || pendingOverCap}
            className="w-full bg-[#0F1419] hover:bg-[#272c30] disabled:opacity-50"
            size="lg"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            {isSubmitting ? 'Mengirim...' : 'Kirim Pesan'}
          </Button>
        </form>

        {/* Limits display */}
        {limits && (
          <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs px-3 py-2 rounded-lg ${bgColor}`}>
            {isWhitelisted && (
              <span className="inline-flex items-center gap-0.5 text-green-600 font-medium">
                <Zap className="w-3 h-3" /> Whitelisted
              </span>
            )}
            {isCustom && !isWhitelisted && (
              <span className="inline-flex items-center gap-0.5 text-purple-600 font-medium">
                <Zap className="w-3 h-3" /> Custom
              </span>
            )}
            <span className={valueColor}>
              {limits.dailyUsed}/{fmtCap(limits.dailyCap)} hari ini
            </span>
            <span className={dotColor}>&middot;</span>
            <span className={pendingOverCap ? 'text-red-500' : valueColor}>
              antrean {limits.pendingUsed}/{fmtCap(limits.pendingCap)}
              {pendingOverCap && <AlertTriangle className="w-3 h-3 inline ml-0.5" />}
            </span>
            <span className={dotColor}>&middot;</span>
            <span className={valueColor}>
              post {limits.postUsed}/{fmtCap(limits.postCap)}
            </span>
            <span className={dotColor}>&middot;</span>
            <span className={valueColor}>
              {cooldownRemaining > 0
                ? `cooldown ${cooldownRemaining < 60 ? `${cooldownRemaining}s` : `${Math.floor(cooldownRemaining / 60)}:${String(cooldownRemaining % 60).padStart(2, '0')}`}`
                : 'siap kirim'}
            </span>
            {!isWhitelisted && remainingDaily === 0 && (
              <>
                <span className={dotColor}>&middot;</span>
                <span className="text-red-500">Habis — coba besok</span>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
