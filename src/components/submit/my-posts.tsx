'use client'

import { User, RefreshCw, MessageSquare, ExternalLink, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/shared/status-badge'
import { FilterReasons } from '@/components/shared/filter-reasons'
import { formatDate, type Submission } from '@/types'

interface MyPostsProps {
  posts: Submission[]
  isLoading: boolean
  error?: string | null
  onRefresh: () => void
}

export function MyPosts({ posts, isLoading, error, onRefresh }: MyPostsProps) {
  const showRefresh = isLoading || posts.length > 0

  return (
    <Card className="max-w-lg mx-auto mt-6 shadow-lg border-[#EFF3F4]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4 text-[#536471]" /> Postinganku
          </CardTitle>
          {showRefresh && (
            <Button
              variant="ghost"
              onClick={onRefresh}
              disabled={isLoading}
              className="h-6 w-6 p-0 text-[#71767B]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          )}
        </div>
        <CardDescription>Pesan yang sudah kamu kirim dan statusnya</CardDescription>
      </CardHeader>
      <CardContent>
        {error && !isLoading && posts.length === 0 ? (
          <div className="text-center py-6">
            <AlertCircle className="w-8 h-8 text-red-300 mx-auto mb-2" />
            <p className="text-sm text-red-500">{error}</p>
            <Button variant="link" className="text-xs text-[#71767B] mt-1" onClick={onRefresh}>
              Coba lagi
            </Button>
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-6">
            <MessageSquare className="w-8 h-8 text-[#EFF3F4] mx-auto mb-2" />
            <p className="text-sm text-[#71767B]">Belum ada pesan yang dikirim</p>
          </div>
        ) : (
          <div className="divide-y divide-[#EFF3F4] border border-[#EFF3F4] rounded-lg max-h-72 overflow-y-auto">
            {posts.map((post) => (
              <div key={post.id} className="px-3 py-2 hover:bg-[#F7F9F9]/50 transition-colors">
                <div className="flex items-center gap-2 mb-0.5">
                  <StatusBadge status={post.status} />
                  <span className="text-[10px] text-[#71767B]">{formatDate(post.createdAt)}</span>
                  {post.status === 'posted' && post.tweetId && (
                    <a
                      href={`https://x.com/i/status/${post.tweetId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#71767B] hover:text-[#0F1419] ml-auto"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <p className="text-sm text-[#0F1419] whitespace-pre-wrap break-words leading-snug line-clamp-2">{post.message}</p>
                <FilterReasons filterReasons={post.filterReasons} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
