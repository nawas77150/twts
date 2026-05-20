/** Milliseconds in 24 hours — used for content filter duplicate checks etc. */
export const MS_24H = 24 * 60 * 60 * 1000

/** App version — inlined by Next.js at build time via NEXT_PUBLIC_APP_VERSION (see next.config.ts) */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev'

/**
 * Returns the Date for 00:00:00 WIB (Asia/Jakarta, GMT+7) of the current day.
 * All rate limit counters reset at this boundary — "hari ini" = since this timestamp.
 *
 * How it works:
 * 1. Get current date string in WIB timezone (e.g. "2024-06-15")
 * 2. Construct an ISO datetime at 00:00:00+07:00
 * 3. JavaScript Date parses this into the correct UTC millisecond value
 */
export function getStartOfTodayWIB(): Date {
  const now = new Date()
  // "sv-SE" locale gives YYYY-MM-DD format; timeZone ensures we get the WIB date
  const wibDateString = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' })
  return new Date(`${wibDateString}T00:00:00+07:00`)
}
