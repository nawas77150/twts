'use client'

import { Activity } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { PostMethodStats } from '@/types'

interface PostMethodRatesProps {
  postMethodStats: PostMethodStats
}

export function PostMethodRates({ postMethodStats }: PostMethodRatesProps) {
  if (postMethodStats.total === 0) return null

  const { directRate, retryRate, fallbackRate, direct, retry, fallback, total } = postMethodStats

  return (
    <Card className="py-0 gap-0 shadow-sm border-[#EFF3F4]">
      <CardContent className="p-2.5">
        {/* Title */}
        <div className="flex items-center gap-1.5 mb-2">
          <Activity className="w-3 h-3 text-[#536471]" />
          <span className="text-xs font-medium text-[#0F1419]">Post Method Rate</span>
          <span className="text-[10px] text-[#71767B]">{total} post terakhir</span>
        </div>

        {/* Stacked bar */}
        <div className="flex w-full h-2.5 rounded-full bg-[#F7F9F9] overflow-hidden mb-2">
          <div
            className="bg-green-500 transition-all duration-500"
            style={{ width: `${directRate}%` }}
          />
          <div
            className="bg-amber-500 transition-all duration-500"
            style={{ width: `${retryRate}%` }}
          />
          <div
            className="bg-purple-500 transition-all duration-500"
            style={{ width: `${fallbackRate}%` }}
          />
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="text-[#536471]">Normal <span className="font-medium text-[#0F1419]">{directRate}%</span></span>
            <span className="text-[#71767B]">({direct}/{total})</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span className="text-[#536471]">Retry <span className="font-medium text-[#0F1419]">{retryRate}%</span></span>
            <span className="text-[#71767B]">({retry}/{total})</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
            <span className="text-[#536471]">Fallback <span className="font-medium text-[#0F1419]">{fallbackRate}%</span></span>
            <span className="text-[#71767B]">({fallback}/{total})</span>
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
