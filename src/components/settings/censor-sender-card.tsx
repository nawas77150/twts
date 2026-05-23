'use client'

import { EyeOff } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { SettingsCard } from '@/components/shared/settings-card'

interface CensorSenderCardProps {
  censored: boolean
  onToggle: () => void
}

export function CensorSenderCard({ censored, onToggle }: CensorSenderCardProps) {
  return (
    <SettingsCard icon={EyeOff} title="Sembunyikan Pengirim">
      <div className="flex items-center justify-between">
        <div>
          <label htmlFor="censor-sender-switch" className="text-xs font-medium text-[#536471]">
            Censor sender identity
          </label>
          <p className="text-[10px] text-[#71767B]">
            Sembunyikan username & avatar pengirim di dashboard. Berguna saat screenshot.
          </p>
        </div>
        <Switch
          id="censor-sender-switch"
          checked={censored}
          onCheckedChange={onToggle}
        />
      </div>
    </SettingsCard>
  )
}
