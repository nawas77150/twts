// ============================================================
// X Client Transaction ID — HTML Parsing & Animation Key
//
// Extracts site verification key, ondemand JS URL, key byte
// indices, and SVG animation frames from X's homepage HTML.
// Computes the animation key via cubic bezier interpolation.
//
// Extracted from x-transaction-id.ts to reduce per-file complexity.
//
// All while+exec loops replaced with matchAll() + for...of to fix:
// - HIGH: assignment in expression (4 instances)
// - CRITICAL: RegExp constructor with non-literal value (1 instance)
// ============================================================

import { Cubic, interpolate, solve, isOdd, floatToHex, convertRotationToMatrix } from '@/lib/x-transaction-id-cubic'

const ON_DEMAND_CHUNK_NAME = 'ondemand.s'

// Keep the g flag — matchAll() requires it.
// Previously, new RegExp(INDICES_REGEX.source, 'g') was used to get a
// fresh instance (avoiding stale lastIndex). matchAll() creates its own
// internal iterator and does not mutate the original regex's lastIndex,
// so we can use the module-level constant directly.
const INDICES_REGEX = /\(\w\[(\d{1,2})\],\s*16\)/g

const ON_DEMAND_FILE_HASH_REGEX =
  /(\d+):\s*["']ondemand\.s["'][\s\S]*?\}\)\[e\]\s*\|\|\s*e\)\s*\+\s*["']\.["']\s*\+\s*\(\{[\s\S]*?\b\1:\s*["']([a-zA-Z0-9_-]+)["']/

/**
 * Extract the twitter-site-verification key from HTML
 */
export function extractSiteVerificationKey(html: string): string {
  const match = html.match(
    /<meta\s+name=["']twitter-site-verification["']\s+content=["']([^"']+)["']/
  )
  if (!match) {
    throw new Error('Could not find twitter-site-verification meta tag')
  }
  return match[1]
}

/**
 * Extract the ondemand.s JS file URL from the main runtime script.
 *
 * Previously used while+exec (assignment in expression).
 * Now uses matchAll() — same result, no Vercel HIGH flag.
 */
export function extractOnDemandFileUrl(html: string): string {
  // Find all script blocks that reference ondemand.s
  const scriptBlocks: string[] = []

  // Extract inline script contents using matchAll (fixes HIGH: assignment in expression)
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi
  for (const scriptMatch of html.matchAll(scriptRegex)) {
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
 * Extract key byte indices from the ondemand JS file.
 *
 * Previously used new RegExp(INDICES_REGEX.source, 'g') + while+exec.
 * Now uses matchAll() directly — fixes both CRITICAL (RegExp constructor)
 * and HIGH (assignment in expression).
 */
export function extractIndices(ondemandJs: string): [number, number[]] {
  const keyByteIndices: number[] = []
  for (const match of ondemandJs.matchAll(INDICES_REGEX)) {
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
 *
 * Previously used while+exec for two loops (assignment in expression ×2).
 * Now uses matchAll() — fixes both HIGH flags.
 */
export function extractAnimationFrames(html: string, keyBytes: number[]): number[][] {
  // Find all loading-x-anim elements using matchAll (fixes HIGH: assignment in expression)
  const framePattern = /<svg[^>]*id=["']loading-x-anim-\d+["'][^>]*>([\s\S]*?)<\/svg>/gi
  const frames: string[] = []
  for (const frameMatch of html.matchAll(framePattern)) {
    frames.push(frameMatch[1])
  }

  if (frames.length === 0) {
    throw new Error('Could not find loading-x-anim SVG elements')
  }

  // Select frame based on keyBytes[5] % 4
  const frameIndex = keyBytes[5] % Math.min(frames.length, 4)
  const frameContent = frames[frameIndex]

  // Navigate: first child's second child's "d" attribute
  // Reference (DOM): frame.children[0].children[1].getAttribute("d")
  // That means: first <g> → second child <path> → "d" attribute
  const gMatch = frameContent.match(/<g[^>]*>([\s\S]*?)<\/g>/i)
  if (gMatch) {
    const gContent = gMatch[1]
    const pathRegex = /<path[^>]*\sd=["']([^"']+)["']/gi
    const paths: string[] = []
    // matchAll (fixes HIGH: assignment in expression)
    for (const pMatch of gContent.matchAll(pathRegex)) {
      paths.push(pMatch[1])
    }
    // Reference: children[1] → second path element
    if (paths.length >= 2) {
      return parseDAttribute(paths[1])
    }
    if (paths.length === 1) {
      return parseDAttribute(paths[0])
    }
  }

  // Fallback: find any path with "d" attribute directly in the SVG
  const pathMatch = frameContent.match(/<path[^>]*\sd=["']([^"']+)["']/i)
  if (pathMatch) {
    return parseDAttribute(pathMatch[1])
  }

  throw new Error('Could not extract SVG path data from animation frame')
}

function parseDAttribute(d: string): number[][] {
  // Remove first 9 chars and split by "C"
  const items = d.substring(9).split('C')

  return items.map((item) => {
    // Replace non-digits with spaces, split, convert to ints
    // Hyphens are intentionally stripped: X's loading-x-anim SVGs encode unsigned
    // byte values (0–255) as path coordinates — negatives never occur in this data.
    // All reference implementations (Lqm1, iSarabjitDhiman, vladkens) do the same.
    const cleaned = item.replace(/[^\d]+/g, ' ').trim()
    if (cleaned === '') return []
    return cleaned.split(/\s+/).map((s) => parseInt(s, 10))
  })
}

/**
 * Compute the animation key from SVG frame data
 */
export function computeAnimationKey(
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
