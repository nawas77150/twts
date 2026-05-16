'use client'

import { useState } from 'react'
import {
  Sparkles,
  Eye,
  EyeOff,
  ChevronDown,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

interface GeminiCardProps {
  geminiEnabled: boolean
  setGeminiEnabled: (v: boolean) => void
  geminiApiKeyInput: string
  setGeminiApiKeyInput: (v: string) => void
  geminiApiKeySet: boolean
  showGeminiKey: boolean
  setShowGeminiKey: (v: boolean) => void
  saveGeminiKey: (key: string) => void
}

export function GeminiCard({
  geminiEnabled,
  setGeminiEnabled,
  geminiApiKeyInput,
  setGeminiApiKeyInput,
  geminiApiKeySet,
  showGeminiKey,
  setShowGeminiKey,
  saveGeminiKey,
}: GeminiCardProps) {
  const [open, setOpen] = useState(true)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="shadow-sm border-[#EFF3F4]">
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer hover:bg-[#F7F9F9]/50 rounded-t-lg transition-colors">
            <CardTitle className="text-sm sm:text-base flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <Sparkles className="w-4 h-4 text-purple-500 shrink-0" /> <span>Gemini AI Filter</span>
              {geminiEnabled && geminiApiKeySet && (
                <Badge variant="outline" className="text-[10px] px-1.5 bg-green-50 text-green-700 border-green-300">
                  Active
                </Badge>
              )}
              {geminiEnabled && !geminiApiKeySet && (
                <Badge variant="outline" className="text-[10px] px-1.5 bg-amber-50 text-amber-700 border-amber-300">
                  No API Key
                </Badge>
              )}
              {!geminiEnabled && (
                <Badge variant="outline" className="text-[10px] px-1.5 bg-[#F7F9F9] text-[#536471] border-[#EFF3F4]">
                  Off
                </Badge>
              )}
              <ChevronDown className={`w-4 h-4 text-[#71767B] ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            {/* Toggle */}
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[#536471] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> Gemini AI Filter
                {geminiEnabled && geminiApiKeySet && (
                  <Badge variant="outline" className="text-[8px] px-1 py-0 bg-green-50 text-green-700 border-green-300">
                    Active
                  </Badge>
                )}
                {geminiEnabled && !geminiApiKeySet && (
                  <Badge variant="outline" className="text-[8px] px-1 py-0 bg-amber-50 text-amber-700 border-amber-300">
                    No API Key
                  </Badge>
                )}
              </label>
              <button
                type="button"
                onClick={() => setGeminiEnabled(!geminiEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${geminiEnabled ? 'bg-green-500' : 'bg-[#EFF3F4]'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${geminiEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            <p className="text-[10px] text-[#71767B]">
              Uses Gemini AI for nuanced content moderation — catches coded language, subtle harassment, and context-dependent hate speech that word filters miss.
              {!geminiApiKeySet && ' Works even without an API key — just uses rule-based filter only.'}
            </p>
            {geminiEnabled && !geminiApiKeySet && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[10px] text-amber-700 flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                <span>Set your Gemini API key below to enable AI filtering. Without a key, only rule-based filter will be used.</span>
              </div>
            )}

            <Separator />

            {/* API Key Input */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[#536471]">Gemini API Key</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 relative">
                  <Input
                    type={showGeminiKey ? 'text' : 'password'}
                    placeholder={geminiApiKeySet ? 'Key is set — enter new key to replace' : 'AIzaSy...'}
                    value={geminiApiKeyInput}
                    onChange={(e) => setGeminiApiKeyInput(e.target.value)}
                    className="pr-10 border-[#EFF3F4] text-xs"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1 h-6 w-6 p-0"
                    onClick={() => setShowGeminiKey(!showGeminiKey)}
                  >
                    {showGeminiKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs border-[#EFF3F4] h-8"
                  disabled={!geminiApiKeyInput.trim()}
                  onClick={() => saveGeminiKey(geminiApiKeyInput.trim())}
                >
                  Save Key
                </Button>
              </div>
              {geminiApiKeySet && (
                <p className="text-[10px] text-green-600 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> API key is configured
                </p>
              )}
            </div>

            <Separator />

            {/* How it works info box */}
            <div className="bg-[#F7F9F9] rounded-lg p-3 border border-[#EFF3F4] space-y-1">
              <p className="text-[10px] font-medium text-[#536471]">How it works:</p>
              <ul className="text-[10px] text-[#71767B] space-y-0.5 list-disc list-inside">
                <li>Runs <strong>after</strong> rule-based filter passes (saves API calls)</li>
                <li>If Gemini is down or errors → submission goes to pending (admin reviews)</li>
                <li>Only blocks genuinely harmful content (hate speech, threats, doxxing)</li>
                <li>Does NOT block typical alter content (venting, profanity, drama)</li>
              </ul>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
