'use client'

import { Hash, Loader2, RotateCcw } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SettingsCard } from '@/components/shared/settings-card'

interface HashtagsCardProps {
  postHashtags: string
  setPostHashtags: (v: string) => void
  isSavingSetting: string | null
  saveSetting: (key: string, value: string, onSuccess?: () => void) => void
}

export function HashtagsCard({
  postHashtags,
  setPostHashtags,
  isSavingSetting,
  saveSetting,
}: HashtagsCardProps) {
  const charCount = postHashtags.length
  const isOverLimit = charCount > 60

  // Validate: each tag must start with # and be at least 2 chars
  const invalidTags = postHashtags.trim()
    ? postHashtags.trim().split(/\s+/).filter(t => !t.startsWith('#') || t.length < 2)
    : []
  const hasInvalid = invalidTags.length > 0

  const canSave = !isSavingSetting && !isOverLimit && !hasInvalid && postHashtags.trim().length > 0

  const badges = postHashtags.trim() ? (
    <Badge variant="outline" className="text-[10px] px-1.5 bg-green-50 text-green-700 border-green-300">
      {postHashtags.trim().split(/\s+/).length} tag{postHashtags.trim().split(/\s+/).length !== 1 ? 's' : ''}
    </Badge>
  ) : null

  return (
    <SettingsCard icon={Hash} title="Post Hashtags" badges={badges}>
      <div className="space-y-2">
        <label htmlFor="post-hashtags-input" className="text-xs font-medium text-[#536471]">
          Hashtags (ditambahkan otomatis di akhir setiap post)
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            id="post-hashtags-input"
            type="text"
            placeholder="#tweetfess #curhat #anon"
            value={postHashtags}
            onChange={(e) => { setPostHashtags(e.target.value) }}
            className={`border-[#EFF3F4] ${isOverLimit || hasInvalid ? 'border-red-300 focus-visible:ring-red-200' : ''}`}
            maxLength={60}
          />
          <div className="flex gap-1">
            <Button
              onClick={() => { saveSetting('post_hashtags', postHashtags) }}
              disabled={!canSave}
              className="bg-[#0F1419] hover:bg-[#272c30] shrink-0"
            >
              {isSavingSetting === 'post_hashtags' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Simpan'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { saveSetting('post_hashtags', '', () => { setPostHashtags('') }) }}
              disabled={!!isSavingSetting}
              className="border-[#EFF3F4] text-[#536471] shrink-0"
              title="Hapus hashtag"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Validation messages */}
        {hasInvalid && (
          <p className="text-[10px] text-red-500">
            Setiap hashtag harus diawali # dan minimal 2 karakter. Invalid: {invalidTags.join(', ')}
          </p>
        )}
        {isOverLimit && (
          <p className="text-[10px] text-red-500">
            Maksimal 60 karakter total ({charCount}/60)
          </p>
        )}

        <div className="flex justify-between items-center">
          <p className="text-[10px] text-[#71767B]">
            Pisahkan dengan spasi. Contoh: <code className="bg-[#EFF3F4] px-1 rounded">#confess #anon</code>
          </p>
          <span className={`text-[10px] font-medium ${isOverLimit ? 'text-red-500' : charCount > 50 ? 'text-amber-500' : 'text-[#71767B]'}`}>
            {charCount}/60
          </span>
        </div>

        {postHashtags.trim() && !hasInvalid && (
          <div className="bg-[#F7F9F9] border border-[#EFF3F4] rounded-lg p-2 text-[10px] text-[#536471] flex items-start gap-1.5">
            <span>Pengguna akan melihat: <strong>Maks {280 - 1 - postHashtags.trim().length} karakter</strong> ({postHashtags.trim().length + 1} untuk {postHashtags.trim()})</span>
          </div>
        )}
      </div>
    </SettingsCard>
  )
}
