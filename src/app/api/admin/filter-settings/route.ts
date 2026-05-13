import { db } from '@/lib/db'
import { decrypt, isEncrypted, encrypt } from '@/lib/encrypt'
import { verifyAdmin } from '@/lib/admin-auth'
import {
  DEFAULT_BLOCKED_WORDS,
  DEFAULT_NSFW_WORDS,
  DEFAULT_FILTER_RULES,
  type FilterRules,
} from '@/lib/content-filter'
import { NextRequest, NextResponse } from 'next/server'

// Settings keys for the filter feature
const FILTER_SETTING_KEYS = ['auto_approve', 'blocked_words', 'filter_rules', 'nsfw_words', 'gemini_enabled', 'gemini_api_key']

/**
 * Decrypt a value for display/masking purposes.
 */
function decryptValue(value: string): string {
  try {
    return isEncrypted(value) ? decrypt(value) : value
  } catch {
    return value
  }
}

/**
 * Get a filter setting value from DB, decrypted.
 * Returns null if not found.
 */
export async function getFilterSetting(key: string): Promise<string | null> {
  const setting = await db.setting.findUnique({ where: { key } })
  if (!setting) return null
  // These keys are not encrypted (like post_method)
  if (key === 'auto_approve' || key === 'gemini_enabled') return setting.value
  return decryptValue(setting.value)
}

/**
 * Get all filter settings as structured objects.
 */
export async function getFilterSettings(): Promise<{
  autoApprove: boolean
  blockedWords: string[]
  nsfwWords: string[]
  filterRules: FilterRules
  geminiEnabled: boolean
  geminiApiKeySet: boolean  // Only whether a key exists (never expose the key)
}> {
  const settings = await db.setting.findMany({
    where: { key: { in: FILTER_SETTING_KEYS } },
  })

  const getRaw = (key: string): string | null => {
    const s = settings.find((s) => s.key === key)
    if (!s) return null
    return decryptValue(s.value)
  }

  // Auto-approve: default false
  const autoApprove = getRaw('auto_approve') === 'true'

  // Blocked words: default list
  let blockedWords = DEFAULT_BLOCKED_WORDS
  const blockedWordsRaw = getRaw('blocked_words')
  if (blockedWordsRaw) {
    try {
      const parsed = JSON.parse(blockedWordsRaw)
      if (Array.isArray(parsed)) {
        blockedWords = parsed.filter((w: unknown) => typeof w === 'string' && w.trim())
      }
    } catch {
      // Keep default on parse error
    }
  }

  // NSFW words: default list
  let nsfwWords = DEFAULT_NSFW_WORDS
  const nsfwWordsRaw = getRaw('nsfw_words')
  if (nsfwWordsRaw) {
    try {
      const parsed = JSON.parse(nsfwWordsRaw)
      if (Array.isArray(parsed)) {
        nsfwWords = parsed.filter((w: unknown) => typeof w === 'string' && w.trim())
      }
    } catch {
      // Keep default on parse error
    }
  }

  // Filter rules: defaults
  let filterRules = { ...DEFAULT_FILTER_RULES }
  const filterRulesRaw = getRaw('filter_rules')
  if (filterRulesRaw) {
    try {
      const parsed = JSON.parse(filterRulesRaw) as Partial<FilterRules>
      // Merge with defaults so new rules are added automatically
      filterRules = { ...DEFAULT_FILTER_RULES, ...parsed }
    } catch {
      // Keep default on parse error
    }
  }

  // Gemini AI filter
  const geminiEnabled = getRaw('gemini_enabled') === 'true'
  const geminiApiKey = getRaw('gemini_api_key')
  const geminiApiKeySet = !!geminiApiKey && geminiApiKey.trim().length > 0

  return { autoApprove, blockedWords, nsfwWords, filterRules, geminiEnabled, geminiApiKeySet }
}

/**
 * Get the actual Gemini API key (for server-side use only).
 * Returns null if not configured.
 */
export async function getGeminiApiKey(): Promise<string | null> {
  const setting = await db.setting.findUnique({ where: { key: 'gemini_api_key' } })
  if (!setting) return null
  const decrypted = decryptValue(setting.value)
  return decrypted?.trim() || null
}

// GET /api/admin/filter-settings — Return filter settings
export async function GET(req: NextRequest) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

  const settings = await getFilterSettings()

  return NextResponse.json({
    autoApprove: settings.autoApprove,
    blockedWords: settings.blockedWords,
    nsfwWords: settings.nsfwWords,
    filterRules: settings.filterRules,
    geminiEnabled: settings.geminiEnabled,
    geminiApiKeySet: settings.geminiApiKeySet,
    defaults: {
      blockedWords: DEFAULT_BLOCKED_WORDS,
      nsfwWords: DEFAULT_NSFW_WORDS,
      filterRules: DEFAULT_FILTER_RULES,
    },
  })
}

// POST /api/admin/filter-settings — Save filter settings
export async function POST(req: NextRequest) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

  try {
    const body = await req.json()
    const { autoApprove, blockedWords, nsfwWords, filterRules, geminiEnabled, geminiApiKey } = body as {
      autoApprove?: boolean
      blockedWords?: string[]
      nsfwWords?: string[]
      filterRules?: Partial<FilterRules>
      geminiEnabled?: boolean
      geminiApiKey?: string
    }

    const results: { key: string; updated: boolean }[] = []

    // Save auto_approve (not encrypted, like post_method)
    if (typeof autoApprove === 'boolean') {
      await db.setting.upsert({
        where: { key: 'auto_approve' },
        update: { value: autoApprove ? 'true' : 'false' },
        create: { key: 'auto_approve', value: autoApprove ? 'true' : 'false' },
      })
      results.push({ key: 'auto_approve', updated: true })
    }

    // Save blocked_words (encrypted JSON array)
    if (Array.isArray(blockedWords)) {
      // Validate each word is a non-empty string
      const validWords = blockedWords.filter(
        (w: unknown) => typeof w === 'string' && w.trim().length > 0
      )
      // Deduplicate
      const uniqueWords = [...new Set(validWords.map((w: string) => w.toLowerCase().trim()))]

      const encryptedValue = encrypt(JSON.stringify(uniqueWords))

      await db.setting.upsert({
        where: { key: 'blocked_words' },
        update: { value: encryptedValue },
        create: { key: 'blocked_words', value: encryptedValue },
      })
      results.push({ key: 'blocked_words', updated: true })
    }

    // Save nsfw_words (encrypted JSON array)
    if (Array.isArray(nsfwWords)) {
      const validWords = nsfwWords.filter(
        (w: unknown) => typeof w === 'string' && w.trim().length > 0
      )
      const uniqueWords = [...new Set(validWords.map((w: string) => w.toLowerCase().trim()))]

      const encryptedValue = encrypt(JSON.stringify(uniqueWords))

      await db.setting.upsert({
        where: { key: 'nsfw_words' },
        update: { value: encryptedValue },
        create: { key: 'nsfw_words', value: encryptedValue },
      })
      results.push({ key: 'nsfw_words', updated: true })
    }

    // Save filter_rules (encrypted JSON object)
    if (filterRules && typeof filterRules === 'object') {
      // Merge with defaults for any missing keys
      const merged = { ...DEFAULT_FILTER_RULES, ...filterRules }

      const encryptedValue = encrypt(JSON.stringify(merged))

      await db.setting.upsert({
        where: { key: 'filter_rules' },
        update: { value: encryptedValue },
        create: { key: 'filter_rules', value: encryptedValue },
      })
      results.push({ key: 'filter_rules', updated: true })
    }

    // Save gemini_enabled (not encrypted, like auto_approve)
    if (typeof geminiEnabled === 'boolean') {
      await db.setting.upsert({
        where: { key: 'gemini_enabled' },
        update: { value: geminiEnabled ? 'true' : 'false' },
        create: { key: 'gemini_enabled', value: geminiEnabled ? 'true' : 'false' },
      })
      results.push({ key: 'gemini_enabled', updated: true })
    }

    // Save gemini_api_key (encrypted, sensitive)
    if (typeof geminiApiKey === 'string') {
      if (geminiApiKey.trim()) {
        const encryptedValue = encrypt(geminiApiKey.trim())
        await db.setting.upsert({
          where: { key: 'gemini_api_key' },
          update: { value: encryptedValue },
          create: { key: 'gemini_api_key', value: encryptedValue },
        })
      } else {
        // Empty string = delete the key
        await db.setting.deleteMany({ where: { key: 'gemini_api_key' } })
      }
      results.push({ key: 'gemini_api_key', updated: true })
    }

    return NextResponse.json({ success: true, results })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
