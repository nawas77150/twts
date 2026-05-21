'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'
import { CheckCircle, AlertCircle, Loader2, ExternalLink, Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { XLogo } from '@/components/shared/x-logo'
import { StatusBadge } from '@/components/shared/status-badge'
import { FilterReasons } from '@/components/shared/filter-reasons'
import type { Submission } from '@/types'
import { formatDate } from '@/types'

interface SubmissionCardProps {
  submission: Submission
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onRetryPost: (id: string) => void
  onDelete: (id: string) => void
  actionLoading: Set<string>
}

export function SubmissionCard({
  submission: sub,
  onApprove,
  onReject,
  onRetryPost,
  onDelete,
  actionLoading,
}: SubmissionCardProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="py-0 gap-0 shadow-sm border-[#EFF3F4] hover:shadow-md transition-shadow">
        <CardContent className="p-3">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1.5">
                {sub.submitter.profileImage ? (
                  <Image
                    src={sub.submitter.profileImage}
                    alt=""
                    width={24}
                    height={24}
                    className="w-5 h-5 rounded-full border border-[#EFF3F4]"
                  />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-[#272c30] flex items-center justify-center text-white text-[9px] font-bold shrink-0">
                    {sub.submitter.username.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-[11px] font-medium text-[#536471]">
                  @{sub.submitter.username}
                </span>
                {sub.submitter.twitterId && (
                  <a
                    href={`https://x.com/i/user/${sub.submitter.twitterId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-[#536471] hover:underline flex items-center gap-0.5"
                  >
                    <XLogo className="w-2.5 h-2.5" />
                  </a>
                )}
                <StatusBadge status={sub.status} />
                {sub.status === 'posted' && sub.postMethod && sub.postMethod !== 'direct' && (
                  <Badge
                    variant="outline"
                    className={`text-[8px] px-1 py-0 ${
                      sub.postMethod === 'retry'
                        ? 'bg-amber-50 text-amber-600 border-amber-200'
                        : sub.postMethod === 'fallback' || sub.postMethod === 'fallback_cookie'
                        ? 'bg-purple-50 text-purple-600 border-purple-200'
                        : sub.postMethod === 'fallback_login'
                        ? 'bg-orange-50 text-orange-600 border-orange-200'
                        : 'bg-[#F7F9F9] text-[#536471] border-[#EFF3F4]'
                    }`}
                  >
                    {sub.postMethod === 'retry'
                      ? 'retry'
                      : sub.postMethod === 'fallback' || sub.postMethod === 'fallback_cookie'
                      ? 'Cookie API'
                      : sub.postMethod === 'fallback_login'
                      ? 'V2 Login'
                      : sub.postMethod}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-[#0F1419] whitespace-pre-wrap break-words">
                {sub.message}
              </p>
              {sub.category && (
                <span className="inline-block text-[11px] text-[#71767B] mt-0.5">
                  #{sub.category}
                </span>
              )}
              <FilterReasons filterReasons={sub.filterReasons} />
              {sub.status === 'post_failed' && sub.postError && (
                <div className="flex items-start gap-1.5 mt-1.5 p-1.5 rounded-md bg-red-50 border border-red-200">
                  <AlertCircle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
                  <span className="text-[10px] text-red-700 leading-tight break-words">
                    {sub.postError}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-[10px] text-[#71767B]">
                  {formatDate(sub.createdAt)}
                </p>
                {sub.tweetId && (
                  <a
                    href={`https://x.com/i/status/${sub.tweetId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-[#536471] hover:underline inline-flex items-center gap-0.5"
                  >
                    Lihat tweet <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1 shrink-0 self-end sm:self-start">
              {(sub.status === 'pending' || sub.status === 'censored') && (
                <>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        disabled={actionLoading.has(sub.id)}
                        className="h-7 px-2 text-xs bg-green-500 hover:bg-green-600 text-white"
                      >
                        {actionLoading.has(sub.id) ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <CheckCircle className="w-3 h-3 mr-1" />
                        )}
                        Setujui
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Setujui pesan ini?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Pesan akan diposting ke X.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-green-500 hover:bg-green-600 text-white"
                          onClick={() => { onApprove(sub.id) }}
                        >
                          Setujui
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        disabled={actionLoading.has(sub.id)}
                        className="h-7 px-2 text-xs"
                      >
                        Tolak
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Tolak pesan ini?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Pesan yang ditolak tidak dapat dibatalkan.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-red-500 hover:bg-red-600 text-white"
                          onClick={() => { onReject(sub.id) }}
                        >
                          Tolak
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
              {sub.status === 'post_failed' && (
                <Button
                  onClick={() => { onRetryPost(sub.id) }}
                  disabled={actionLoading.has(sub.id)}
                  className="h-7 px-2 text-xs bg-[#0F1419] hover:bg-[#272c30] text-white"
                >
                  {actionLoading.has(sub.id) ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <XLogo className="w-3 h-3 mr-1" />
                  )}
                  Retry Post
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    disabled={actionLoading.has(sub.id)}
                    className="h-7 w-7 p-0 text-[#71767B] hover:text-red-500"
                    aria-label="Hapus pesan"
                  >
                    {actionLoading.has(sub.id) ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Hapus pesan ini?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Pesan akan dihapus permanen dan tidak dapat dikembalikan.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-500 hover:bg-red-600 text-white"
                      onClick={() => { onDelete(sub.id) }}
                    >
                      Hapus
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}
