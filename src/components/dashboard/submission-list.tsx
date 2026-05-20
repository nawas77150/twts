'use client'

import { AnimatePresence } from 'framer-motion'
import { Loader2, MessageSquare, Search } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SubmissionCard } from '@/components/dashboard/submission-card'
import type { Submission } from '@/types'

interface SubmissionListProps {
  submissions: Submission[]
  search: string
  setSearch: (search: string) => void
  filterStatus: string
  isLoading: boolean
  actionLoading: string | null
  page: number
  totalPages: number
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onRetryPost: (id: string) => void
  onDelete: (id: string) => void
  onPageChange: (page: number) => void
}

export function SubmissionList({
  submissions,
  search,
  setSearch,
  filterStatus,
  isLoading,
  actionLoading,
  page,
  totalPages,
  onApprove,
  onReject,
  onRetryPost,
  onDelete,
  onPageChange,
}: SubmissionListProps) {
  if (isLoading) {
    return (
      <Card className="py-12">
        <CardContent className="flex items-center justify-center gap-2 text-[#71767B]">
          <Loader2 className="w-5 h-5 animate-spin" /> Memuat data...
        </CardContent>
      </Card>
    )
  }

  // No results — filter-aware empty state
  if (submissions.length === 0 && !search) {
    const isFiltered = filterStatus !== 'all'
    const statusLabel = isFiltered ? `"${filterStatus}"` : null
    return (
      <Card className="py-12">
        <CardContent className="text-center">
          <div className="w-12 h-12 rounded-xl bg-[#F7F9F9] flex items-center justify-center mx-auto mb-3">
            <MessageSquare className="w-6 h-6 text-[#71767B]" />
          </div>
          <p className="text-[#536471]">
            {isFiltered
              ? `Tidak ada pesan dengan status ${statusLabel}`
              : 'Belum ada pesan'}
          </p>
          <p className="text-xs text-[#71767B] mt-1">
            {isFiltered
              ? 'Coba ganti filter atau hapus filter'
              : 'Pesan yang masuk akan muncul di sini'}
          </p>
        </CardContent>
      </Card>
    )
  }

  // Search returned no results
  if (submissions.length === 0 && search) {
    return (
      <Card className="py-8">
        <CardContent className="text-center">
          <div className="w-10 h-10 rounded-xl bg-[#F7F9F9] flex items-center justify-center mx-auto mb-2">
            <Search className="w-5 h-5 text-[#71767B]" />
          </div>
          <p className="text-sm text-[#536471]">
            Tidak ada hasil untuk &ldquo;{search}&rdquo;
          </p>
          <Button
            variant="link"
            className="text-xs text-[#71767B] mt-1"
            onClick={() => { setSearch('') }}
          >
            Hapus pencarian
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <div className="space-y-3 max-h-[calc(100vh-260px)] overflow-y-auto pr-1">
        <AnimatePresence mode="popLayout">
          {submissions.map((sub) => (
            <SubmissionCard
              key={sub.id}
              submission={sub}
              onApprove={onApprove}
              onReject={onReject}
              onRetryPost={onRetryPost}
              onDelete={onDelete}
              actionLoading={actionLoading}
            />
          ))}
        </AnimatePresence>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 py-3">
          <Button
            variant="outline"
            className="h-7 w-7 p-0 text-xs"
            disabled={page <= 1}
            onClick={() => { onPageChange(page - 1) }}
          >
            ‹
          </Button>
          {(() => {
            const pages: (number | 'ellipsis-start' | 'ellipsis-end')[] = []
            const tp = totalPages
            const cp = page
            if (tp <= 7) {
              for (let i = 1; i <= tp; i++) pages.push(i)
            } else {
              pages.push(1)
              if (cp > 3) pages.push('ellipsis-start')
              const start = Math.max(2, cp - 1)
              const end = Math.min(tp - 1, cp + 1)
              for (let i = start; i <= end; i++) pages.push(i)
              if (cp < tp - 2) pages.push('ellipsis-end')
              pages.push(tp)
            }
            return pages.map((p) =>
              typeof p !== 'number' ? (
                <span key={p} className="px-1 text-xs text-[#71767B]">
                  …
                </span>
              ) : (
                <Button
                  key={p}
                  variant={p === page ? 'default' : 'outline'}
                  className={`h-7 w-7 p-0 text-xs ${
                    p === page ? 'bg-[#0F1419] hover:bg-[#272c30]' : ''
                  }`}
                  onClick={() => { onPageChange(p) }}
                >
                  {p}
                </Button>
              )
            )
          })()}
          <Button
            variant="outline"
            className="h-7 w-7 p-0 text-xs"
            disabled={page >= totalPages}
            onClick={() => { onPageChange(page + 1) }}
          >
            ›
          </Button>
        </div>
      )}
    </>
  )
}
