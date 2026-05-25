'use client'

import { useMemo } from 'react'
import { UserX } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { UserListCard } from '@/components/shared/user-list-card'
import type { UserListCardConfig } from '@/components/shared/user-list-card'

interface BlocklistCardProps {
  blockedUsernames: string[]
  blockedReasons: Record<string, string>
  onBlocklistChange: () => void
}

export function BlocklistCard({ blockedUsernames, blockedReasons, onBlocklistChange }: BlocklistCardProps) {
  const config: UserListCardConfig = useMemo(() => ({
    icon: UserX,
    title: 'Blocklist',
    description: 'User di blocklist tidak bisa mengirim pesan sama sekali. Saat diblokir, user otomatis dihapus dari whitelist. Dikelola secara atomik — tidak akan bentrok jika ada operasi lain yang sedang berjalan.',
    emptyText: 'Belum ada user di blocklist',
    duplicateText: 'User sudah ada di blocklist',
    addErrorText: 'Gagal menambahkan ke blocklist',
    addApi: (username, reason) => apiClient.blockUser(username, reason),
    reasonPlaceholder: 'alasan (opsional)',
    getRowMeta: (username) => blockedReasons[username],
    removeApi: (username) => apiClient.unblockUser(username),
    addSuccessText: (username) => `${username} ditambahkan ke blocklist`,
    removeSuccessText: (username) => `${username} di-unblock`,
    removeErrorText: 'Gagal meng-unblock user',
    addButtonClass: 'bg-red-600 hover:bg-red-700',
    badgeClass: 'bg-red-50 text-red-700',
    rowClass: 'bg-red-50',
    usernameClass: 'text-red-800',
    removeButtonHoverClass: 'hover:text-green-600 hover:bg-green-50',
  }), [blockedReasons])

  return (
    <UserListCard
      config={config}
      usernames={blockedUsernames}
      onChange={onBlocklistChange}
    />
  )
}
