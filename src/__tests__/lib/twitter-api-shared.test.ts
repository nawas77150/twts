import { describe, it, expect } from 'vitest'
import {
  parseApiKeys,
  extractApiError,
  extractTweetId,
  maskApiKey,
  maskProxyUrl,
  cookieStringToLoginCookies,
} from '@/lib/twitter-api-shared'

describe('parseApiKeys', () => {
  it('parses valid JSON array of strings', () => {
    expect(parseApiKeys('["key1","key2"]')).toEqual(['key1', 'key2'])
  })

  it('filters out empty strings', () => {
    expect(parseApiKeys('["key1","","key2"]')).toEqual(['key1', 'key2'])
  })

  it('filters out non-string values', () => {
    expect(parseApiKeys('["key1",123,true]')).toEqual(['key1'])
  })

  it('returns empty array for invalid JSON', () => {
    expect(parseApiKeys('not json')).toEqual([])
  })

  it('returns empty array for undefined input', () => {
    expect(parseApiKeys(undefined)).toEqual([])
  })

  it('returns empty array for non-array JSON', () => {
    expect(parseApiKeys('"hello"')).toEqual([])
  })

  it('filters whitespace-only keys', () => {
    expect(parseApiKeys('[" ","key2"]')).toEqual(['key2'])
  })
})

describe('extractApiError', () => {
  it('extracts message field', () => {
    expect(extractApiError({ message: 'error msg' })).toBe('error msg')
  })

  it('extracts msg field', () => {
    expect(extractApiError({ msg: 'error msg' })).toBe('error msg')
  })

  it('extracts detail field', () => {
    expect(extractApiError({ detail: 'error detail' })).toBe('error detail')
  })

  it('extracts error field', () => {
    expect(extractApiError({ error: 'error occurred' })).toBe('error occurred')
  })

  it('falls back to JSON.stringify for unknown object', () => {
    expect(extractApiError({ foo: 'bar' })).toContain('foo')
  })

  it('handles non-object input', () => {
    expect(extractApiError('string error')).toBe('string error')
  })

  it('prioritizes message over msg over detail over error', () => {
    expect(extractApiError({ message: 'm', msg: 'mg', detail: 'd', error: 'e' })).toBe('m')
  })
})

describe('extractTweetId', () => {
  it('extracts from data.tweet_id', () => {
    expect(extractTweetId({ tweet_id: '123' })).toBe('123')
  })

  it('extracts from data.id', () => {
    expect(extractTweetId({ id: '456' })).toBe('456')
  })

  it('extracts from nested data.data.tweet_id', () => {
    expect(extractTweetId({ data: { tweet_id: '789' } })).toBe('789')
  })

  it('extracts from nested data.data.id', () => {
    expect(extractTweetId({ data: { id: '012' } })).toBe('012')
  })

  it('returns null for no tweet ID', () => {
    expect(extractTweetId({ foo: 'bar' })).toBeNull()
  })

  it('returns null for null/undefined input', () => {
    expect(extractTweetId(null)).toBeNull()
    expect(extractTweetId(undefined)).toBeNull()
  })

  it('converts numeric IDs to string', () => {
    expect(extractTweetId({ tweet_id: 123 })).toBe('123')
  })
})

describe('maskApiKey', () => {
  it('shows first 8 chars + ...', () => {
    expect(maskApiKey('abcdefgh12345678')).toBe('abcdefgh...')
  })

  it('handles short keys', () => {
    expect(maskApiKey('abc')).toBe('abc...')
  })
})

describe('maskProxyUrl', () => {
  it('masks password in proxy URL', () => {
    expect(maskProxyUrl('http://user:secretpass@proxy.example.com:8080'))
      .toBe('http://user:****@proxy.example.com:8080')
  })

  it('returns unchanged URL without credentials', () => {
    expect(maskProxyUrl('http://proxy.example.com:8080'))
      .toBe('http://proxy.example.com:8080')
  })
})

describe('cookieStringToLoginCookies', () => {
  it('converts cookie string to base64 JSON', () => {
    const result = cookieStringToLoginCookies('auth_token=abc; ct0=xyz; twid=u=123')
    expect(result).not.toBeNull()
    // Decode the base64 and verify
    const decoded = JSON.parse(Buffer.from(result as string, 'base64').toString())
    expect(decoded.auth_token).toBe('abc')
    expect(decoded.ct0).toBe('xyz')
    expect(decoded.twid).toBe('u=123')
  })

  it('returns null for empty string', () => {
    expect(cookieStringToLoginCookies('')).toBeNull()
  })

  it('returns null for whitespace', () => {
    expect(cookieStringToLoginCookies('   ')).toBeNull()
  })

  it('returns null when auth_token is missing', () => {
    expect(cookieStringToLoginCookies('ct0=xyz; twid=u=123')).toBeNull()
  })

  it('handles value containing equals sign', () => {
    const result = cookieStringToLoginCookies('auth_token=abc; twid=u=123')
    expect(result).not.toBeNull()
    const decoded = JSON.parse(Buffer.from(result as string, 'base64').toString())
    expect(decoded.twid).toBe('u=123')
  })
})
