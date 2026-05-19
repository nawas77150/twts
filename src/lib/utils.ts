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
 * Uses Object.hasOwn() to prevent accessing inherited properties
 * (__proto__, constructor, etc.), which satisfies SAST tools that
 * flag dynamic bracket access as "Generic Object Injection Sink".
 *
 * TypeScript enforces K extends keyof T, so the access is already
 * compile-time safe — Object.hasOwn is a runtime guard for SAST.
 */
export function safeAccess<T extends object, K extends keyof T>(obj: T, key: K): T[K] {
  if (Object.hasOwn(obj, key)) return obj[key]
  throw new Error(`Invalid key: ${String(key)}`)
}
