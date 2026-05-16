'use client'

import { useState } from 'react'
import { Clock, ChevronDown, Loader2, Shield, User, Globe, Zap } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { RateLimitSettings } from '@/types'

interface RateLimitCardProps {
  rateLimits: RateLimitSettings
  setRateLimits: React.Dispatch<React.SetStateAction<RateLimitSettings>>
  isSaving: boolean
  saveFilterSettings: () => void
}

interface RateField {
  key: keyof RateLimitSettings
  label: string
  hint: string
  min: number
  max: number
}

interface RateGroup {
  id: string
  label: string
  icon: React.ReactNode
  color: string
  bgColor: string
  borderColor: string
  badge: string
  badgeColor: string
  description: string
  fields: RateField[]
}

const RATE_GROUPS: RateGroup[] = [
  {
    id: 'per-user',
    label: 'Per User',
    icon: <User className="w-3.5 h-3.5" />,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-100',
    badge: 'Whitelist bypass',
    badgeColor: 'bg-blue-100 text-blue-700 border-blue-200',
    description: 'Dilanggar whitelist — user di-whitelist lewat batas ini',
    fields: [
      { key: 'submissionCooldown', label: 'Cooldown (menit)', hint: 'Jeda antar pesan per user', min: 0, max: 60 },
      { key: 'submissionDailyCap', label: 'Batas harian', hint: 'Pesan/user/hari (reset 00:00 WIB)', min: 1, max: 100 },
      { key: 'userPendingCap', label: 'Batas antrean/user/hari', hint: 'Pesan pending/user/hari (reset 00:00 WIB)', min: 1, max: 50 },
      { key: 'userPostDailyCap', label: 'Batas post/user/hari', hint: 'Tweet ke X/user/hari (reset 00:00 WIB)', min: 0, max: 100 },
    ],
  },
  {
    id: 'global',
    label: 'Global',
    icon: <Globe className="w-3.5 h-3.5" />,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-100',
    badge: 'Selalu aktif',
    badgeColor: 'bg-amber-100 text-amber-700 border-amber-200',
    description: 'Selalu aktif — melindungi sistem dari overload',
    fields: [
      { key: 'globalSubmissionDailyCap', label: 'Batas harian global', hint: 'Total pesan dari semua user/hari (reset 00:00 WIB)', min: 0, max: 10000 },
    ],
  },
  {
    id: 'x-protection',
    label: 'Proteksi Akun X',
    icon: <Zap className="w-3.5 h-3.5" />,
    color: 'text-rose-600',
    bgColor: 'bg-rose-50',
    borderColor: 'border-rose-100',
    badge: 'Selalu aktif',
    badgeColor: 'bg-rose-100 text-rose-700 border-rose-200',
    description: 'Selalu aktif — melindungi akun X dari suspend/rate limit',
    fields: [
      { key: 'autoPostCooldown', label: 'Jeda auto-post (detik)', hint: 'Jeda antar tweet ke X', min: 0, max: 120 },
      { key: 'autoPostWindowCap', label: 'Batas auto-post', hint: 'Maks tweet per window', min: 0, max: 500 },
      { key: 'autoPostWindowMinutes', label: 'Window (menit)', hint: 'Ukuran window waktu', min: 1, max: 1440 },
    ],
  },
]

export function RateLimitCard({
  rateLimits,
  setRateLimits,
  isSaving,
  saveFilterSettings,
}: RateLimitCardProps) {
  const [open, setOpen] = useState(true)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="shadow-sm border-[#EFF3F4]">
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer hover:bg-[#F7F9F9]/50 rounded-t-lg transition-colors">
            <CardTitle className="text-sm sm:text-base flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <Clock className="w-4 h-4 text-[#536471] shrink-0" /> <span>Rate Limiting</span>
              <Badge variant="outline" className="text-[9px] px-1 py-0 bg-[#F7F9F9] text-[#536471] border-[#EFF3F4]">
                {rateLimits.submissionCooldown}m / {rateLimits.submissionDailyCap}/day
              </Badge>
              <ChevronDown className={`w-4 h-4 text-[#71767B] ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3">
            {RATE_GROUPS.map((group) => (
              <div key={group.id} className={`rounded-lg border p-3 ${group.bgColor} ${group.borderColor}`}>
                {/* Group header */}
                <div className="flex items-center gap-2 mb-2">
                  <span className={group.color}>{group.icon}</span>
                  <span className={`text-xs font-semibold ${group.color}`}>{group.label}</span>
                  <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${group.badgeColor}`}>
                    {group.badge}
                  </Badge>
                </div>
                <p className="text-[10px] text-[#71767B] mb-2">{group.description}</p>
                {/* Fields */}
                <div className={`grid gap-2 ${group.fields.length <= 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
                  {group.fields.map((field) => (
                    <div key={field.key}>
                      <label className="text-[10px] font-medium text-[#536471] block mb-1">{field.label}</label>
                      <Input
                        type="number"
                        min={field.min}
                        max={field.max}
                        value={rateLimits[field.key]}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10)
                          const clamped = Math.min(field.max, Math.max(field.min, isNaN(val) ? field.min : val))
                          setRateLimits(prev => ({ ...prev, [field.key]: clamped }))
                        }}
                        className="text-xs h-8 bg-white"
                      />
                      <p className="text-[9px] text-[#71767B] mt-0.5">{field.hint}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* How it works */}
            <div className="bg-[#F7F9F9] rounded-lg p-2 border border-[#EFF3F4] space-y-1">
              <p className="text-[10px] font-medium text-[#536471]">Cara kerja <span className="text-[#71767B] font-normal">(semua reset 00:00 WIB)</span></p>
              <ul className="text-[10px] text-[#71767B] space-y-0.5 list-disc list-inside">
                <li><strong>Cooldown</strong> — user harus menunggu sebelum kirim pesan lagi <span className="text-blue-500">(bypass whitelist)</span></li>
                <li><strong>Batas harian</strong> — maks {rateLimits.submissionDailyCap} pesan per user per hari <span className="text-blue-500">(bypass whitelist)</span></li>
                <li><strong>Batas antrean/user/hari</strong> — maks {rateLimits.userPendingCap} pesan pending per user per hari, sisanya ditolak <span className="text-blue-500">(bypass whitelist)</span></li>
                <li><strong>Batas post/user/hari</strong> — maks {rateLimits.userPostDailyCap} tweet per user per hari di X, sisanya masuk antrean <span className="text-blue-500">(bypass whitelist)</span></li>
                <li><strong>Batas harian global</strong> — maks {rateLimits.globalSubmissionDailyCap} pesan dari semua user per hari <span className="text-amber-500">(selalu aktif)</span></li>
                <li><strong>Jeda auto-post</strong> — jika ada pesan baru dalam {rateLimits.autoPostCooldown} detik setelah auto-post terakhir, masuk antrean admin <span className="text-rose-500">(selalu aktif)</span></li>
                <li><strong>Batas auto-post</strong> — maks {rateLimits.autoPostWindowCap} tweet per {rateLimits.autoPostWindowMinutes} menit, mencegah 226 dari X <span className="text-rose-500">(selalu aktif)</span></li>
              </ul>
            </div>
            <Button
              onClick={saveFilterSettings}
              disabled={isSaving}
              className="w-full bg-[#0F1419] hover:bg-[#272c30]"
            >
              {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Shield className="w-4 h-4 mr-2" />}
              Simpan Rate Limits
            </Button>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
