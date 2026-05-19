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
import { DEFAULT_GEMINI_MODEL } from './filter-settings'

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
const SYSTEM_PROMPT = `You are a content moderator for an Indonesian Twitter menfess (anonymous confession) account called an "Alter menfess". 

Your job: decide if a submission is SAFE to auto-post or NEEDS manual admin review.

CONTEXT: This is an Alter menfess community. Users submit anonymous confessions, vents, crush messages, and opinions. The community is more open than mainstream menfess.

ALLOWED content (do NOT flag these):
- Profanity and rough language (anjing, bangsat, goblok, bodoh, etc.) — very common in alter culture
- Relationship vents, drama, crush confessions
- Mental health discussions (depresi, anxiety, overthinking, burnout)
- Sexual/romantic topics discussed casually (bucin, red flag, ghosting, toxic)
- Slang, abbreviations, informal Indonesian
- Emotional vents, rants, frustration

FLAG for manual review (these are NOT allowed):
- Hate speech targeting religion, race, ethnicity, or groups (SARA)
- Specific threats of violence against a person
- Encouraging self-harm or suicide
- Sharing someone's private info (doxxing): full name + address, phone numbers, ID numbers
- Targeted harassment of a specific individual (not just venting about them)
- Content that could get the account banned by X/Twitter (CSAM, non-consensual content)

RESPOND IN THIS EXACT FORMAT (no other text):
- If SAFE: {"safe": true}
- If NEEDS REVIEW: {"safe": false, "reason": "brief explanation in English"}

Important: When in doubt, flag for manual review. It's better to have an admin double-check than to let harmful content through. The rule-based filter already catches explicit words — you're here for nuance the rules can't catch. Flagged submissions go to a pending queue where an admin can review and approve if appropriate.`

// --- Main Filter Function ---

export async function runGeminiFilter(
  message: string,
  apiKey: string,
  model: string = DEFAULT_GEMINI_MODEL,
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
          parts: [{ text: SYSTEM_PROMPT }],
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
  filterSettings: { geminiEnabled: boolean; geminiApiKeySet: boolean; geminiApiKey: string | null; geminiModel: string },
  allFilterReasons: string[],
): Promise<GeminiCheckResult> {
  if (!ruleBasedPassed || !filterSettings.geminiEnabled || !filterSettings.geminiApiKeySet) {
    return { geminiPassed: true, geminiError: false }
  }

  const geminiApiKey = filterSettings.geminiApiKey  // Already loaded — no extra DB call
  if (!geminiApiKey) return { geminiPassed: true, geminiError: false }

  try {
    debug('submit', 'Running Gemini AI filter')
    const geminiResult = await runGeminiFilter(trimmedMessage, geminiApiKey, filterSettings.geminiModel)

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
