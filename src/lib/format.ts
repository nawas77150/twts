// ============================================================
// format.ts — UI formatting helpers
//
// Extracted from src/types/index.ts to keep types pure.
// Re-exported from @/types for backward compatibility.
// ============================================================

// --- Status Config (for UI rendering) ---

export const STATUS_CONFIG = {
  pending: { label: 'Menunggu', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  censored: { label: 'Disensor', color: 'bg-orange-100 text-orange-800 border-orange-300' },
  posting: { label: 'Posting', color: 'bg-blue-100 text-blue-800 border-blue-300' },
  post_failed: { label: 'Gagal', color: 'bg-red-100 text-red-800 border-red-300' },
  rejected: { label: 'Ditolak', color: 'bg-gray-100 text-gray-600 border-gray-300' },
  posted: { label: 'Diposting', color: 'bg-green-100 text-green-800 border-green-300' },
} as const

// --- Filter Reason Label Helper ---

export function getFilterReasonLabel(reason: string): string {
  // Blocked word — mask the word for display
  if (reason.startsWith('blocked_word:')) {
    const word = reason.replace('blocked_word:', '')
    const masked = word.length > 2
      ? word[0] + '*'.repeat(word.length - 2) + word[word.length - 1]
      : '**'
    return `Blocked: "${masked}"`
  }

  // NSFW word — mask the word for display
  if (reason.startsWith('nsfw_word:')) {
    const word = reason.replace('nsfw_word:', '')
    const masked = word.length > 2
      ? word[0] + '*'.repeat(word.length - 2) + word[word.length - 1]
      : '**'
    return `NSFW: "${masked}"`
  }

  if (reason === 'ai:skipped_error') return 'AI: Skipped (error)'
  if (reason.startsWith('ai:')) return `AI: ${reason.replace('ai:', '')}`

  // Jualan
  if (reason.startsWith('jualan:')) {
    const tag = reason.replace('jualan:', '')
    return `Marketplace (${tag})`
  }

  if (reason === 'contains_url') return 'Link'
  if (reason.startsWith('contains_mention')) return '@Mention'
  if (reason === 'contains_phone_number') return 'No. HP'
  if (reason === 'caps_spam') return 'ALL CAPS'
  if (reason === 'repeated_characters') return 'Spam chars'
  if (reason === 'too_short') return 'Terlalu pendek'
  if (reason === 'duplicate_24h') return 'Duplikat (24j)'
  return reason
}

export function parseFilterReasons(filterReasons: string | null): string[] {
  if (!filterReasons) return []
  try {
    const parsed = JSON.parse(filterReasons)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// --- Date Formatter ---

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
