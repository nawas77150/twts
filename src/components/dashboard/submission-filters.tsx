'use client'

import { Filter, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Stats } from '@/types'
import { STATUS_CONFIG } from '@/types'

interface SubmissionFiltersProps {
  filterStatus: string
  setFilter: (status: string) => void
  search: string
  setSearch: (search: string) => void
  onRefresh: () => void
  isLoading: boolean
  stats: Stats | null
}

export function SubmissionFilters({
  filterStatus,
  setFilter,
  search,
  setSearch,
  onRefresh,
  isLoading,
  stats,
}: SubmissionFiltersProps) {
  const filterOptions = ['all', 'pending', 'post_failed', 'rejected', 'posted'] as const

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
      {filterOptions.map((status) => {
        const statsKey = status === 'post_failed' ? 'postFailed' : status
        const statusCount =
          status === 'all'
            ? stats?.total
            : stats?.[statsKey as keyof Stats] as number | undefined
        return (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all shrink-0 ${
              filterStatus === status
                ? 'bg-[#0F1419] text-white'
                : 'bg-white border border-[#EFF3F4] text-[#536471] hover:bg-[#F7F9F9]'
            }`}
          >
            {status === 'all'
              ? 'Semua'
              : STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]?.label}
            {statusCount != null && statusCount > 0 && (
              <span
                className={`text-[10px] ${
                  filterStatus === status ? 'text-white/70' : 'text-[#71767B]'
                }`}
              >
                {statusCount}
              </span>
            )}
          </button>
        )
      })}
      <div className="relative ml-2 shrink-0">
        <Input
          placeholder="Cari pesan atau username..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-7 h-7 text-xs w-32 sm:w-44 border-[#EFF3F4]"
        />
        <Filter className="w-3 h-3 text-[#71767B] absolute left-2 top-1/2 -translate-y-1/2" />
        {search && (
          <button
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#71767B] hover:text-[#0F1419] text-xs leading-none"
            onClick={() => setSearch('')}
          >
            ×
          </button>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        className="ml-auto shrink-0 text-[#71767B] h-7 w-7 p-0"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
      </Button>
    </div>
  )
}
