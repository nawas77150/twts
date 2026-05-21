'use client'

import {
  Activity,
  RotateCcw,
  Loader2,
  Shield,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SettingsCard } from '@/components/shared/settings-card'
import type { CircuitBreakerStatus, RateLimitSettings } from '@/types'

function CircuitBreakerStatusDisplay({
  status,
  liveRemainingMinutes,
  activeLabel = 'Active',
  showReset = false,
  onReset,
}: {
  status: CircuitBreakerStatus | null
  liveRemainingMinutes: number
  activeLabel?: string
  showReset?: boolean
  onReset?: () => void
}) {
  if (status?.paused) {
    return (
      <>
        <Badge variant="destructive" className="text-[9px] px-1.5 py-0">
          PAUSED — {liveRemainingMinutes}m tersisa
        </Badge>
        {showReset && onReset && (
          <Button variant="outline" size="sm" className="text-[9px] h-5 px-2 ml-auto" onClick={onReset}>
            <RotateCcw className="w-3 h-3 mr-1" /> Reset
          </Button>
        )}
      </>
    )
  }
  if (status && status.failCount > 0) {
    return (
      <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
        {status.failCount}/{status.threshold} gagal
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-green-50 text-green-700 border-green-300">
      {activeLabel}
    </Badge>
  )
}

interface CircuitBreakerCardProps {
  circuitBreakerStatus: CircuitBreakerStatus | null
  liveRemainingMinutes: number
  rateLimits: RateLimitSettings
  setRateLimits: React.Dispatch<React.SetStateAction<RateLimitSettings>>
  reset: () => void
  isSaving: boolean
  onSave: () => void
}

export function CircuitBreakerCard({
  circuitBreakerStatus,
  liveRemainingMinutes,
  rateLimits,
  setRateLimits,
  reset,
  isSaving,
  onSave,
}: CircuitBreakerCardProps) {
  const badges = (
    <CircuitBreakerStatusDisplay
      status={circuitBreakerStatus}
      liveRemainingMinutes={liveRemainingMinutes}
      activeLabel="Active"
    />
  )

  return (
    <SettingsCard icon={Activity} title="Circuit Breaker" badges={badges} contentClassName="space-y-3">
      {/* Status display */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-medium text-[#536471]">Status</span>
        <CircuitBreakerStatusDisplay
          status={circuitBreakerStatus}
          liveRemainingMinutes={liveRemainingMinutes}
          activeLabel="✅ Active — no recent failures"
          showReset
          onReset={reset}
        />
      </div>

      {/* Threshold + Cooldown + Window inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <label htmlFor="cb-threshold" className="text-[10px] font-medium text-[#536471] block mb-1">Kegagalan berturut-turut</label>
          <Input
            id="cb-threshold"
            type="number"
            min={1}
            max={20}
            value={rateLimits.circuitBreakerThreshold}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              setRateLimits(prev => ({ ...prev, circuitBreakerThreshold: Math.min(20, Math.max(1, isNaN(val) ? 1 : val)) }))
            }}
            className="text-xs h-8"
          />
          <p className="text-[9px] text-[#71767B] mt-0.5">Gagal N kali → pause</p>
        </div>
        <div>
          <label htmlFor="cb-cooldown" className="text-[10px] font-medium text-[#536471] block mb-1">Jeda pause (menit)</label>
          <Input
            id="cb-cooldown"
            type="number"
            min={1}
            max={1440}
            value={rateLimits.circuitBreakerCooldownMinutes}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              setRateLimits(prev => ({ ...prev, circuitBreakerCooldownMinutes: Math.min(1440, Math.max(1, isNaN(val) ? 1 : val)) }))
            }}
            className="text-xs h-8"
          />
          <p className="text-[9px] text-[#71767B] mt-0.5">Durasi pause</p>
        </div>
        <div>
          <label htmlFor="cb-window" className="text-[10px] font-medium text-[#536471] block mb-1">Window kegagalan (menit)</label>
          <Input
            id="cb-window"
            type="number"
            min={1}
            max={1440}
            value={rateLimits.circuitBreakerFailureWindowMinutes}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              setRateLimits(prev => ({ ...prev, circuitBreakerFailureWindowMinutes: Math.min(1440, Math.max(1, isNaN(val) ? 1 : val)) }))
            }}
            className="text-xs h-8"
          />
          <p className="text-[9px] text-[#71767B] mt-0.5">Max jarak antar gagal</p>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-[#F7F9F9] rounded-lg p-2 border border-[#EFF3F4] space-y-1">
        <p className="text-[10px] font-medium text-[#536471]">Cara kerja:</p>
        <ul className="text-[10px] text-[#71767B] space-y-0.5 list-disc list-inside">
          <li>Jika {rateLimits.circuitBreakerThreshold}x gagal posting berturut-turut dalam window {rateLimits.circuitBreakerFailureWindowMinutes} menit, auto-post di-pause selama {rateLimits.circuitBreakerCooldownMinutes} menit</li>
          <li>Jika jarak antar kegagalan melebihi window, counter reset — kegagalan lama tidak dihitung</li>
          <li>Submissions masih bisa di-approve manual oleh admin saat circuit breaker aktif</li>
          <li>Reset manual untuk melanjutkan auto-post sebelum waktu habis</li>
        </ul>
      </div>

      <Button
        onClick={onSave}
        disabled={isSaving}
        className="w-full bg-[#0F1419] hover:bg-[#272c30]"
      >
        {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Shield className="w-4 h-4 mr-2" />}
        Simpan Circuit Breaker
      </Button>
    </SettingsCard>
  )
}
