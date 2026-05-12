// ============================================================
// X Client Transaction ID Generator
//
// Generates the x-client-transaction-id header value required
// for authenticated API requests to X (formerly Twitter).
//
// This is X's primary anti-bot mechanism since ~2024. Without it,
// requests are flagged as automated and may receive code 344
// (daily limit exceeded) even for normal usage.
//
// Algorithm:
// 1. Fetch x.com homepage → extract site verification key + ondemand JS URL
// 2. Fetch ondemand JS → extract key byte indices
// 3. Parse SVG animation frames from homepage
// 4. Compute animation key (cubic bezier interpolation)
// 5. Build transaction ID: SHA-256 hash + XOR encoding + base64
//
// Adapted from:
// - Lqm1/x-client-transaction-id (TypeScript, browser-based)
// - iSarabjitDhiman/XClientTransaction (Python)
// - vladkens/twscrape (Python, xclid.py)
//
// Key difference from browser implementations: uses regex-based
// HTML parsing instead of DOM APIs (no Document in Node.js).
// ============================================================

import * as crypto from 'crypto'

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'

// --- Shared HTML Cache ---
// Both fetchLiveQueryId (twitter-post-cookie.ts) and getTransactionIdConfig
// need the x.com homepage HTML. To avoid fetching it twice on cold starts,
// we cache the HTML here with a short TTL. Both functions call fetchXcomHtml()
// instead of fetching independently.
let cachedHtml: string | null = null
let cachedHtmlTime: number = 0
const HTML_CACHE_TTL = 5 * 60 * 1000 // 5 minutes — short TTL, just for deduplication

/**
 * Fetch x.com homepage HTML with in-memory caching.
 * Shared between fetchLiveQueryId and getTransactionIdConfig
 * to avoid duplicate fetches on cold starts.
 */
export async function fetchXcomHtml(): Promise<string> {
  const now = Date.now()
  if (cachedHtml && now - cachedHtmlTime < HTML_CACHE_TTL) {
    return cachedHtml
  }
  const resp = await fetch('https://x.com', {
    headers: { 'User-Agent': BROWSER_UA },
  })
  if (!resp.ok) {
    throw new Error(`Failed to fetch x.com homepage: ${resp.status}`)
  }
  cachedHtml = await resp.text()
  cachedHtmlTime = now
  return cachedHtml
}

const ON_DEMAND_CHUNK_NAME = 'ondemand.s'
const INDICES_REGEX = /\(\w\[(\d{1,2})\],\s*16\)/g
const ON_DEMAND_FILE_HASH_REGEX =
  /(\d+):\s*["']ondemand\.s["'][\s\S]*?\}\)\[e\]\s*\|\|\s*e\)\s*\+\s*["']\.["']\s*\+\s*\(\{[\s\S]*?\b\1:\s*["']([a-zA-Z0-9_-]+)["']/s

// EPOCH_OFFSET = 1682924400 (2023-05-01 00:00:00 UTC)
const EPOCH_OFFSET_MS = 1682924400 * 1000
const DEFAULT_KEYWORD = 'obfiowerehiring'
const ADDITIONAL_RANDOM_NUMBER = 3

// --- Cubic Bezier Interpolation ---
// Implements proper CSS cubic-bezier(x1, y1, x2, y2) evaluation.
//
// The curve goes from (0,0) to (1,1) with control points (x1,y1) and (x2,y2).
// Given an x-value (time), we need to find the corresponding y-value:
//   1. Find t such that bezierX(t) = x  (Newton-Raphson root-finding)
//   2. Return bezierY(t)
//
// This replaces the previous broken implementation which:
//   - Had a confused constructor that overwrote itself 3 times
//   - Used a linear approximation instead of proper cubic bezier math
//   - Produced detectably wrong animation keys → wrong transaction IDs
//
// Reference: Lqm1/x-client-transaction-id npm package, WebKit CSS animation code

class Cubic {
  // Polynomial coefficients for X(t) = ax·t³ + bx·t² + cx·t
  // Derived from: X(t) = 3(1-t)²t·x1 + 3(1-t)t²·x2 + t³
  private ax: number
  private bx: number
  private cx: number
  // Polynomial coefficients for Y(t) = ay·t³ + by·t² + cy·t
  private ay: number
  private by: number
  private cy: number

  constructor(curves: number[]) {
    // curves = [x1, y1, x2, y2] — CSS cubic-bezier control points
    const x1 = curves[0]
    const y1 = curves[1]
    const x2 = curves[2]
    const y2 = curves[3]

    // X(t) = (1 - 3x2 + 3x1)·t³ + (3x2 - 6x1)·t² + 3x1·t
    this.ax = 1.0 - 3.0 * x2 + 3.0 * x1
    this.bx = 3.0 * x2 - 6.0 * x1
    this.cx = 3.0 * x1

    // Y(t) = (1 - 3y2 + 3y1)·t³ + (3y2 - 6y1)·t² + 3y1·t
    this.ay = 1.0 - 3.0 * y2 + 3.0 * y1
    this.by = 3.0 * y2 - 6.0 * y1
    this.cy = 3.0 * y1
  }

  /**
   * Evaluate the cubic bezier curve at the given x-position.
   * Uses Newton-Raphson iteration to find the parameter t where X(t) = x,
   * then returns Y(t) — the actual animation value at that time.
   */
  getValue(x: number): number {
    // Newton-Raphson: find t such that X(t) = x
    let t = x // initial guess (good for monotonic curves)
    for (let i = 0; i < 8; i++) {
      // f(t) = X(t) - x  (we want f(t) = 0)
      const fx = ((this.ax * t + this.bx) * t + this.cx) * t - x
      // f'(t) = X'(t) = 3ax·t² + 2bx·t + cx
      const dfx = (3.0 * this.ax * t + 2.0 * this.bx) * t + this.cx
      if (Math.abs(dfx) < 1e-6) break // avoid division by near-zero
      t -= fx / dfx
    }
    // Clamp to [0, 1] — Newton-Raphson can overshoot
    t = Math.max(0, Math.min(1, t))
    // Return Y(t) — the interpolated animation value
    return ((this.ay * t + this.by) * t + this.cy) * t
  }
}

function interpolate(from: number[], to: number[], val: number): number[] {
  return from.map((f, i) => f + (to[i] - f) * val)
}

function solve(value: number, minVal: number, maxVal: number, rounding: boolean): number {
  const result = (value * (maxVal - minVal)) / 255 + minVal
  return rounding ? Math.floor(result) : Math.round(result * 100) / 100
}

function isOdd(n: number): number {
  return n % 2 !== 0 ? 1 : 0
}

/**
 * Convert a float to its hex string representation (base-16 with fraction).
 * Handles both integer and fractional parts separately, matching the
 * reference implementations from Lqm1/x-client-transaction-id and
 * iSarabjitDhiman/XClientTransaction.
 *
 * Examples:
 *   1.0  → "1"
 *   0.87 → ".deb851eb851eb8"
 *   0.0  → ""
 *
 * The calling code handles the edge cases:
 *   - Empty string → falls through to "0" via || "0"
 *   - Starts with "." → prepends "0" and lowercases
 *   - All dots are stripped in the final key assembly
 */
function floatToHex(x: number): string {
  const result: string[] = []
  let quotient = Math.floor(x)
  let fraction = x - quotient

  while (quotient > 0) {
    const newQuotient = Math.floor(x / 16)
    const remainder = Math.floor(x - newQuotient * 16)
    if (remainder > 9) {
      result.unshift(String.fromCharCode(remainder + 55))
    } else {
      result.unshift(remainder.toString())
    }
    x = newQuotient
    quotient = newQuotient
  }

  if (fraction === 0) {
    return result.join('')
  }

  result.push('.')
  while (fraction > 0) {
    fraction *= 16
    const integer = Math.floor(fraction)
    fraction -= integer
    if (integer > 9) {
      result.push(String.fromCharCode(integer + 55))
    } else {
      result.push(integer.toString())
    }
  }

  return result.join('')
}

function convertRotationToMatrix(degrees: number): number[] {
  const rad = (degrees * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return [cos, sin, -sin, cos, 0, 0]
}

// --- HTML Parsing Helpers (Node.js — no DOM) ---

/**
 * Extract the twitter-site-verification key from HTML
 */
function extractSiteVerificationKey(html: string): string {
  const match = html.match(
    /<meta\s+name=["']twitter-site-verification["']\s+content=["']([^"']+)["']/
  )
  if (!match) {
    throw new Error('Could not find twitter-site-verification meta tag')
  }
  return match[1]
}

/**
 * Extract the ondemand.s JS file URL from the main runtime script
 */
function extractOnDemandFileUrl(html: string): string {
  // Find all script blocks that reference ondemand.s
  const scriptBlocks: string[] = []

  // Extract inline script contents
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi
  let scriptMatch: RegExpExecArray | null
  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    if (scriptMatch[1].includes(ON_DEMAND_CHUNK_NAME)) {
      scriptBlocks.push(scriptMatch[1])
    }
  }

  // Also search the full HTML (sometimes it's in data attributes)
  scriptBlocks.push(html)

  for (const block of scriptBlocks) {
    const onDemandMatch = ON_DEMAND_FILE_HASH_REGEX.exec(block)
    if (onDemandMatch) {
      return `https://abs.twimg.com/responsive-web/client-web/${ON_DEMAND_CHUNK_NAME}.${onDemandMatch[2]}a.js`
    }
  }

  throw new Error('Could not resolve ondemand.s file URL')
}

/**
 * Extract key byte indices from the ondemand JS file
 */
function extractIndices(ondemandJs: string): [number, number[]] {
  const keyByteIndices: number[] = []
  let match: RegExpExecArray | null
  const regex = new RegExp(INDICES_REGEX.source, 'g')
  while ((match = regex.exec(ondemandJs)) !== null) {
    keyByteIndices.push(parseInt(match[1], 10))
  }

  if (keyByteIndices.length === 0) {
    throw new Error('Could not extract key byte indices from ondemand file')
  }

  return [keyByteIndices[0], keyByteIndices.slice(1)]
}

/**
 * Parse SVG animation frames from the homepage HTML.
 * Extracts the "d" attribute from the loading-x-anim SVG elements.
 */
function extractAnimationFrames(html: string, keyBytes: number[]): number[][] {
  // Find all loading-x-anim elements
  const framePattern = /<svg[^>]*id=["']loading-x-anim-\d+["'][^>]*>([\s\S]*?)<\/svg>/gi
  const frames: string[] = []
  let frameMatch: RegExpExecArray | null
  while ((frameMatch = framePattern.exec(html)) !== null) {
    frames.push(frameMatch[1])
  }

  if (frames.length === 0) {
    throw new Error('Could not find loading-x-anim SVG elements')
  }

  // Select frame based on keyBytes[5] % 4
  const frameIndex = keyBytes[5] % Math.min(frames.length, 4)
  const frameContent = frames[frameIndex]

  // Navigate: first child's second child's "d" attribute
  // In HTML: frame.children[0].children[1].getAttribute("d")
  // In regex: find <g> or <path> with "d" attribute
  const pathMatch = frameContent.match(/<path[^>]*\sd=["']([^"']+)["']/i)
  if (!pathMatch) {
    // Try alternate structure: <g><path d="..."/></g>
    const gMatch = frameContent.match(/<g[^>]*>[\s\S]*?<path[^>]*\sd=["']([^"']+)["']/i)
    if (!gMatch) {
      throw new Error('Could not extract SVG path data from animation frame')
    }
    return parseDAttribute(gMatch[1])
  }

  return parseDAttribute(pathMatch[1])
}

function parseDAttribute(d: string): number[][] {
  // Remove first 9 chars and split by "C"
  const items = d.substring(9).split('C')

  return items.map((item) => {
    // Replace non-digits with spaces, split, convert to ints
    const cleaned = item.replace(/[^\d-]+/g, ' ').trim()
    if (cleaned === '') return []
    return cleaned.split(/\s+/).map((s) => parseInt(s, 10))
  })
}

/**
 * Compute the animation key from SVG frame data
 */
function computeAnimationKey(
  keyBytes: number[],
  rowIndex: number,
  keyBytesIndices: number[],
  html: string
): string {
  const totalTime = 4096

  // Compute row index
  const actualRowIndex = keyBytes[rowIndex] % 16

  // Compute frame time
  let frameTime = keyBytesIndices.reduce(
    (product, idx) => product * (keyBytes[idx] % 16),
    1
  )
  frameTime = Math.round(frameTime / 10) * 10

  // Get 2D array from SVG
  const arr = extractAnimationFrames(html, keyBytes)
  if (!arr[actualRowIndex]) {
    throw new Error(`Animation frame row ${actualRowIndex} not found`)
  }

  const frameRow = arr[actualRowIndex]
  const targetTime = frameTime / totalTime

  // Animate
  const fromColor = [...frameRow.slice(0, 3), 1].map(Number)
  const toColor = [...frameRow.slice(3, 6), 1].map(Number)
  const fromRotation = [0.0]
  const toRotation = [solve(frameRow[6], 60.0, 360.0, true)]

  const remainingFrames = frameRow.slice(7)
  const curves = remainingFrames.map((item, counter) =>
    solve(item, isOdd(counter), 1.0, false)
  )

  const cubic = new Cubic(curves)
  const val = cubic.getValue(targetTime)
  const color = interpolate(fromColor, toColor, val).map((v) =>
    Math.max(0, v)
  )
  const rotation = interpolate(fromRotation, toRotation, val)
  const matrix = convertRotationToMatrix(rotation[0])

  // Convert to hex string
  const strArr: string[] = color
    .slice(0, -1)
    .map((value) => Math.round(value).toString(16))

  for (const value of matrix) {
    let rounded = Math.round(value * 100) / 100
    if (rounded < 0) rounded = -rounded
    const hexValue = floatToHex(rounded)
    strArr.push(
      hexValue.startsWith('.') ? `0${hexValue}`.toLowerCase() : hexValue || '0'
    )
  }

  strArr.push('0', '0')
  return strArr.join('').replace(/[.-]/g, '')
}

// --- Main Transaction ID Generator ---

interface TransactionIdConfig {
  keyBytes: number[]
  animationKey: string
  rowIndex: number
  keyBytesIndices: number[]
}

let cachedConfig: TransactionIdConfig | null = null
let cachedConfigTime: number = 0
const CONFIG_CACHE_TTL = 4 * 60 * 60 * 1000 // 4 hours

/**
 * Fetch and cache the transaction ID configuration from X's homepage.
 * This is expensive (3 fetches) so we cache it for 4 hours.
 */
async function getTransactionIdConfig(): Promise<TransactionIdConfig> {
  const now = Date.now()
  if (cachedConfig && now - cachedConfigTime < CONFIG_CACHE_TTL) {
    return cachedConfig
  }

  // Step 1: Fetch x.com homepage (uses shared cache to avoid duplicate fetches)
  const html = await fetchXcomHtml()

  // Step 2: Extract site verification key
  const key = extractSiteVerificationKey(html)
  const keyBytes = Array.from(Buffer.from(key, 'base64'))

  // Step 3: Extract ondemand JS URL and fetch it
  const onDemandUrl = extractOnDemandFileUrl(html)
  const onDemandResp = await fetch(onDemandUrl, {
    headers: { 'User-Agent': BROWSER_UA },
  })
  if (!onDemandResp.ok) {
    throw new Error(`Failed to fetch ondemand file: ${onDemandResp.status}`)
  }
  const onDemandJs = await onDemandResp.text()

  // Step 4: Extract indices
  const [rowIndex, keyBytesIndices] = extractIndices(onDemandJs)

  // Step 5: Compute animation key
  const animationKey = computeAnimationKey(
    keyBytes,
    rowIndex,
    keyBytesIndices,
    html
  )

  cachedConfig = { keyBytes, animationKey, rowIndex, keyBytesIndices }
  cachedConfigTime = now

  return cachedConfig
}

/**
 * Generate an x-client-transaction-id for a given HTTP method and path.
 *
 * Usage:
 *   const tid = await generateTransactionId('POST', '/i/api/graphql/xxx/CreateTweet')
 *   // → "ey4Kxa8F2d..."
 *
 * This should be called for every API request and the result sent as
 * the x-client-transaction-id header.
 */
export async function generateTransactionId(
  method: string,
  path: string
): Promise<string> {
  const config = await getTransactionIdConfig()

  // Calculate timestamp (seconds since custom epoch)
  const timeNow = Math.floor((Date.now() - EPOCH_OFFSET_MS) / 1000)
  const timeNowBytes = [
    timeNow & 0xff,
    (timeNow >> 8) & 0xff,
    (timeNow >> 16) & 0xff,
    (timeNow >> 24) & 0xff,
  ]

  // Build hash payload
  const data = `${method}!${path}!${timeNow}${DEFAULT_KEYWORD}${config.animationKey}`

  // SHA-256 hash
  const hashBytes = Array.from(crypto.createHash('sha256').update(data).digest())

  // Build byte array
  const randomNum = Math.floor(Math.random() * 256)
  const bytesArr = [
    ...config.keyBytes,
    ...timeNowBytes,
    ...hashBytes.slice(0, 16),
    ADDITIONAL_RANDOM_NUMBER,
  ]

  // XOR encode with random byte
  const out = Buffer.from([
    randomNum,
    ...bytesArr.map((item) => item ^ randomNum),
  ])

  // Base64 encode, strip padding
  return out.toString('base64').replace(/=/g, '')
}

/**
 * Clear all cached data (transaction ID config + HTML cache).
 * Call this if you start getting 404s or other errors that might
 * indicate X has updated their frontend.
 */
export function clearTransactionIdCache(): void {
  cachedConfig = null
  cachedConfigTime = 0
  cachedHtml = null
  cachedHtmlTime = 0
}
