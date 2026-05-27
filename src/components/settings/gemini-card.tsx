'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Sparkles,
  AlertTriangle,
  ShieldCheck,
  Loader2,
  Activity,
  CheckCircle2,
  XCircle,
  ChevronDown,
  FileText,
  RotateCcw,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { SettingsCard } from '@/components/shared/settings-card'
import { SecretInput } from '@/components/shared/secret-input'
import { apiClient } from '@/lib/api-client'

interface HealthStatus {
  healthy: boolean
  model: string
  error: string | null
}

interface GeminiCardProps {
  geminiEnabled: boolean
  geminiSaving: boolean
  setGeminiEnabled: (v: boolean) => void
  geminiApiKeyInput: string
  setGeminiApiKeyInput: (v: string) => void
  geminiApiKeySet: boolean
  showGeminiKey: boolean
  setShowGeminiKey: (v: boolean) => void
  saveGeminiKey: (key: string) => void
  geminiKeySaving: boolean
  geminiModel: string
  setGeminiModel: (v: string) => void
  saveGeminiModel: (model: string) => void
  geminiModelSaving: boolean
  geminiSystemPrompt: string
  setGeminiSystemPrompt: (v: string) => void
  saveGeminiSystemPrompt: (prompt: string) => void
  geminiSystemPromptSaving: boolean
  defaultGeminiSystemPrompt: string
}

export function GeminiCard({
  geminiEnabled,
  geminiSaving,
  setGeminiEnabled,
  geminiApiKeyInput,
  setGeminiApiKeyInput,
  geminiApiKeySet,
  showGeminiKey,
  setShowGeminiKey,
  saveGeminiKey,
  geminiKeySaving,
  geminiModel,
  setGeminiModel,
  saveGeminiModel,
  geminiModelSaving,
  geminiSystemPrompt,
  setGeminiSystemPrompt,
  saveGeminiSystemPrompt,
  geminiSystemPromptSaving,
  defaultGeminiSystemPrompt,
}: GeminiCardProps) {
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [isPromptOpen, setIsPromptOpen] = useState(false)
  const promptAutoOpened = useRef(false)

  // Auto-open collapsible when a custom prompt exists (fires once on initial data load)
  useEffect(() => {
    if (!promptAutoOpened.current && geminiSystemPrompt) {
      setIsPromptOpen(true)
      promptAutoOpened.current = true
    }
  }, [geminiSystemPrompt])

  const testHealth = useCallback(async () => {
    setIsTesting(true)
    setHealthStatus(null)
    try {
      const data = await apiClient.getGeminiStatus()
      setHealthStatus({ healthy: data.healthy, model: data.model, error: data.error })
    } catch {
      setHealthStatus({ healthy: false, model: '', error: 'Network error' })
    } finally {
      setIsTesting(false)
    }
  }, [])

  const statusBadge = geminiSaving ? (
    <Badge variant="outline" className="text-[10px] px-1.5 bg-blue-50 text-blue-700 border-blue-300">
      <Loader2 className="w-2.5 h-2.5 mr-0.5 animate-spin" /> Saving...
    </Badge>
  ) : geminiEnabled && geminiApiKeySet ? (
    <Badge variant="outline" className="text-[10px] px-1.5 bg-green-50 text-green-700 border-green-300">
      Active
    </Badge>
  ) : geminiEnabled && !geminiApiKeySet ? (
    <Badge variant="outline" className="text-[10px] px-1.5 bg-amber-50 text-amber-700 border-amber-300">
      No API Key
    </Badge>
  ) : (
    <Badge variant="outline" className="text-[10px] px-1.5 bg-[#F7F9F9] text-[#536471] border-[#EFF3F4]">
      Off
    </Badge>
  )

  return (
    <SettingsCard icon={Sparkles} iconClassName="text-purple-500" title="Gemini AI Filter" badges={statusBadge}>
      {/* Toggle */}
      <div className="flex items-center justify-between">
        <label htmlFor="gemini-toggle" className="text-xs font-medium text-[#536471] flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" /> Gemini AI Filter
          {geminiSaving && (
            <Loader2 className="w-3 h-3 animate-spin text-[#536471]" />
          )}
        </label>
        <Switch
          id="gemini-toggle"
          checked={geminiEnabled}
          onCheckedChange={(checked) => { setGeminiEnabled(checked) }}
          disabled={geminiSaving}
        />
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
        <label htmlFor="gemini-api-key-input" className="text-xs font-medium text-[#536471]">Gemini API Key</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1">
            <SecretInput
              id="gemini-api-key-input"
              value={geminiApiKeyInput}
              onChange={setGeminiApiKeyInput}
              placeholder={geminiApiKeySet ? 'Key is set — enter new key to replace' : 'AIzaSy...'}
              reveal={showGeminiKey}
              onRevealChange={setShowGeminiKey}
              inputClassName="pr-10 border-[#EFF3F4] text-xs"
              buttonClassName="absolute right-1 top-1 h-6 w-6 p-0"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-xs border-[#EFF3F4] h-8"
            disabled={!geminiApiKeyInput.trim() || geminiKeySaving}
            onClick={() => { saveGeminiKey(geminiApiKeyInput.trim()) }}
          >
            {geminiKeySaving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
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

      {/* Model Input */}
      <div className="space-y-2">
        <label htmlFor="gemini-model-input" className="text-xs font-medium text-[#536471]">Gemini Model</label>
        <div className="flex gap-2">
          <Input
            id="gemini-model-input"
            type="text"
            placeholder="gemini-3.1-flash-lite"
            value={geminiModel}
            onChange={(e) => { setGeminiModel(e.target.value) }}
            className="border-[#EFF3F4] text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            className="text-xs border-[#EFF3F4] h-8 shrink-0"
            disabled={!geminiModel.trim() || geminiModelSaving}
            onClick={() => { saveGeminiModel(geminiModel) }}
          >
            {geminiModelSaving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
            Save
          </Button>
        </div>
        <p className="text-[10px] text-[#71767B]">
          Common models: gemini-3.1-flash-lite, gemini-2.0-flash, gemini-1.5-flash
        </p>
      </div>

      <Separator />

      {/* System Prompt (Collapsible) */}
      <Collapsible open={isPromptOpen} onOpenChange={setIsPromptOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full text-xs font-medium text-[#536471] hover:text-[#0F1419] transition-colors">
          <span className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> System Prompt
            {geminiSystemPrompt && (
              <Badge variant="outline" className="text-[9px] px-1 py-0 bg-purple-50 text-purple-700 border-purple-200">
                Custom
              </Badge>
            )}
          </span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isPromptOpen ? 'rotate-180' : ''}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-2">
          <Textarea
            value={geminiSystemPrompt}
            onChange={(e) => { setGeminiSystemPrompt(e.target.value) }}
            placeholder="Leave empty to use the built-in default prompt..."
            className="min-h-[200px] font-mono text-[11px] border-[#EFF3F4] resize-y"
            maxLength={8000}
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#71767B]">
              {geminiSystemPrompt
                ? `${geminiSystemPrompt.length}/8000 chars (custom)`
                : `Using default${defaultGeminiSystemPrompt ? ` (${defaultGeminiSystemPrompt.length} chars)` : ''}`}
            </span>
            <div className="flex gap-1.5">
              {geminiSystemPrompt && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[10px] h-6 px-2 text-[#536471] hover:text-red-600"
                  disabled={geminiSystemPromptSaving}
                  onClick={() => { saveGeminiSystemPrompt('') }}
                >
                  <RotateCcw className="w-3 h-3 mr-0.5" /> Reset to Default
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="text-[10px] border-[#EFF3F4] h-6"
                disabled={geminiSystemPrompt.length > 8000 || geminiSystemPromptSaving}
                onClick={() => { saveGeminiSystemPrompt(geminiSystemPrompt) }}
              >
                {geminiSystemPromptSaving ? <Loader2 className="w-3 h-3 mr-0.5 animate-spin" /> : null}
                Save Prompt
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Separator />

      {/* Health Check */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[#536471] flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5" /> Health Check
          </span>
          <Button
            variant="outline"
            size="sm"
            className="text-xs border-[#EFF3F4] h-7"
            disabled={!geminiApiKeySet || isTesting}
            onClick={testHealth}
          >
            {isTesting ? (
              <>
                <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Testing...
              </>
            ) : (
              'Test'
            )}
          </Button>
        </div>
        {healthStatus && (
          <div className={`rounded-lg p-2 text-[10px] flex items-start gap-1.5 ${
            healthStatus.healthy
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}>
            {healthStatus.healthy ? (
              <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-3 h-3 shrink-0 mt-0.5" />
            )}
            <span>
              {healthStatus.healthy
                ? `Connected — model: ${healthStatus.model}`
                : `Unhealthy — ${healthStatus.error || 'unknown error'}${healthStatus.model ? ` (model: ${healthStatus.model})` : ''}`}
            </span>
          </div>
        )}
        {!geminiApiKeySet && (
          <p className="text-[10px] text-[#71767B]">Save an API key first to test connectivity.</p>
        )}
      </div>

      <Separator />

      {/* How it works info box */}
      <div className="bg-[#F7F9F9] rounded-lg p-3 border border-[#EFF3F4] space-y-1">
        <p className="text-[10px] font-medium text-[#536471]">How it works:</p>
        <ul className="text-[10px] text-[#71767B] space-y-0.5 list-disc list-inside">
          <li>Runs <strong>after</strong> rule-based filter passes (saves API calls)</li>
          <li>If Gemini is down or errors → AI check is skipped (submission proceeds without AI verification)</li>
          <li>Only blocks genuinely harmful content (hate speech, threats, doxxing)</li>
          <li>Does NOT block typical alter content (venting, profanity, drama)</li>
        </ul>
      </div>
    </SettingsCard>
  )
}
