'use client'

import { useState } from 'react'
import {
  Settings,
  AlertTriangle,
  Zap,
  Loader2,
  RotateCcw,
  CircleDot,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { SettingsCard } from '@/components/shared/settings-card'
import { SecretInput } from '@/components/shared/secret-input'
import { GuideSection } from '@/components/shared/guide-section'
import type { CookieAuthStatus } from '@/types'

interface DirectPostingCardProps {
  cookieString: string
  setCookieString: (v: string) => void
  bearerToken: string
  setBearerToken: (v: string) => void
  queryId: string
  setQueryId: (v: string) => void
  showCookieValue: boolean
  setShowCookieValue: (v: boolean) => void
  showBearerValue: boolean
  setShowBearerValue: (v: boolean) => void
  showCookieGuide: boolean
  setShowCookieGuide: (v: boolean) => void
  showQueryIdGuide: boolean
  setShowQueryIdGuide: (v: boolean) => void
  showBearerGuide: boolean
  setShowBearerGuide: (v: boolean) => void
  isSavingSetting: string | null
  isClearingCache: boolean
  saveSetting: (key: string, value: string, onSuccess?: () => void) => void
  clearCache: () => void
  cookieStatus: CookieAuthStatus | null
}

export function DirectPostingCard({
  cookieString,
  setCookieString,
  bearerToken,
  setBearerToken,
  queryId,
  setQueryId,
  showCookieValue,
  setShowCookieValue,
  showBearerValue,
  setShowBearerValue,
  showCookieGuide,
  setShowCookieGuide,
  showQueryIdGuide,
  setShowQueryIdGuide,
  showBearerGuide,
  setShowBearerGuide,
  isSavingSetting,
  isClearingCache,
  saveSetting,
  clearCache,
  cookieStatus,
}: DirectPostingCardProps) {
  const statusBadge = cookieStatus?.configured ? (
    <Badge variant="outline" className="text-[10px] px-1.5 bg-green-50 text-green-700 border-green-300">
      <CircleDot className="w-2.5 h-2.5 mr-1 fill-green-500 text-green-500" />
      Connected
    </Badge>
  ) : (
    <Badge variant="outline" className="text-[10px] px-1.5 bg-red-50 text-red-700 border-red-300">
      <CircleDot className="w-2.5 h-2.5 mr-1 fill-red-500 text-red-500" />
      Not configured
    </Badge>
  )

  return (
    <SettingsCard icon={Settings} title="Direct Posting (Cookie Method)" badges={statusBadge}>
      {/* Cookie String */}
      <div className="space-y-2">
        <label htmlFor="cookie-string-input" className="text-xs font-medium text-[#536471]">Cookie String</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1">
            <SecretInput
              id="cookie-string-input"
              value={cookieString}
              onChange={setCookieString}
              placeholder="auth_token=...; ct0=...; twid=...; ..."
              reveal={showCookieValue}
              onRevealChange={setShowCookieValue}
              inputClassName="pr-10 border-[#EFF3F4]"
              buttonClassName="absolute right-1 top-1 h-7 w-7 p-0"
              iconClassName="w-3.5 h-3.5"
            />
          </div>
          <Button
            onClick={() => { saveSetting('x_cookie_string', cookieString, () => { setCookieString('') }) }}
            disabled={!!isSavingSetting || !cookieString.trim()}
            className="bg-[#0F1419] hover:bg-[#272c30]"
          >
            {isSavingSetting === 'x_cookie_string' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Simpan'}
          </Button>
        </div>
        <GuideSection title="Cara mendapatkan cookie string" isOpen={showCookieGuide} onToggle={() => { setShowCookieGuide(!showCookieGuide) }}>
          <ol className="list-decimal list-inside space-y-1">
            <li>Login ke <strong>x.com</strong> di browser (Chrome/Firefox)</li>
            <li>Tekan <kbd className="bg-[#EFF3F4] px-1 rounded">F12</kbd> → tab <strong>Application</strong></li>
            <li>Klik <strong>Cookies</strong> → <strong>https://x.com</strong></li>
            <li>Temukan baris <code className="bg-[#EFF3F4] px-1 rounded">auth_token</code> → copy value-nya</li>
            <li>Temukan baris <code className="bg-[#EFF3F4] px-1 rounded">ct0</code> → copy value-nya</li>
            <li>Temukan baris <code className="bg-[#EFF3F4] px-1 rounded">twid</code> → copy value-nya</li>
            <li>Gabungkan: <code className="bg-[#EFF3F4] px-1 rounded">auth_token=...; ct0=...; twid=...</code></li>
            <li>Paste di atas, lalu klik <strong>Simpan</strong></li>
          </ol>
          <div className="flex items-start gap-1.5 text-amber-600 pt-1">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>Gunakan akun X yang ingin kamu jadikan autobase! Cookie dari akun lain tidak akan bekerja.</span>
          </div>
          <div className="flex items-start gap-1.5 text-[#536471] pt-1">
            <Zap className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>Sertakan semua cookie dari browser untuk hasil terbaik. Cookie yang lengkap membuat request lebih mirip browser asli.</span>
          </div>
        </GuideSection>
      </div>

      <Separator />

      {/* Bearer Token */}
      <div className="space-y-2">
        <label htmlFor="bearer-token-input" className="text-xs font-medium text-[#536471]">Bearer Token</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1">
            <SecretInput
              id="bearer-token-input"
              value={bearerToken}
              onChange={setBearerToken}
              placeholder="AAAAAAAAAAAAAAAAAAAAANRILg..."
              reveal={showBearerValue}
              onRevealChange={setShowBearerValue}
              inputClassName="pr-10 border-[#EFF3F4]"
              buttonClassName="absolute right-1 top-1 h-7 w-7 p-0"
              iconClassName="w-3.5 h-3.5"
            />
          </div>
          <Button
            onClick={() => { saveSetting('x_bearer_token', bearerToken, () => { setBearerToken('') }) }}
            disabled={!!isSavingSetting || !bearerToken.trim()}
            className="bg-[#0F1419] hover:bg-[#272c30]"
          >
            {isSavingSetting === 'x_bearer_token' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Simpan'}
          </Button>
        </div>
        <GuideSection title="Cara mendapatkan Bearer Token" isOpen={showBearerGuide} onToggle={() => { setShowBearerGuide(!showBearerGuide) }}>
          <ol className="list-decimal list-inside space-y-1">
            <li>Login ke <strong>x.com</strong> di browser</li>
            <li>Tekan <kbd className="bg-[#EFF3F4] px-1 rounded">F12</kbd> → tab <strong>Network</strong></li>
            <li>Lakukan aksi apapun (scroll, like, dll)</li>
            <li>Klik salah satu request ke <code className="bg-[#EFF3F4] px-1 rounded">/i/api/</code></li>
            <li>Cek header <strong>Authorization</strong> → copy value setelah <code className="bg-[#EFF3F4] px-1 rounded">Bearer </code></li>
            <li>Paste di atas, lalu klik <strong>Simpan</strong></li>
          </ol>
          <p className="text-[#71767B] pt-1">Token ini sama untuk semua user X (public consumer token). Jarang berubah.</p>
        </GuideSection>
      </div>

      <Separator />

      {/* Query ID (auto-fetch, manual fallback) */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <label htmlFor="query-id-input" className="text-xs font-medium text-[#536471]">Query ID</label>
          <Badge variant="outline" className="text-[9px] px-1 py-0 bg-[#F7F9F9] text-[#536471] border-[#EFF3F4]">
            Auto-fetch
          </Badge>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            id="query-id-input"
            type="text"
            placeholder="Manual fallback (optional)"
            value={queryId}
            onChange={(e) => { setQueryId(e.target.value) }}
            className="border-[#EFF3F4]"
          />
          <div className="flex gap-1">
            <Button
              onClick={() => { saveSetting('x_query_id', queryId, () => { setQueryId('') }) }}
              disabled={!!isSavingSetting || !queryId.trim()}
              className="bg-[#0F1419] hover:bg-[#272c30]"
            >
              {isSavingSetting === 'x_query_id' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Simpan'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { saveSetting('x_query_id', '', () => { setQueryId('') }) }}
              disabled={!!isSavingSetting}
              className="border-[#EFF3F4] text-[#536471]"
              title="Clear saved Query ID"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        <GuideSection title="Tentang auto-fetch & manual fallback" isOpen={showQueryIdGuide} onToggle={() => { setShowQueryIdGuide(!showQueryIdGuide) }}>
          <p>Query ID otomatis di-fetch dari JS bundle X sebelum setiap post. Kamu <strong>tidak perlu mengisi ini manual</strong>.</p>
          <p>Isi manual hanya jika auto-fetch gagal (jarang terjadi). Cara manual:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Step 1 — ambil nama bundle terbaru:<br />
              <code className="bg-[#EFF3F4] px-1 rounded text-[10px]">curl -sL &apos;https://x.com&apos; | grep -oP &apos;main\.[a-z0-9]+\.js&apos; | head -1</code>
            </li>
            <li>Step 2 — extract dari bundle tersebut:<br />
              <code className="bg-[#EFF3F4] px-1 rounded text-[10px] break-all">curl -sL &apos;https://abs.twimg.com/responsive-web/client-web/&lt;BUNDLE&gt;.js&apos; | grep -oP &apos;queryId:&quot;[^&quot;]+&quot;,operationName:&quot;CreateTweet&apos;</code>
            </li>
            <li>Copy value setelah <code className="bg-[#EFF3F4] px-1 rounded">queryId:</code> → paste di atas</li>
          </ol>
        </GuideSection>
      </div>

      <Separator />

      {/* Clear Cache + Last Updated */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xs text-[#536471]">
            <span className="font-medium">Cache</span> — queryId & transaction ID di-cache di memori (4 jam). Bersihkan jika X update frontend-nya.
          </div>
          {cookieStatus?.lastUpdated && (
            <span className="text-[10px] text-[#71767B]">
              Terakhir diperbarui: {new Date(cookieStatus.lastUpdated).toLocaleString('id-ID')}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={clearCache}
          disabled={isClearingCache}
          className="border-[#EFF3F4] text-[#536471] shrink-0"
        >
          {isClearingCache ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5 mr-1" />}
          Clear Cache
        </Button>
      </div>
    </SettingsCard>
  )
}
