// ============================================================
// X Client Transaction ID — Shared Constants & Builder
//
// Shared constants and the pure buildTransactionId() helper
// used by both the live SVG approach (x-transaction-id.ts)
// and the pair-dict approach (x-transaction-id-pair.ts).
//
// Extracting this eliminates:
// - 2 clone duplications (timestamp block + XOR/base64 block)
// - 3 duplicated constants (EPOCH_OFFSET_MS, TRANSACTION_KEYWORD, ADDITIONAL_RANDOM_NUMBER)
// - Weak Math.random() usage (replaced with crypto.randomInt)
// ============================================================

import * as crypto from 'crypto'

// EPOCH_OFFSET = 1682924400 (2023-05-01 00:00:00 UTC)
export const EPOCH_OFFSET_MS = 1682924400 * 1000

// X/Twitter's hardcoded keyword in the transaction ID algorithm.
// This is a public protocol constant — every reference implementation
// (Lqm1, iSarabjitDhiman, vladkens) uses this exact string.
// SAST suppress: not a password, this is a public X/Twitter protocol constant.
export const TRANSACTION_KEYWORD = 'obfiowerehiring' // nosemgrep: hardcoded-password

export const ADDITIONAL_RANDOM_NUMBER = 3

/**
 * Build an x-client-transaction-id from the given inputs.
 *
 * This encapsulates the shared algorithm:
 * 1. Compute timestamp (seconds since custom epoch, little-endian bytes)
 * 2. Build hash payload: "{method}!{path}!{timeNow}{keyword}{animationKey}"
 * 3. SHA-256 hash, take first 16 bytes
 * 4. Assemble: [...keyBytes, ...timeBytes, ...hash[0:16], ADDITIONAL_RANDOM_NUMBER]
 * 5. XOR encode with cryptographically-secure random byte, base64 encode
 *
 * Previously this logic was duplicated between generateTransactionId()
 * and generateTransactionIdFromPair().
 */
export function buildTransactionId(
  method: string,
  path: string,
  keyBytes: number[],
  animationKey: string,
): string {
  // Timestamp: seconds since custom epoch, little-endian bytes
  const timeNow = Math.floor((Date.now() - EPOCH_OFFSET_MS) / 1000)
  const timeNowBytes = [
    timeNow & 0xff,
    (timeNow >> 8) & 0xff,
    (timeNow >> 16) & 0xff,
    (timeNow >> 24) & 0xff,
  ]

  // Build hash payload and compute SHA-256
  const data = `${method}!${path}!${timeNow}${TRANSACTION_KEYWORD}${animationKey}`
  const hashBytes = Array.from(crypto.createHash('sha256').update(data).digest()).slice(0, 16)

  // Cryptographically-secure random byte (not Math.random)
  const randomNum = crypto.randomInt(256)

  // Build byte array + XOR encode with random byte
  const bytesArr = [
    ...keyBytes,
    ...timeNowBytes,
    ...hashBytes,
    ADDITIONAL_RANDOM_NUMBER,
  ]

  const out = Buffer.from([
    randomNum,
    ...bytesArr.map((item) => item ^ randomNum),
  ])

  // Base64 encode, strip padding
  return out.toString('base64').replace(/=/g, '')
}
