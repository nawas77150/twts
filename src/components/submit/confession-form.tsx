'use client'

import { useState } from 'react'
import { Send, Loader2, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface ConfessionFormProps {
  submitterUsername: string
  submitterImage: string | null
  onSubmit: (message: string, category: string) => Promise<boolean>
  isSubmitting: boolean
}

export function ConfessionForm({
  submitterUsername,
  submitterImage,
  onSubmit,
  isSubmitting,
}: ConfessionFormProps) {
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState('')

  const handleSubmit = async () => {
    const success = await onSubmit(message, category)
    if (success) {
      setMessage('')
      setCategory('')
    }
  }

  return (
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
          <span className="text-[#71767B]">&middot;</span>
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
  )
}
