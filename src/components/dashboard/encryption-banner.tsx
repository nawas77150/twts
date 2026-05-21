'use client'

import { ShieldAlert } from 'lucide-react'
import { useAdminStats } from '@/contexts/admin-stats-context'

export function EncryptionBanner() {
  const { stats } = useAdminStats()
  const encryptionEnabled = stats?.encryptionEnabled

  // Show shimmer while loading
  if (encryptionEnabled === undefined) {
    return (
      <div className="rounded-lg border border-[#EFF3F4] bg-[#F7F9F9] p-3 animate-pulse">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-gray-200 shrink-0" />
          <div className="h-4 bg-gray-200 rounded w-40" />
        </div>
      </div>
    )
  }
  if (encryptionEnabled === true) return null

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
      <ShieldAlert className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-amber-800">
          Enkripsi tidak aktif
        </p>
        <p className="text-xs text-amber-700">
          ENCRYPTION_KEY belum dikonfigurasi. Data sensitif (API key, cookie, password) disimpan dalam plaintext di database.
          Buat key dengan <code className="bg-amber-100 px-1 rounded">openssl rand -hex 32</code> lalu set di environment variables.
        </p>
      </div>
    </div>
  )
}
