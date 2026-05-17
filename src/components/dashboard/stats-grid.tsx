'use client'

import { BarChart3, Clock, ShieldOff, Loader2, AlertCircle, Ban, CheckCircle, Users } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { Stats } from '@/types'

interface StatsGridProps {
  stats: Stats
  onPenggunaClick: () => void
}

export function StatsGrid({ stats, onPenggunaClick }: StatsGridProps) {
  const statCards = [
    { label: 'Total', value: stats.total, icon: BarChart3, color: 'bg-[#F7F9F9] text-[#3D4145]' },
    { label: 'Menunggu', value: stats.pending, icon: Clock, color: stats.pending > 0 ? 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-300' : 'bg-yellow-50 text-yellow-700' },
    { label: 'Disensor', value: stats.censored, icon: ShieldOff, color: stats.censored > 0 ? 'bg-orange-50 text-orange-700 ring-1 ring-orange-300' : 'bg-orange-50 text-orange-700' },
    { label: 'Posting', value: stats.posting, icon: Loader2, color: 'bg-blue-50 text-blue-700' },
    { label: 'Gagal', value: stats.postFailed, icon: AlertCircle, color: stats.postFailed > 0 ? 'bg-red-50 text-red-700 ring-1 ring-red-300' : 'bg-red-50 text-red-700' },
    { label: 'Ditolak', value: stats.rejected, icon: Ban, color: 'bg-gray-50 text-gray-600' },
    { label: 'Diposting', value: stats.posted, icon: CheckCircle, color: 'bg-green-50 text-green-700' },
    { label: 'Pengguna', value: stats.submitters, icon: Users, color: 'bg-purple-50 text-purple-700' },
  ]

  return (
    <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
      {statCards.map((stat) => {
        const isPengguna = stat.label === 'Pengguna'
        return (
          <Card
            key={stat.label}
            className={`border-0 shadow-sm py-2 md:py-3 ${isPengguna ? 'cursor-pointer hover:ring-2 hover:ring-purple-200 hover:shadow-md transition-all' : ''}`}
            onClick={isPengguna ? onPenggunaClick : undefined}
          >
            <CardContent className="p-2 md:p-3">
              <div className="flex items-center gap-1 md:gap-1.5 mb-0.5">
                <div className={`w-5 h-5 md:w-6 md:h-6 rounded-md ${stat.color} flex items-center justify-center shrink-0`}>
                  <stat.icon className="w-2.5 h-2.5 md:w-3 md:h-3" />
                </div>
                <span className="text-[10px] md:text-xs text-[#536471] truncate">{stat.label}</span>
              </div>
              <p className="text-sm md:text-lg font-bold text-[#0F1419]">{stat.value}</p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
