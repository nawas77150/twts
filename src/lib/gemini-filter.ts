// ============================================================
// gemini-filter.ts — AI-powered content filter using Gemini
// ============================================================
// Optional enhancement over the rule-based content filter.
// If no Gemini API key is configured, this is skipped entirely.
// If Gemini returns an error/timeout, the submission goes to pending for manual review.
// Gemini only runs if the rule-based filter PASSES (saves API calls).
// ============================================================

import { debug } from './debug'
import { getErrorMessage } from './utils'
import { DEFAULT_GEMINI_MODEL } from './rate-limit-defaults'

const TIMEOUT_MS = 8000 // 8 second timeout — don't block submissions too long

// --- Types ---

export interface GeminiFilterResult {
  checked: boolean       // true if Gemini was actually called
  passed: boolean        // true = safe to auto-approve, false = needs manual review
  reason: string | null  // Why it was flagged (null if passed or not checked)
  error: string | null   // Error message if Gemini failed (null if successful)
}

// --- System Prompt ---

// Designed for Alter menfess: lenient on typical alter content (venting, profanity,
// relationship drama), strict on genuinely harmful content.
export const DEFAULT_GEMINI_SYSTEM_PROMPT = `You are a content moderator for an Indonesian Twitter menfess (anonymous confession) account called an "Alter menfess". 

Your job: decide if a submission is SAFE to auto-post or NEEDS manual admin review.

CONTEXT: This is an Alter menfess community. Users submit anonymous confessions, vents, crush messages, and opinions. The community is more open than mainstream menfess — but content must still comply with X/Twitter rules to avoid account suspension or restriction.

ALLOWED content (do NOT flag these):
- Profanity and rough language (anjing, bangsat, goblok, bodoh, etc.) — very common in alter culture
- Relationship vents, drama, crush confessions, breakups, toxic ex rants
- Mental health discussions (depresi, anxiety, overthinking, burnout, trauma healing)
- Romantic/relationship topics using slang (bucin, red flag, ghosting, toxic, situationship)
- Slang, abbreviations, informal Indonesian, alay language
- Emotional vents, rants, frustration about life/school/work
- Discussing adult topics abstractly (mentioning libido, frustration, loneliness) — but NOT explicit descriptions or offers

FLAG for manual review (these violate X/Twitter rules or risk account suspension):

1. HATE SPEECH & HATEFUL CONDUCT
   - Attacking people based on religion, race, ethnicity (SARA): e.g. "islam anjing", "cina bodoh", "kafir"
   - Homophobia, transphobia, misogyny as attacks (not just discussion): e.g. "banci ampas", "perempuan murahan"
   - Disability as insult: e.g. "retard", "autis lu" (used as slur, not diagnosis discussion)

2. VIOLENCE & THREATS
   - Specific threats against a person or group: e.g. "bakar rumah lo", "hajar sampe mati"
   - Wishing harm, celebrating violence: e.g. "mampus lu", "semoga mati"
   - Describing violent acts in detail (gore): e.g. graphic descriptions of injury, torture, murder
   - Inciting others to violence: e.g. "kita serang dia", "gas orang ini"

3. CHILD SAFETY
   - Any sexualization of minors: e.g. "anak smp tapi bohay", "umur 14 tapi udah"
   - Grooming language directed at minors: e.g. "dm ya sayang" directed at underage context
   - Child abuse descriptions or jokes

4. SELF-HARM & SUICIDE
   - Encouraging or instructing self-harm: e.g. "cara gantung diri", "minum obat ini biar mati"
   - Romanticizing suicide: e.g. "mati itu tenang", "lebih baik mati" (as advice, NOT as venting)
   - Note: "Aku mau mati aja" as emotional venting is ALLOWED — flag only if encouraging/instructing

5. SEXUAL SOLICITATION & EXPLOITATION
   - Paid sexual services: e.g. "temenin with fee", "open bo", "bookingan", "malam ini rate 500k"
   - Coded escort language + payment indicators: "dm for info 💰", "available tonight, mahar?"
   - Sexual offers even without explicit payment: "yang mau sepong dm", "ready buat ml"
   - Non-consensual intimate content: sharing/distributing someone's nudes, revenge porn, "bokep [name]"
   - Bestiality or incest references

6. PRIVACY & DOXXING
   - Sharing someone's private info: full name + address, phone numbers, ID/NIK numbers, private photos
   - Revealing alter accounts: "real face of @username", "ini akun asli dia"
   - Threatening to expose someone: "kalo ga bayar aku leak"

7. ILLEGAL & REGULATED GOODS
   - Drug sales or use instructions: e.g. "jual sabu", "cara pakai narkoba", "ganja murah"
   - Weapon sales: e.g. "jual senapan", "beli pisau lipat"
   - Fraud, scams, phishing: e.g. "klik ini buat saldo gratis", pyramid schemes
   - Counterfeit goods/services

8. PLATFORM MANIPULATION
   - Coordinated raid language: e.g. "gas report @username", "serang akun ini"
   - Spam patterns: identical message across multiple submissions

IMPORTANT DISTINCTIONS:
- "Anjing" as profanity → ALLOWED. "Anjing kamu" as personal attack → context-dependent, usually ALLOWED as venting.
- "Benci sama agama X" as personal opinion → ALLOWED. "Agama X harus dibakar" → FLAG (incitement).
- "Lagi sange bgt" as venting → ALLOWED. "Lagi sange, siapa mau? fee 200k" → FLAG (solicitation).
- "Mau mati aja gw" as emotional cry → ALLOWED. "Minum racun biar mati, gampang kok" → FLAG (instructing self-harm).

RESPOND IN THIS EXACT FORMAT (no other text):
- If SAFE: {"safe": true}
- If NEEDS REVIEW: {"safe": false, "reason": "brief explanation in English"}

When in doubt, flag for manual review. It's better to have an admin double-check than to let harmful content through and risk X account suspension. The rule-based filter already catches explicit keywords — you're here for nuance, context, and coded language the rules can't catch. Flagged submissions go to a pending queue where an admin can review and approve if appropriate.`

// --- Main Filter Function ---

export async function runGeminiFilter(
  message: string,
  apiKey: string,
  model: string = DEFAULT_GEMINI_MODEL,
  systemPrompt?: string | null,
): Promise<GeminiFilterResult> {
  if (!apiKey || !apiKey.trim()) {
    // No API key configured — skip Gemini filter entirely
    return { checked: false, passed: true, reason: null, error: null }
  }

  try {
    debug('gemini-filter', 'Running AI filter on message:', message.length, 'chars')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => { controller.abort() }, TIMEOUT_MS)

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey.trim(),
      },
      signal: controller.signal,
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt || DEFAULT_GEMINI_SYSTEM_PROMPT }],
        },
        contents: [
          {
            parts: [{ text: message }],
          },
        ],
        generationConfig: {
          temperature: 0.1, // Very low — we want consistent moderation decisions
          maxOutputTokens: 100, // Short response is all we need
          responseMimeType: 'application/json',
        },
      }),
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown')
      debug('gemini-filter', 'API error:', response.status, errorBody)
      // Send to pending on API errors — don't auto-approve if we can't verify
      return {
        checked: true,
        passed: false,
        reason: `Gemini API error (${response.status})`,
        error: `Gemini API error (${response.status}): ${errorBody.slice(0, 100)}`,
      }
    }

    const data = await response.json()

    // Extract text from Gemini response
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      debug('gemini-filter', 'Empty response from Gemini')
      return {
        checked: true,
        passed: false,
        reason: 'Empty Gemini response',
        error: 'Empty response from Gemini',
      }
    }

    debug('gemini-filter', 'Gemini response:', text)

    // Parse JSON response
    let result: { safe: boolean; reason?: string }
    try {
      result = JSON.parse(text)
    } catch {
      debug('gemini-filter', 'Failed to parse Gemini response as JSON:', text)
      // Can't parse — send to pending for manual review
      return {
        checked: true,
        passed: false,
        reason: 'Gemini parse error',
        error: `Failed to parse Gemini response: ${text.slice(0, 100)}`,
      }
    }

    if (result.safe) {
      return { checked: true, passed: true, reason: null, error: null }
    }

    // Flagged by Gemini
    return {
      checked: true,
      passed: false,
      reason: result.reason || 'Flagged by AI',
      error: null,
    }
  } catch (err) {
    const errorMsg = getErrorMessage(err, String(err))

    if (errorMsg.includes('abort')) {
      debug('gemini-filter', 'Request timed out')
      return {
        checked: true,
        passed: false,
        reason: 'Gemini timeout',
        error: 'Gemini request timed out (8s)',
      }
    }

    debug('gemini-filter', 'Exception:', errorMsg)
    // Send to pending on exceptions — don't auto-approve if we can't verify
    return {
      checked: true,
      passed: false,
      reason: 'Gemini exception',
      error: `Gemini filter error: ${errorMsg.slice(0, 100)}`,
    }
  }
}

// --- Submission-level Gemini check (used by runFilterPipeline) ---

export interface GeminiCheckResult {
  geminiPassed: boolean
  geminiError: boolean
}

/**
 * Run the Gemini AI filter for the submission pipeline.
 * Only runs if the rule-based filter passed, Gemini is enabled, and an API key is set.
 * Pushes 'ai:...' reasons into allFilterReasons if the submission is flagged.
 *
 * On error/exception, returns geminiPassed=true (don't block the submission)
 * and geminiError=true (so the caller can add 'ai:skipped_error' to filterReasons).
 */
export async function runGeminiSubmissionCheck(
  trimmedMessage: string,
  ruleBasedPassed: boolean,
  filterSettings: { geminiEnabled: boolean; geminiApiKeySet: boolean; geminiApiKey: string | null; geminiModel: string; geminiSystemPrompt?: string | null },
  allFilterReasons: string[],
): Promise<GeminiCheckResult> {
  if (!ruleBasedPassed || !filterSettings.geminiEnabled || !filterSettings.geminiApiKeySet) {
    return { geminiPassed: true, geminiError: false }
  }

  const geminiApiKey = filterSettings.geminiApiKey  // Already loaded — no extra DB call
  if (!geminiApiKey) return { geminiPassed: true, geminiError: false }

  try {
    debug('submit', 'Running Gemini AI filter')
    const geminiResult = await runGeminiFilter(trimmedMessage, geminiApiKey, filterSettings.geminiModel, filterSettings.geminiSystemPrompt)

    if (!geminiResult.passed) {
      if (geminiResult.error) {
        // Gemini error/timeout — skip it, don't block the submission
        debug('submit', 'Gemini error (skipping):', geminiResult.error)
        return { geminiPassed: true, geminiError: true }
      }
      // Gemini genuinely flagged the submission
      const geminiReason = geminiResult.reason || 'Flagged by AI'
      allFilterReasons.push(`ai:${geminiReason}`)
      debug('submit', 'Gemini flagged submission:', geminiReason)
      return { geminiPassed: false, geminiError: false }
    }

    debug('submit', 'Gemini passed submission')
    return { geminiPassed: true, geminiError: false }
  } catch (err) {
    // Gemini threw an exception — skip it, don't block the submission
    debug('submit', 'Gemini exception (skipping):', err)
    return { geminiPassed: true, geminiError: true }
  }
}
