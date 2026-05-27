'use client'

import { Zap, Ban, Settings, AlertTriangle } from 'lucide-react'
import type { SubmissionLimitsData } from '@/types'
import type { ReactNode } from 'react'

// --- Variant lookup: banned > whitelisted > custom > default ---

const LIMIT_VARIANTS = {
  banned: {
    icon: Ban,
    label: 'Blocked',
    iconColor: 'text-red-600',
    valueColor: 'text-red-700',
    dotColor: 'text-red-400',
    bgColor: 'bg-red-50 border border-red-100',
  },
  whitelisted: {
    icon: Zap,
    label: 'Whitelisted',
    iconColor: 'text-green-600',
    valueColor: 'text-green-700',
    dotColor: 'text-green-400',
    bgColor: 'bg-green-50 border border-green-100',
  },
  custom: {
    icon: Settings,
    label: 'Custom',
    iconColor: 'text-purple-600',
    valueColor: 'text-purple-700',
    dotColor: 'text-purple-400',
    bgColor: 'bg-purple-50 border border-purple-100',
  },
  default: {
    icon: null,
    label: null,
    iconColor: '',
    valueColor: 'text-[#536471]',
    dotColor: 'text-[#71767B]',
    bgColor: 'bg-[#F7F9F9] border border-[#EFF3F4]',
  },
} as const

// --- Shared LimitsBar ---

interface LimitsBarProps {
  limits: SubmissionLimitsData
  /** true = nowrap + py-1.5 (admin card), false = wrap + py-2 (public form) */
  compact?: boolean
  /** When true, antrean metric turns red with inline AlertTriangle */
  pendingOverCap?: boolean
  /** Extra spans appended after the core metrics (e.g. cooldown, status text) */
  children?: ReactNode
}

export function LimitsBar({ limits, compact = false, pendingOverCap = false, children }: LimitsBarProps) {
  const variant = limits.isBanned ? 'banned'
    : limits.isWhitelisted ? 'whitelisted'
    : limits.isCustom ? 'custom'
    : 'default'
  // eslint-disable-next-line security/detect-object-injection -- variant is derived from ternary chain producing only known keys
  const v = LIMIT_VARIANTS[variant]

  const fmt = (used: number, cap: number) => cap > 0 ? `${used}/${cap}` : `${used}/∞`

  const Icon = v.icon

  return (
    <div className={`flex items-center gap-x-2 text-xs px-3 rounded-lg ${v.bgColor} ${
      compact ? 'flex-nowrap overflow-x-auto py-1.5 mt-0.5' : 'flex-wrap gap-y-1 py-2'
    }`}>
      {Icon && (
        <span className={`inline-flex items-center gap-0.5 font-medium ${v.iconColor}`}>
          <Icon className="w-3 h-3" /> {v.label}
        </span>
      )}
      <span className={v.valueColor}>{fmt(limits.dailyUsed, limits.dailyCap)} hari ini</span>
      <span className={v.dotColor}>&middot;</span>
      <span className={pendingOverCap ? 'text-red-500' : v.valueColor}>
        antrean {fmt(limits.pendingUsed, limits.pendingCap)}
        {pendingOverCap && <AlertTriangle className="w-3 h-3 inline ml-0.5" />}
      </span>
      <span className={v.dotColor}>&middot;</span>
      <span className={v.valueColor}>post {fmt(limits.postUsed, limits.postCap)}</span>
      {children}
    </div>
  )
}
