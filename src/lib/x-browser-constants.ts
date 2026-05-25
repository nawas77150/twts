// ============================================================
// x-browser-constants.ts — Browser identity constants for X API
//
// Single source of truth for User-Agent and Client Hints used
// in direct posting (headers) and spec resolution (fetch).
//
// When bumping Chrome version, update ONLY this file.
// Consumers:
//   - twitter-post-cookie.ts (headers: User-Agent + sec-ch-ua)
//   - create-tweet-spec.ts   (fetch: User-Agent for JS bundle)
//   - x-transaction-id.ts    (fetch: User-Agent for x.com HTML + ondemand JS)
// ============================================================

/** Chrome 148 on Linux — synced from fa0311/latest-user-agent */
export const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

/** Chrome Client Hints — matches the User-Agent above (Chrome 148 format) */
export const SEC_CH_UA = '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"'
