'use client'

import { useState, useCallback } from 'react'
import { Send, Loader2, MessageSquare, Zap, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Image from 'next/image'
import type { SubmissionLimitsData } from '@/types'

interface ConfessionFormProps {
  submitterUsername: string
  submitterImage: string | null
  onSubmit: (message: string, category: string) => Promise<boolean>
  isSubmitting: boolean
  limits: SubmissionLimitsData | null
  autoApprove?: boolean
}

export function ConfessionForm({
  submitterUsername,
  submitterImage,
  onSubmit,
  isSubmitting,
  limits,
  autoApprove = false,
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

  const remainingDaily = limits ? Math.max(0, limits.dailyCap - limits.dailyUsed) : null
  const isCustom = limits?.isCustom ?? false
  const pendingOverCap = limits ? limits.pendingUsed > limits.pendingCap : false

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
        <div className="space-y-2">
          <Textarea
            placeholder="Tulis pesan anonimmu di sini..."
            value={message}
            onChange={(e) => { setMessage(e.target.value) }}
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
            onChange={(e) => { setCategory(e.target.value) }}
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

        {/* Limits display */}
        {limits && (
          <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs px-3 py-2 rounded-lg ${
            isCustom
              ? 'bg-purple-50 border border-purple-100'
              : 'bg-[#F7F9F9] border border-[#EFF3F4]'
          }`}>
            {isCustom && (
              <span className="inline-flex items-center gap-0.5 text-purple-600 font-medium">
                <Zap className="w-3 h-3" /> Custom
              </span>
            )}
            <span className={isCustom ? 'text-purple-700' : 'text-[#536471]'}>
              {limits.dailyUsed}/{limits.dailyCap} hari ini
            </span>
            <span className={isCustom ? 'text-purple-400' : 'text-[#71767B]'}>&middot;</span>
            <span className={pendingOverCap ? 'text-red-500' : isCustom ? 'text-purple-700' : 'text-[#536471]'}>
              antrean {limits.pendingUsed}/{limits.pendingCap}
              {pendingOverCap && <AlertTriangle className="w-3 h-3 inline ml-0.5" />}
            </span>
            <span className={isCustom ? 'text-purple-400' : 'text-[#71767B]'}>&middot;</span>
            <span className={isCustom ? 'text-purple-700' : 'text-[#536471]'}>
              post {limits.postUsed}/{limits.postCap}
            </span>
            <span className={isCustom ? 'text-purple-400' : 'text-[#71767B]'}>&middot;</span>
            <span className={isCustom ? 'text-purple-700' : 'text-[#536471]'}>
              {limits.cooldownSeconds > 0
                ? `cooldown ${limits.cooldownSeconds < 60 ? `${limits.cooldownSeconds}s` : `${Math.ceil(limits.cooldownSeconds / 60)}m`}`
                : 'siap kirim'}
            </span>
            {remainingDaily === 0 && (
              <>
                <span className={isCustom ? 'text-purple-400' : 'text-[#71767B]'}>&middot;</span>
                <span className="text-red-500">Habis — coba besok</span>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
