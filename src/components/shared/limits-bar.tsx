'use client'

import { Zap, Ban, Settings, AlertTriangle, CalendarDays, Hourglass, Send } from 'lucide-react'
import type { SubmissionLimitsData } from '@/types'
import type { ReactNode } from 'react'

function getVariant(limits: SubmissionLimitsData) {
  if (limits.isBanned) return { Icon: Ban,     iconCls: 'text-red-600',    valCls: 'text-red-700',    bgCls: 'bg-red-50 border border-red-100' }
  if (limits.isWhitelisted) return { Icon: Zap,     iconCls: 'text-green-600',  valCls: 'text-green-700',  bgCls: 'bg-green-50 border border-green-100' }
  if (limits.isCustom) return { Icon: Settings, iconCls: 'text-purple-600', valCls: 'text-purple-700', bgCls: 'bg-purple-50 border border-purple-100' }
  return { Icon: null,     iconCls: '',                valCls: 'text-[#536471]',  bgCls: 'bg-[#F7F9F9] border border-[#EFF3F4]' }
}

const DOT = 'text-[#71767B]'

function fmt(used: number, cap: number) {
  return cap > 0 ? `${used}/${cap}` : `${used}/∞`
}

interface LimitsBarProps {
  limits: SubmissionLimitsData
  compact?: boolean
  pendingOverCap?: boolean
  children?: ReactNode
}

export function LimitsBar({ limits, compact = false, pendingOverCap = false, children }: LimitsBarProps) {
  const v = getVariant(limits)
  const StatusIcon = v.Icon

  return (
    <div className={`flex items-center gap-x-2 text-xs px-3 rounded-lg ${v.bgCls} ${compact ? 'flex-nowrap overflow-x-auto py-1.5 mt-0.5' : 'flex-wrap gap-y-1 py-2'}`}>
      {StatusIcon && <StatusIcon className={`w-3 h-3 ${v.iconCls}`} />}

      {compact ? (
        <>
          <span className={`inline-flex items-center gap-0.5 ${v.valCls}`}>
            <CalendarDays className="w-3 h-3" /> {fmt(limits.dailyUsed, limits.dailyCap)}
          </span>
          <span className={DOT}>&middot;</span>
          <span className={`inline-flex items-center gap-0.5 ${pendingOverCap ? 'text-red-500' : v.valCls}`}>
            <Hourglass className="w-3 h-3" /> {fmt(limits.pendingUsed, limits.pendingCap)}
            {pendingOverCap && <AlertTriangle className="w-3 h-3 ml-0.5" />}
          </span>
          <span className={DOT}>&middot;</span>
          <span className={`inline-flex items-center gap-0.5 ${v.valCls}`}>
            <Send className="w-3 h-3" /> {fmt(limits.postUsed, limits.postCap)}
          </span>
        </>
      ) : (
        <>
          <span className={v.valCls}>{fmt(limits.dailyUsed, limits.dailyCap)} hari ini</span>
          <span className={DOT}>&middot;</span>
          <span className={pendingOverCap ? 'text-red-500' : v.valCls}>
            antrean {fmt(limits.pendingUsed, limits.pendingCap)}
            {pendingOverCap && <AlertTriangle className="w-3 h-3 inline ml-0.5" />}
          </span>
          <span className={DOT}>&middot;</span>
          <span className={v.valCls}>post {fmt(limits.postUsed, limits.postCap)}</span>
        </>
      )}
      {children}
    </div>
  )
}
