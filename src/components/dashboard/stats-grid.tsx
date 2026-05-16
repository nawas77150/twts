'use client'

import { BarChart3, Clock, AlertCircle, Ban, CheckCircle, Users } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { Stats } from '@/types'

interface StatsGridProps {
  stats: Stats
  onPenggunaClick: () => void
}

export function StatsGrid({ stats, onPenggunaClick }: StatsGridProps) {
  const statCards = [
    { label: 'Total', value: stats.total, icon: BarChart3, color: 'bg-[#F7F9F9] text-[#3D4145]' },
    { label: 'Menunggu', value: stats.pending, icon: Clock, color: stats.pending > 0 ? 'bg-yellow-50 text-yellow-700 ring-2 ring-yellow-300' : 'bg-yellow-50 text-yellow-700' },
    { label: 'Gagal Posting', value: stats.postFailed, icon: AlertCircle, color: stats.postFailed > 0 ? 'bg-red-50 text-red-700 ring-2 ring-red-300' : 'bg-red-50 text-red-700' },
    { label: 'Ditolak', value: stats.rejected, icon: Ban, color: 'bg-red-50 text-red-700' },
    { label: 'Diposting', value: stats.posted, icon: CheckCircle, color: 'bg-[#F7F9F9] text-[#536471]' },
    { label: 'Pengguna', value: stats.submitters, icon: Users, color: 'bg-purple-50 text-purple-700' },
  ]

  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
      {statCards.map((stat) => {
        const isPengguna = stat.label === 'Pengguna'
        return (
          <Card
            key={stat.label}
            className={`border-0 shadow-sm py-3 md:py-6 ${isPengguna ? 'cursor-pointer hover:ring-2 hover:ring-purple-200 hover:shadow-md transition-all' : ''}`}
            onClick={isPengguna ? onPenggunaClick : undefined}
          >
            <CardContent className="p-3 md:p-4">
              <div className="flex items-center gap-1.5 md:gap-2 mb-0.5 md:mb-1">
                <div className={`w-6 h-6 md:w-7 md:h-7 rounded-lg ${stat.color} flex items-center justify-center`}>
                  <stat.icon className="w-3 h-3 md:w-3.5 md:h-3.5" />
                </div>
                <span className="text-xs text-[#536471] hidden sm:inline">{stat.label}</span>
              </div>
              <p className="text-lg md:text-2xl font-bold text-[#0F1419]">{stat.value}</p>
              <span className="text-[10px] md:text-xs text-[#71767B] sm:hidden">{stat.label}</span>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
