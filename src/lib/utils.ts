import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Extract a string message from an unknown error, with a fallback default. */
export function getErrorMessage(err: unknown, fallback = 'Unknown error'): string {
  return err instanceof Error ? err.message : fallback
}

/**
 * Type-safe, prototype-pollution-safe property accessor.
 * Validates the key against the object's own keys (whitelist) before access,
 * preventing prototype chain access (__proto__, constructor, etc.).
 *
 * SAST tools flag dynamic bracket access (obj[key]) as "Generic Object
 * Injection Sink" — this function provides the recommended mitigation:
 * validate and sanitize dynamic keys before using them to access properties.
 *
 * TypeScript enforces K extends keyof T at compile time; Object.keys()
 * provides the runtime whitelist validation.
 */
export function safeAccess<T extends object, K extends keyof T>(obj: T, key: K): T[K] {
  const ownKeys = Object.keys(obj) as K[]
  // eslint-disable-next-line security/detect-object-injection -- this function IS the key validation
  if (ownKeys.includes(key)) return obj[key]
  throw new Error(`Invalid key: ${String(key)}`)
}

/**
 * Prototype-pollution-safe optional property accessor.
 * Like safeAccess() but returns undefined for missing keys instead of throwing.
 *
 * Use for Record<string, T> lookups where the key may not exist
 * (e.g. blockedReasons[username]).
 *
 * SAST tools flag obj[dynamicKey] as "Generic Object Injection Sink";
 * Object.hasOwn() validates the key is an own property before access,
 * preventing prototype-chain traversal (__proto__, constructor, etc.).
 */
export function safeGet<T>(obj: Record<string, T>, key: string): T | undefined {
  // eslint-disable-next-line security/detect-object-injection -- Object.hasOwn validates before access
  return Object.hasOwn(obj, key) ? obj[key] : undefined
}
