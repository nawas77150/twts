'use client'

import { useState } from 'react'
import {
  Key,
  Eye,
  EyeOff,
  ChevronDown,
  User,
  Globe,
  Shield,
  Loader2,
  CircleDot,
  RefreshCw,
  BarChart3,
  Info,
  Cookie,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { PostMethod, ApiLoginStatus, KeyCredits } from '@/types'

interface ApiFallbackCardProps {
  postMethodSetting: PostMethod
  setPostMethodSetting: (v: PostMethod) => void
  v2LoginEnabled: boolean
  setV2LoginEnabled: (v: boolean) => void
  xUsername: string
  setXUsername: (v: string) => void
  xEmail: string
  setXEmail: (v: string) => void
  xPassword: string
  setXPassword: (v: string) => void
  xTotpSecret: string
  setXTotpSecret: (v: string) => void
  apiKeys: string
  setApiKeys: (v: string) => void
  apiProxy: string
  setApiProxy: (v: string) => void
  isSavingSetting: string | null
  isSavingAnySetting: boolean
  isSavingAllCredentials: boolean
  saveSetting: (key: string, value: string, onSuccess?: () => void, onFailure?: () => void) => void
  saveAllCredentials: () => void
  apiLoginStatus: ApiLoginStatus | null
  apiCredits: KeyCredits[]
  onRefreshCredits: () => void
  isLoadingCredits: boolean
}

export function ApiFallbackCard({
  postMethodSetting,
  setPostMethodSetting,
  v2LoginEnabled,
  setV2LoginEnabled,
  xUsername,
  setXUsername,
  xEmail,
  setXEmail,
  xPassword,
  setXPassword,
  xTotpSecret,
  setXTotpSecret,
  apiKeys,
  setApiKeys,
  apiProxy,
  setApiProxy,
  isSavingSetting,
  isSavingAnySetting,
  isSavingAllCredentials,
  saveSetting,
  saveAllCredentials,
  apiLoginStatus,
  apiCredits,
  onRefreshCredits,
  isLoadingCredits,
}: ApiFallbackCardProps) {
  const [open, setOpen] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [showTotpSecret, setShowTotpSecret] = useState(false)

  const postMethodOptions = [
    { value: 'direct' as PostMethod, label: 'Direct', desc: 'Cookie only' },
    { value: 'auto' as PostMethod, label: 'Auto', desc: 'Cookie → API' },
    { value: 'api' as PostMethod, label: 'API Only', desc: 'TwitterAPI.io only' },
  ]

  const handleV2Toggle = () => {
    const newValue = !v2LoginEnabled
    setV2LoginEnabled(newValue) // optimistic update
    saveSetting('v2_login_enabled', newValue ? 'true' : 'false', undefined, () => {
      setV2LoginEnabled(!newValue) // revert on failure
    })
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="shadow-sm border-[#EFF3F4]">
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer hover:bg-[#F7F9F9]/50 rounded-t-lg transition-colors">
            <CardTitle className="text-sm sm:text-base flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <Key className="w-4 h-4 text-purple-500 shrink-0" /> <span>API Fallback (twitterapi.io)</span>
              {apiLoginStatus?.cookieApiReady ? (
                <Badge variant="outline" className="text-[10px] px-1.5 bg-green-50 text-green-700 border-green-300">
                  <Cookie className="w-2.5 h-2.5 mr-1" />
                  Cookie API Ready
                </Badge>
              ) : apiLoginStatus?.hasCredentials ? (
                <Badge variant="outline" className="text-[10px] px-1.5 bg-amber-50 text-amber-700 border-amber-300">
                  <CircleDot className="w-2.5 h-2.5 mr-1 fill-amber-500 text-amber-500" />
                  Need config
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] px-1.5 bg-[#F7F9F9] text-[#536471] border-[#EFF3F4]">
                  <CircleDot className="w-2.5 h-2.5 mr-1 fill-[#71767B] text-[#71767B]" />
                  Not configured
                </Badge>
              )}
              <ChevronDown className={`w-4 h-4 text-[#71767B] ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            {/* Post Method Toggle */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[#536471]">Post Method</label>
              <div className="flex flex-wrap gap-2">
                {postMethodOptions.map((opt) => (
                  <Button
                    key={opt.value}
                    size="sm"
                    variant={postMethodSetting === opt.value ? 'default' : 'outline'}
                    onClick={() => {
                      const previous = postMethodSetting
                      setPostMethodSetting(opt.value) // optimistic update
                      saveSetting('post_method', opt.value, undefined, () => {
                        // Revert on failure
                        setPostMethodSetting(previous)
                      })
                    }}
                    disabled={isSavingAnySetting}
                    className={`text-xs h-8 ${postMethodSetting === opt.value ? 'bg-purple-500 hover:bg-purple-600' : 'border-[#EFF3F4]'}`}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
              <p className="text-[10px] text-[#71767B]">
                {postMethodSetting === 'direct' && 'Hanya cookie-based posting, tanpa fallback.'}
                {postMethodSetting === 'auto' && 'Direct → Cookie API (300 credits) → V2 Login (800 credits jika ON).'}
                {postMethodSetting === 'api' && 'Selalu gunakan twitterapi.io API (cookie-based → V2 login jika ON).'}
              </p>
            </div>

            {/* V2 Login Fallback Toggle */}
            <div className="space-y-3 p-4 bg-[#F7F9F9] rounded-lg border border-[#EFF3F4]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-[#536471]" />
                  <label id="v2-login-label" className="text-xs font-medium text-[#536471]">V2 Login Fallback</label>
                </div>
                <Button
                  size="sm"
                  variant={v2LoginEnabled ? 'default' : 'outline'}
                  aria-labelledby="v2-login-label"
                  onClick={handleV2Toggle}
                  disabled={isSavingAnySetting}
                  className={`text-xs h-7 px-3 ${v2LoginEnabled ? 'bg-amber-500 hover:bg-amber-600' : 'border-[#EFF3F4]'}`}
                >
                  {v2LoginEnabled ? 'ON' : 'OFF'}
                </Button>
              </div>
              <div className="flex items-start gap-1.5">
                <Info className="w-3 h-3 text-[#71767B] mt-0.5 shrink-0" />
                <p className="text-[10px] text-[#71767B]">
                  {v2LoginEnabled
                    ? 'Jika Cookie API gagal, sistem akan login dengan username/password sebagai fallback terakhir. Biaya: 800 credits/tweet.'
                    : 'Jika Cookie API gagal, tweet tidak akan diposting. Aktifkan untuk fallback ke username/password login (800 credits/tweet vs 300 credits/tweet untuk Cookie API).'}
                </p>
              </div>
            </div>

            {/* X Login Credentials — only shown when V2 toggle is ON */}
            {v2LoginEnabled && (
              <div className="space-y-3 p-4 bg-amber-50/50 rounded-lg border border-amber-100">
                <label className="text-xs font-medium text-[#536471] flex items-center gap-1.5">
                  <User className="w-3 h-3" /> X Login Credentials
                  <span className="text-[10px] text-amber-600 font-normal">(untuk V2 login fallback)</span>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* X Username */}
                  <Input
                    placeholder="X username"
                    value={xUsername}
                    onChange={(e) => { setXUsername(e.target.value) }}
                    className="border-[#EFF3F4] text-xs"
                  />

                  {/* X Email */}
                  <Input
                    placeholder="X email"
                    type="email"
                    value={xEmail}
                    onChange={(e) => { setXEmail(e.target.value) }}
                    className="border-[#EFF3F4] text-xs"
                  />

                  {/* X Password */}
                  <div className="relative">
                    <Input
                      placeholder="X password"
                      type={showPassword ? 'text' : 'password'}
                      value={xPassword}
                      onChange={(e) => { setXPassword(e.target.value) }}
                      className="border-[#EFF3F4] text-xs pr-8"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 p-0"
                      onClick={() => { setShowPassword(!showPassword) }}
                    >
                      {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    </Button>
                  </div>

                  {/* 2FA Secret (TOTP) */}
                  <div className="relative">
                    <Input
                      placeholder="2FA secret (TOTP base32 seed)"
                      type={showTotpSecret ? 'text' : 'password'}
                      value={xTotpSecret}
                      onChange={(e) => { setXTotpSecret(e.target.value) }}
                      className="border-[#EFF3F4] text-xs pr-8"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 p-0"
                      onClick={() => { setShowTotpSecret(!showTotpSecret) }}
                    >
                      {showTotpSecret ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    </Button>
                  </div>
                </div>

                {/* Single Save All Button */}
                <Button
                  onClick={saveAllCredentials}
                  disabled={isSavingAllCredentials || !!isSavingSetting || (!xUsername.trim() && !xEmail.trim() && !xPassword.trim() && !xTotpSecret.trim())}
                  className="w-full bg-amber-500 hover:bg-amber-600 text-white"
                >
                  {isSavingAllCredentials ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Key className="w-4 h-4 mr-2" />}
                  {isSavingAllCredentials ? 'Menyimpan...' : 'Save All Credentials'}
                </Button>

                <p className="text-[10px] text-[#71767B]">
                  Semua field disimpan terenkripsi. Untuk mendapatkan TOTP secret: X → Settings → Security → 2FA → Authentication App → &quot;Can&apos;t scan the QR code?&quot; → copy the base32 string.
                </p>
              </div>
            )}

            {/* API Keys */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[#536471] flex items-center gap-1.5">
                <Key className="w-3 h-3" /> API Keys (JSON array)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder='["key1","key2","key3"]'
                  value={apiKeys}
                  onChange={(e) => { setApiKeys(e.target.value) }}
                  className="border-[#EFF3F4] text-xs"
                />
                <Button
                  onClick={() => { saveSetting('twitterapi_keys', apiKeys, () => setApiKeys('')) }}
                  disabled={!!isSavingSetting || !apiKeys.trim()}
                  className="bg-purple-500 hover:bg-purple-600 shrink-0"
                >
                  {isSavingSetting === 'twitterapi_keys' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                </Button>
              </div>
              <p className="text-[10px] text-[#71767B]">
                Format: JSON array. Setiap key ~33 tweet gratis (10k credits).
              </p>
            </div>

            {/* Proxy */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[#536471] flex items-center gap-1.5">
                <Globe className="w-3 h-3" /> Proxy URL (required)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder="http://user:pass@ip:port"
                  value={apiProxy}
                  onChange={(e) => { setApiProxy(e.target.value) }}
                  className="border-[#EFF3F4] text-xs"
                />
                <Button
                  onClick={() => { saveSetting('twitterapi_proxy', apiProxy, () => setApiProxy('')) }}
                  disabled={!!isSavingSetting || !apiProxy.trim()}
                  variant="outline"
                  className="border-purple-200 text-purple-700 hover:bg-purple-50 shrink-0"
                >
                  {isSavingSetting === 'twitterapi_proxy' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                </Button>
              </div>
              <p className="text-[10px] text-[#71767B]">
                Wajib untuk Cookie API dan V2 Login. Gunakan residential proxy (contoh: Webshare). Proxy digunakan oleh twitterapi.io saat mengakses X.
              </p>
            </div>

            {/* API Status — dual status display */}
            {apiLoginStatus && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-[#536471] flex items-center gap-1.5">
                  <Shield className="w-3 h-3" /> API Status
                </label>
                <div className="space-y-1.5">
                  {/* Cookie API Status */}
                  <div className="flex items-center gap-2 bg-[#F7F9F9] rounded-lg p-2 border border-[#EFF3F4]">
                    <Cookie className="w-3 h-3 text-[#536471]" />
                    <span className="text-[10px] text-[#536471] w-16 shrink-0">Cookie API:</span>
                    {apiLoginStatus.cookieApiReady ? (
                      <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-300">
                        ✅ Ready
                      </Badge>
                    ) : (
                      <>
                        <Badge variant="outline" className="text-[10px] bg-red-50 text-red-600 border-red-200">
                          ❌ Not ready
                        </Badge>
                        {apiLoginStatus.cookieApiMissing.length > 0 && (
                          <span className="text-[10px] text-amber-600">
                            Missing: {apiLoginStatus.cookieApiMissing.join(', ')}
                          </span>
                        )}
                      </>
                    )}
                  </div>

                  {/* V2 Login Status */}
                  <div className="flex items-center gap-2 bg-[#F7F9F9] rounded-lg p-2 border border-[#EFF3F4]">
                    <Shield className="w-3 h-3 text-[#536471]" />
                    <span className="text-[10px] text-[#536471] w-16 shrink-0">V2 Login:</span>
                    {!v2LoginEnabled ? (
                      <Badge variant="outline" className="text-[10px] bg-[#F7F9F9] text-[#71767B] border-[#EFF3F4]">
                        Off
                      </Badge>
                    ) : apiLoginStatus.hasLoginCookie ? (
                      <>
                        <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-300">
                          ✅ Active
                        </Badge>
                        {apiLoginStatus.lastLoginAt && (
                          <span className="text-[10px] text-[#71767B]">
                            Last: {new Date(apiLoginStatus.lastLoginAt).toLocaleString('id-ID')}
                          </span>
                        )}
                      </>
                    ) : apiLoginStatus.hasCredentials ? (
                      <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-300">
                        ⚠️ Will auto-login
                      </Badge>
                    ) : (
                      <span className="text-[10px] text-[#71767B]">
                        Enter credentials above
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Credit Status */}
            {apiCredits.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-[#536471] flex items-center gap-1.5">
                  <BarChart3 className="w-3 h-3" /> Credit Status
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 ml-1"
                    onClick={onRefreshCredits}
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingCredits ? 'animate-spin' : ''}`} />
                  </Button>
                </label>
                <div className="space-y-1.5">
                  {apiCredits.map((credit, idx) => (
                    <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between bg-[#F7F9F9] rounded-lg p-2 border border-[#EFF3F4] gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-[#536471]">{credit.apiKey}</span>
                        {credit.error && (
                          <Badge variant="outline" className="text-[8px] px-1 bg-red-50 text-red-600 border-red-200">
                            {credit.error}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] text-[#71767B]">Bonus: {credit.bonusCredits}</span>
                        <span className="text-[10px] font-medium text-[#3D4145]">Total: {credit.totalCredits}</span>
                        <span className="text-[8px] text-[#71767B]">(~{Math.floor(credit.totalCredits / 300)} tweets)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
