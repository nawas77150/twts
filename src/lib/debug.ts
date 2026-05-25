/**
 * Namespaced debug logging with timestamps.
 *
 * Set DEBUG=1 or DEBUG=* to enable all namespaces.
 * Set DEBUG=submit,direct to enable specific namespaces (comma-separated).
 * Unset or empty to disable (production-clean logs).
 *
 * Usage:
 *   import { debug } from '@/lib/debug'
 *   debug('submit', 'Post succeeded! tweetId:', tweetId)
 *   debug('direct', 'Attempt', attempt, 'failed')
 */

const DEBUG_ENV = process.env.DEBUG || ''
const DEBUG_ALL = DEBUG_ENV === '1' || DEBUG_ENV === '*' || DEBUG_ENV === 'true'
const ENABLED_NAMESPACES = DEBUG_ALL ? null : new Set(DEBUG_ENV.split(',').map(s => s.trim()).filter(Boolean))

function isNamespaceEnabled(namespace: string): boolean {
  if (!DEBUG_ENV) return false
  if (DEBUG_ALL) return true
  return ENABLED_NAMESPACES!.has(namespace)
}

function timestamp(): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

export function debug(namespace: string, ...args: unknown[]): void {
  if (isNamespaceEnabled(namespace)) {
    console.log(`${timestamp()} [${namespace}]`, ...args) // eslint-disable-line no-console
  }
}

export function debugError(namespace: string, ...args: unknown[]): void {
  if (isNamespaceEnabled(namespace)) {
    console.error(`${timestamp()} [${namespace}]`, ...args) // eslint-disable-line no-console
  }
}
