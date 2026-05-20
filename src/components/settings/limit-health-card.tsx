'use client'

import { useState, useEffect, useCallback } from 'react'
import { Activity, RefreshCw, Loader2, User, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { apiClient } from '@/lib/api-client'
import { SettingsCard } from '@/components/shared/settings-card'

interface LimitHitSummary {
  limitType: string
  label: string
  totalHits: number
  uniqueUsers: number
}

interface LimitHitsData {
  summary: LimitHitSummary[]
  topUsers: { username: string; hits: number }[]
  totalHits: number
  windowLabel: string
}

// Map (not Record) avoids the "Generic Object Injection Sink" SAST warning:
// plain objects have a prototype chain (__proto__, constructor) that SAST
// flags on dynamic-key access. Map.get() has no prototype chain.
const TYPE_COLORS = new Map<string, { bg: string; text: string; border: string }>([
  ['cooldown', { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' }],
  ['daily_cap', { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' }],
  ['pending_cap', { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' }],
  ['global_cap', { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' }],
  ['post_cap', { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' }],
])

const DEFAULT_COLORS = { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' }

export function LimitHealthCard() {
  const [data, setData] = useState<LimitHitsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchHits = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiClient.getLimitHits()
      setData(res)
    } catch {
      setError('Gagal memuat data limit.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchHits()
  }, [fetchHits])

  const hasHits = data && data.totalHits > 0

  const badges = (
    <>
      {hasHits && (
        <Badge variant="outline" className="text-[9px] px-1 py-0 bg-amber-50 text-amber-700 border-amber-200">
          {data.totalHits} hit{data.totalHits !== 1 ? 's' : ''}/{data.windowLabel}
        </Badge>
      )}
      {!hasHits && data && (
        <Badge variant="outline" className="text-[9px] px-1 py-0 bg-green-50 text-green-700 border-green-200">
          0 hits
        </Badge>
      )}
    </>
  )

  return (
    <SettingsCard icon={Activity} title="Limit Health" badges={badges} contentClassName="space-y-3">
      {loading && !data && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-[#71767B]" />
        </div>
      )}

      {error && !data && (
        <div className="flex flex-col items-center py-4 gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
          <p className="text-xs text-amber-600">{error}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchHits}
            className="text-[10px] h-7 px-2 text-[#71767B]"
          >
            Coba lagi
          </Button>
        </div>
      )}

      {data && (
        <>
          {/* Summary grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {data.summary.map((item) => {
              const colors = TYPE_COLORS.get(item.limitType) ?? DEFAULT_COLORS
              const isHot = item.totalHits >= 20
              return (
                <div key={item.limitType} className={`rounded-lg border p-2 ${colors.bg} ${colors.border}`}>
                  <p className={`text-[10px] font-medium ${colors.text}`}>{item.label}</p>
                  <p className={`text-lg font-bold ${isHot ? 'text-red-600' : colors.text}`}>
                    {item.totalHits}
                  </p>
                  <p className="text-[9px] text-[#71767B]">
                    {item.uniqueUsers} user{item.uniqueUsers !== 1 ? 's' : ''}
                  </p>
                </div>
              )
            })}
          </div>

          {/* Top blocked users */}
          {data.topUsers.length > 0 && (
            <div className="bg-[#F7F9F9] rounded-lg p-2 border border-[#EFF3F4]">
              <p className="text-[10px] font-medium text-[#536471] mb-1.5 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> User paling sering diblokir (hari ini)
              </p>
              <div className="space-y-1">
                {data.topUsers.map((user, i) => (
                  <div key={user.username} className="flex items-center gap-2 text-xs">
                    <span className="text-[10px] text-[#71767B] w-3 text-right">{i + 1}</span>
                    <User className="w-3 h-3 text-[#71767B]" />
                    <span className="font-medium text-[#0F1419]">@{user.username}</span>
                    <span className="ml-auto text-[#71767B]">{user.hits}×</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!hasHits && (
            <p className="text-xs text-[#71767B] text-center py-2">
              Belum ada limit hit hari ini
            </p>
          )}
        </>
      )}

      {/* Refresh button */}
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchHits}
          disabled={loading}
          className="text-[10px] h-7 px-2 text-[#71767B]"
        >
          <RefreshCw className={`w-3 h-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
    </SettingsCard>
  )
}
