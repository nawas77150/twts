'use client'

import type { SubmissionStatus } from '@/types'
import { STATUS_CONFIG } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { safeAccess } from '@/lib/utils'

interface StatusBadgeProps {
  status: SubmissionStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = safeAccess(STATUS_CONFIG, status)
  if (!config) return null

  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1.5 py-0 ${config.color} ${className ?? ''}`}
    >
      {config.label}
    </Badge>
  )
}
