import { describe, it, expect } from 'vitest'
import { cn, getErrorMessage, safeAccess, safeGet } from '@/lib/utils'

// ---------------------------------------------------------------------------
// cn
// ---------------------------------------------------------------------------
describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles conditional classes via clsx', () => {
    const flags = { show: false }
    expect(cn('foo', flags.show && 'bar', 'baz')).toBe('foo baz')
  })

  it('deduplicates conflicting tailwind classes via twMerge', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('returns an empty string for no inputs', () => {
    expect(cn()).toBe('')
  })
})

// ---------------------------------------------------------------------------
// getErrorMessage
// ---------------------------------------------------------------------------
describe('getErrorMessage', () => {
  it('returns the message of an Error instance', () => {
    expect(getErrorMessage(new Error('something broke'))).toBe('something broke')
  })

  it('returns default fallback for non-Error values', () => {
    expect(getErrorMessage('not an error')).toBe('Unknown error')
    expect(getErrorMessage(42)).toBe('Unknown error')
    expect(getErrorMessage(null)).toBe('Unknown error')
    expect(getErrorMessage(undefined)).toBe('Unknown error')
  })

  it('returns a custom fallback when provided', () => {
    expect(getErrorMessage('oops', 'custom fallback')).toBe('custom fallback')
    expect(getErrorMessage(null, 'nope')).toBe('nope')
  })
})

// ---------------------------------------------------------------------------
// safeAccess
// ---------------------------------------------------------------------------
describe('safeAccess', () => {
  it('returns value for a valid own key', () => {
    const obj = { name: 'Alice', age: 30 }
    expect(safeAccess(obj, 'name')).toBe('Alice')
    expect(safeAccess(obj, 'age')).toBe(30)
  })

  it('throws for an invalid key', () => {
    const obj = { a: 1 }
    expect(() => safeAccess(obj, 'b' as keyof typeof obj)).toThrow('Invalid key: b')
  })

  it('throws for __proto__', () => {
    const obj = { x: 1 }
    // @ts-expect-error — intentionally accessing a prototype key
    expect(() => safeAccess(obj, '__proto__')).toThrow('Invalid key: __proto__')
  })

  it('works with various object types', () => {
    // Object with numeric string keys
    const numObj: Record<'0' | '1', string> = { '0': 'zero', '1': 'one' }
    expect(safeAccess(numObj, '0')).toBe('zero')
    expect(safeAccess(numObj, '1')).toBe('one')

    // Object with symbol-free plain shape
    const obj: { id: number; active: boolean } = { id: 42, active: true }
    expect(safeAccess(obj, 'id')).toBe(42)
    expect(safeAccess(obj, 'active')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// safeGet
// ---------------------------------------------------------------------------
describe('safeGet', () => {
  it('returns value for an own property', () => {
    const obj: Record<string, number> = { a: 1, b: 2 }
    expect(safeGet(obj, 'a')).toBe(1)
    expect(safeGet(obj, 'b')).toBe(2)
  })

  it('returns undefined for a missing key', () => {
    const obj: Record<string, number> = { a: 1 }
    expect(safeGet(obj, 'z')).toBeUndefined()
  })

  it('returns undefined for prototype properties (__proto__, constructor)', () => {
    const obj: Record<string, string> = { name: 'test' }
    expect(safeGet(obj, '__proto__')).toBeUndefined()
    expect(safeGet(obj, 'constructor')).toBeUndefined()
    expect(safeGet(obj, 'hasOwnProperty')).toBeUndefined()
  })

  it('handles empty objects', () => {
    const obj: Record<string, unknown> = {}
    expect(safeGet(obj, 'any')).toBeUndefined()
  })
})
