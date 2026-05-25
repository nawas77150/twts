'use client'

import { Badge } from '@/components/ui/badge'
import { ShieldAlert, Info } from 'lucide-react'
import { getFilterReasonLabel, parseFilterReasons } from '@/lib/format'

interface FilterReasonsProps {
  filterReasons: string | null
}

export function FilterReasons({ filterReasons }: FilterReasonsProps) {
  const reasons = parseFilterReasons(filterReasons)
  if (reasons.length === 0) return null

  // Separate informational reasons from censor reasons
  const infoReasons = reasons.filter(r => r === 'ai:skipped_error')
  const censorReasons = reasons.filter(r => r !== 'ai:skipped_error')

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {/* Censor flags */}
      {censorReasons.length > 0 && (
        <Badge
          variant="outline"
          className="text-[8px] px-1 py-0 bg-amber-50 text-amber-700 border-amber-200 gap-0.5"
        >
          <ShieldAlert className="w-2.5 h-2.5" />
          {censorReasons.length} filter flag{censorReasons.length > 1 ? 's' : ''}
        </Badge>
      )}
      {censorReasons.slice(0, 3).map((reason) => (
        <span
          key={`censor-${reason}`}
          className="text-[8px] px-1 py-0.5 rounded bg-red-50 text-red-600 border border-red-200"
        >
          {getFilterReasonLabel(reason)}
        </span>
      ))}
      {censorReasons.length > 3 && (
        <span className="text-[8px] text-[#71767B]">
          +{censorReasons.length - 3} more
        </span>
      )}

      {/* Informational flags (Gemini skipped due to error) */}
      {infoReasons.map((reason) => (
        <span
          key={`info-${reason}`}
          className="text-[8px] px-1 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200 flex items-center gap-0.5"
        >
          <Info className="w-2 h-2" />
          {getFilterReasonLabel(reason)}
        </span>
      ))}
    </div>
  )
}
