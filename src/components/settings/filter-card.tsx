'use client'

import {
  Filter,
  AlertTriangle,
  RotateCcw,
  ShieldCheck,
  Loader2,
  Shield,
} from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { SettingsCard } from '@/components/shared/settings-card'
import type { FilterRules } from '@/types'

interface FilterCardProps {
  autoApprove: boolean
  saveAutoApprove: (val: boolean) => void
  isSavingAutoApprove: boolean
  blockedWordsText: string
  setBlockedWordsText: (v: string) => void
  nsfwWordsText: string
  setNsfwWordsText: (v: string) => void
  filterRules: FilterRules
  saveFilterRule: (key: keyof FilterRules, val: boolean) => void
  savingRuleKey: string | null
  geminiEnabled: boolean
  geminiApiKeySet: boolean
  isSaving: boolean
  saveFilterSettings: () => void
  defaultBlockedWords: string[]
  defaultNsfwWords: string[]
}

const TOGGLEABLE_RULES: { key: keyof FilterRules; label: string; desc: string }[] = [
  { key: 'blockedWords', label: 'Block profanity & blocked words', desc: 'Match against the blocked words list above' },
  { key: 'jualan', label: 'Block jualan/promosi (WTS/WTB/WTT/LF)', desc: 'Marketplace tags are not confessions' },
  { key: 'urls', label: 'Block links/URLs', desc: 'Prevents spam links and phishing' },
  { key: 'mentions', label: 'Block @mentions', desc: 'Prevents targeted harassment via @username' },
  { key: 'phoneNumbers', label: 'Block phone numbers', desc: 'Prevents doxxing and privacy leaks' },
  { key: 'nsfw', label: 'Block NSFW/explicit content', desc: 'OFF by default for Alter menfess — toggle on if needed' },
  { key: 'repeatedChars', label: 'Block repeated characters', desc: '6+ consecutive identical characters (e.g. aaaaaa)' },
]

const ALWAYS_ON_RULES = [
  { key: 'capsSpam', label: 'ALL CAPS spam' },
  { key: 'tooShort', label: 'Too short (<5)' },
  { key: 'duplicate24h', label: 'Duplicate (24h)' },
]

export function FilterCard({
  autoApprove,
  saveAutoApprove,
  isSavingAutoApprove,
  blockedWordsText,
  setBlockedWordsText,
  nsfwWordsText,
  setNsfwWordsText,
  filterRules,
  saveFilterRule,
  savingRuleKey,
  geminiEnabled,
  geminiApiKeySet,
  isSaving,
  saveFilterSettings,
  defaultBlockedWords,
  defaultNsfwWords,
}: FilterCardProps) {
  const badges = (
    <>
      {autoApprove ? (
        <Badge variant="outline" className="text-[10px] px-1.5 bg-green-50 text-green-700 border-green-300">
          <ShieldCheck className="w-2.5 h-2.5 mr-1" />
          Auto-Approve ON
        </Badge>
      ) : (
        <Badge variant="outline" className="text-[10px] px-1.5 bg-[#F7F9F9] text-[#71767B] border-[#EFF3F4]">
          Manual Review
        </Badge>
      )}
      {geminiEnabled && geminiApiKeySet && (
        <Badge variant="outline" className="text-[9px] px-1 py-0 bg-purple-50 text-purple-700 border-purple-200 gap-0.5">
          ✨ Gemini
        </Badge>
      )}
    </>
  )

  return (
    <SettingsCard icon={Filter} title="Filter & Auto-Approve" badges={badges}>
      {/* Auto-Approve Toggle */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="auto-approve-switch" className="text-xs font-medium text-[#536471]">Auto-Approve</label>
          <Switch
            id="auto-approve-switch"
            checked={autoApprove}
            onCheckedChange={(checked) => { saveAutoApprove(checked) }}
            disabled={isSavingAutoApprove}
          />
        </div>
        {autoApprove && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-700 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>Submissions that pass the filter will be <strong>auto-posted to X</strong> without admin review. Flagged submissions still need manual approval.</span>
          </div>
        )}
      </div>

      <Separator />

      {/* Blocked Words */}
      <div className="space-y-2">
        <label htmlFor="blocked-words-textarea" className="text-xs font-medium text-[#536471] flex items-center justify-between">
          <span>Blocked Words</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-[10px] text-[#71767B] hover:text-[#0F1419]"
            onClick={() => { setBlockedWordsText(defaultBlockedWords.join(', ')) }}
          >
            <RotateCcw className="w-3 h-3 mr-1" /> Reset Default
          </Button>
        </label>
        <Textarea
          id="blocked-words-textarea"
          placeholder="kontol, memek, ngentot, wts, wtb, ..."
          value={blockedWordsText}
          onChange={(e) => { setBlockedWordsText(e.target.value) }}
          className="min-h-[100px] resize-y border-[#EFF3F4] text-xs"
        />
        <p className="text-[10px] text-[#71767B]">
          Comma-separated. Matches whole words only (case-insensitive). Submissions containing these words will be flagged for manual review.
        </p>
      </div>

      <Separator />

      {/* NSFW Words */}
      <div className="space-y-2">
        <label htmlFor="nsfw-words-textarea" className="text-xs font-medium text-[#536471] flex items-center justify-between">
          <span>NSFW Words</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-[10px] text-[#71767B] hover:text-[#0F1419]"
            onClick={() => { setNsfwWordsText(defaultNsfwWords.join(', ')) }}
          >
            <RotateCcw className="w-3 h-3 mr-1" /> Reset Default
          </Button>
        </label>
        <Textarea
          id="nsfw-words-textarea"
          placeholder="bokep, telanjang, milf, ..."
          value={nsfwWordsText}
          onChange={(e) => { setNsfwWordsText(e.target.value) }}
          className="min-h-[80px] resize-y border-[#EFF3F4] text-xs"
        />
        <p className="text-[10px] text-[#71767B]">
          Comma-separated. Used when &quot;Block NSFW/explicit content&quot; rule is ON.
        </p>
      </div>

      <Separator />

      {/* Filter Rules */}
      <div className="space-y-2">
        <span className="text-xs font-medium text-[#536471]">Filter Rules</span>
        <div className="space-y-2">
          {/* Toggleable rules */}
          {TOGGLEABLE_RULES.map((rule) => (
            <div key={rule.key} className="flex items-center justify-between bg-[#F7F9F9] rounded-lg p-2 border border-[#EFF3F4]">
              <div>
                <span className="text-xs font-medium text-[#0F1419]">{rule.label}</span>
                <p className="text-[10px] text-[#71767B]">{rule.desc}</p>
              </div>
              <Switch
                checked={filterRules[rule.key]}
                onCheckedChange={(checked) => { saveFilterRule(rule.key, checked) }}
                disabled={savingRuleKey !== null}
                aria-label={`Toggle ${rule.label}`}
              />
            </div>
          ))}

          {/* Always-on rules (not toggleable) */}
          <div className="mt-2">
            <p className="text-[10px] text-[#71767B] mb-1.5">Always on (cannot be disabled):</p>
            <div className="flex flex-wrap gap-1.5">
              {ALWAYS_ON_RULES.map((rule) => (
                <Badge key={rule.key} variant="outline" className="text-[9px] px-1.5 py-0 bg-[#F7F9F9] text-[#536471] border-[#EFF3F4] gap-0.5">
                  <ShieldCheck className="w-2.5 h-2.5 text-green-500" />
                  {rule.label}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Separator />

      {/* Save Filter Settings */}
      <Button
        onClick={saveFilterSettings}
        disabled={isSaving}
        className="w-full bg-[#0F1419] hover:bg-[#272c30]"
      >
        {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Shield className="w-4 h-4 mr-2" />}
        Save Filter Settings
      </Button>
    </SettingsCard>
  )
}
