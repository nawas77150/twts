'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Settings,
  Eye,
  EyeOff,
  ChevronDown,
  AlertTriangle,
  Zap,
  Loader2,
  RotateCcw,
  CircleDot,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
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
  const [open, setOpen] = useState(true)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="shadow-sm border-[#EFF3F4]">
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer hover:bg-[#F7F9F9]/50 rounded-t-lg transition-colors">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="w-4 h-4 text-[#536471]" /> Direct Posting (Cookie Method)
              {cookieStatus?.configured ? (
                <Badge variant="outline" className="text-[10px] px-1.5 bg-green-50 text-green-700 border-green-300">
                  <CircleDot className="w-2.5 h-2.5 mr-1 fill-green-500 text-green-500" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] px-1.5 bg-red-50 text-red-700 border-red-300">
                  <CircleDot className="w-2.5 h-2.5 mr-1 fill-red-500 text-red-500" />
                  Not configured
                </Badge>
              )}
              <ChevronDown className={`w-4 h-4 text-[#71767B] ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            {/* Cookie String */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[#536471]">Cookie String</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 relative">
                  <Input
                    type={showCookieValue ? 'text' : 'password'}
                    placeholder="auth_token=...; ct0=...; ..."
                    value={cookieString}
                    onChange={(e) => setCookieString(e.target.value)}
                    className="pr-10 border-[#EFF3F4]"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1 h-7 w-7 p-0"
                    onClick={() => setShowCookieValue(!showCookieValue)}
                  >
                    {showCookieValue ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </Button>
                </div>
                <Button
                  onClick={() => saveSetting('x_cookie_string', cookieString, () => setCookieString(''))}
                  disabled={!!isSavingSetting || !cookieString.trim()}
                  className="bg-[#0F1419] hover:bg-[#272c30]"
                >
                  {isSavingSetting === 'x_cookie_string' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Simpan'}
                </Button>
              </div>
              <button
                onClick={() => setShowCookieGuide(!showCookieGuide)}
                className="text-xs text-[#536471] hover:underline flex items-center gap-1"
              >
                <ChevronDown className={`w-3 h-3 transition-transform ${showCookieGuide ? 'rotate-180' : ''}`} />
                Cara mendapatkan cookie string
              </button>
              {showCookieGuide && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-[#F7F9F9] rounded-lg p-3 text-xs text-[#536471] space-y-2 border border-[#EFF3F4]"
                >
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Login ke <strong>x.com</strong> di browser (Chrome/Firefox)</li>
                    <li>Tekan <kbd className="bg-[#EFF3F4] px-1 rounded">F12</kbd> → tab <strong>Application</strong></li>
                    <li>Klik <strong>Cookies</strong> → <strong>https://x.com</strong></li>
                    <li>Temukan baris <code className="bg-[#EFF3F4] px-1 rounded">auth_token</code> → copy value-nya</li>
                    <li>Temukan baris <code className="bg-[#EFF3F4] px-1 rounded">ct0</code> → copy value-nya</li>
                    <li>Temukan baris <code className="bg-[#EFF3F4] px-1 rounded">guest_id</code> → copy value-nya</li>
                    <li>Gabungkan: <code className="bg-[#EFF3F4] px-1 rounded">auth_token=...; ct0=...; guest_id=...</code></li>
                    <li>Paste di atas, lalu klik <strong>Simpan</strong></li>
                  </ol>
                  <div className="flex items-start gap-1.5 text-amber-600 pt-1">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>Gunakan akun X yang ingin kamu jadikan autobase! Cookie dari akun lain tidak akan bekerja.</span>
                  </div>
                  <div className="flex items-start gap-1.5 text-[#536471] pt-1">
                    <Zap className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>Sertikan semua cookie dari browser untuk hasil terbaik. Cookie yang lengkap membuat request lebih mirip browser asli.</span>
                  </div>
                </motion.div>
              )}
            </div>

            <Separator />

            {/* Bearer Token */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[#536471]">Bearer Token</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 relative">
                  <Input
                    type={showBearerValue ? 'text' : 'password'}
                    placeholder="AAAAAAAAAAAAAAAAAAAAANRILg..."
                    value={bearerToken}
                    onChange={(e) => setBearerToken(e.target.value)}
                    className="pr-10 border-[#EFF3F4]"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1 h-7 w-7 p-0"
                    onClick={() => setShowBearerValue(!showBearerValue)}
                  >
                    {showBearerValue ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </Button>
                </div>
                <Button
                  onClick={() => saveSetting('x_bearer_token', bearerToken, () => setBearerToken(''))}
                  disabled={!!isSavingSetting || !bearerToken.trim()}
                  className="bg-[#0F1419] hover:bg-[#272c30]"
                >
                  {isSavingSetting === 'x_bearer_token' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Simpan'}
                </Button>
              </div>
              <button
                onClick={() => setShowBearerGuide(!showBearerGuide)}
                className="text-xs text-[#536471] hover:underline flex items-center gap-1"
              >
                <ChevronDown className={`w-3 h-3 transition-transform ${showBearerGuide ? 'rotate-180' : ''}`} />
                Cara mendapatkan Bearer Token
              </button>
              {showBearerGuide && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-[#F7F9F9] rounded-lg p-3 text-xs text-[#536471] space-y-2 border border-[#EFF3F4]"
                >
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Login ke <strong>x.com</strong> di browser</li>
                    <li>Tekan <kbd className="bg-[#EFF3F4] px-1 rounded">F12</kbd> → tab <strong>Network</strong></li>
                    <li>Lakukan aksi apapun (scroll, like, dll)</li>
                    <li>Klik salah satu request ke <code className="bg-[#EFF3F4] px-1 rounded">/i/api/</code></li>
                    <li>Cek header <strong>Authorization</strong> → copy value setelah <code className="bg-[#EFF3F4] px-1 rounded">Bearer </code></li>
                    <li>Paste di atas, lalu klik <strong>Simpan</strong></li>
                  </ol>
                  <p className="text-[#71767B] pt-1">Token ini sama untuk semua user X (public consumer token). Jarang berubah.</p>
                </motion.div>
              )}
            </div>

            <Separator />

            {/* Query ID (auto-fetch, manual fallback) */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-[#536471]">Query ID</label>
                <Badge variant="outline" className="text-[9px] px-1 py-0 bg-[#F7F9F9] text-[#536471] border-[#EFF3F4]">
                  Auto-fetch
                </Badge>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  type="text"
                  placeholder="Manual fallback (optional)"
                  value={queryId}
                  onChange={(e) => setQueryId(e.target.value)}
                  className="border-[#EFF3F4]"
                />
                <div className="flex gap-1">
                  <Button
                    onClick={() => saveSetting('x_query_id', queryId, () => setQueryId(''))}
                    disabled={!!isSavingSetting || !queryId.trim()}
                    className="bg-[#0F1419] hover:bg-[#272c30]"
                  >
                    {isSavingSetting === 'x_query_id' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Simpan'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => saveSetting('x_query_id', '', () => setQueryId(''))}
                    disabled={!!isSavingSetting}
                    className="border-[#EFF3F4] text-[#536471]"
                    title="Clear saved Query ID"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <button
                onClick={() => setShowQueryIdGuide(!showQueryIdGuide)}
                className="text-xs text-[#536471] hover:underline flex items-center gap-1"
              >
                <ChevronDown className={`w-3 h-3 transition-transform ${showQueryIdGuide ? 'rotate-180' : ''}`} />
                Tentang auto-fetch & manual fallback
              </button>
              {showQueryIdGuide && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-[#F7F9F9] rounded-lg p-3 text-xs text-[#536471] space-y-2 border border-[#EFF3F4]"
                >
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
                </motion.div>
              )}
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
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
