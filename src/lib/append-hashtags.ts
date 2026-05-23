/** Maximum length of a single tweet on X. */
const MAX_TWEET_LENGTH = 280
const ELLIPSIS = '\u2026' // …

/**
 * Appends hashtags to a message, truncating the message if the total
 * exceeds 280 characters. Hashtags always survive truncation.
 * Returns the message unchanged if hashtags is empty.
 * Skips any hashtag already present in the message (case-insensitive,
 * exact token match, trailing punctuation stripped) to avoid duplicates.
 *
 * Used at post time (autopost + submit auto-post) as a safety net
 * for the case where admin changes hashtags after a submission was queued.
 */
export function appendHashtags(message: string, hashtags: string): string {
  if (!hashtags.trim()) return message

  const messageTokens = new Set(message.split(/\s+/).map(t => t.replace(/[.,;:!?]+$/, '').toLowerCase()))
  const tags = hashtags.trim().split(/\s+/)
  const missing = tags.filter(tag => !messageTokens.has(tag.toLowerCase()))

  if (missing.length === 0) return message

  const suffix = ` ${missing.join(' ')}`
  if (message.length + suffix.length <= MAX_TWEET_LENGTH) {
    return message + suffix
  }

  // Truncate message to fit hashtags + ellipsis
  const available = MAX_TWEET_LENGTH - suffix.length - ELLIPSIS.length
  return message.slice(0, Math.max(0, available)) + ELLIPSIS + suffix
}

/**
 * Returns the effective max message length when hashtags are known.
 * Used by the submission form to show the correct character limit.
 *
 * Formula: 280 - 1 (space) - hashtag length
 */
export function getEffectiveMaxLength(hashtags: string): number {
  if (!hashtags.trim()) return MAX_TWEET_LENGTH
  return MAX_TWEET_LENGTH - 1 - hashtags.trim().length
}
