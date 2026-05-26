import { describe, it, expect } from 'vitest'
import { sanitizeInput, decodeHtmlEntities, normalizeText, normalizeForFilter } from '@/lib/content-filter-normalize'

describe('sanitizeInput', () => {
  it('strips HTML script tags', () => {
    // The regex /<[^>]*>/g strips tags but leaves inner content between them
    expect(sanitizeInput('<script>alert(1)</script>hello')).toBe('alert(1)hello')
  })

  it('strips img onerror tags', () => {
    expect(sanitizeInput('<img src=x onerror=alert(1)>hello')).toBe('hello')
  })

  it('strips null bytes', () => {
    expect(sanitizeInput('hello\0world')).toBe('helloworld')
  })

  it('preserves plain text', () => {
    expect(sanitizeInput('hello world')).toBe('hello world')
  })
})

describe('decodeHtmlEntities', () => {
  it('decodes &amp;', () => {
    expect(decodeHtmlEntities('a &amp; b')).toBe('a & b')
  })

  it('decodes &lt; and &gt;', () => {
    expect(decodeHtmlEntities('&lt;div&gt;')).toBe('<div>')
  })

  it('decodes &quot;', () => {
    expect(decodeHtmlEntities('say &quot;hi&quot;')).toBe('say "hi"')
  })

  it('decodes &#x27; and &#39;', () => {
    expect(decodeHtmlEntities('it&#x27;s &amp; it&#39;s')).toBe("it's & it's")
  })

  it('returns unchanged text when no entities present', () => {
    expect(decodeHtmlEntities('plain text')).toBe('plain text')
  })
})

describe('normalizeText', () => {
  it('replaces Cyrillic homoglyphs with Latin', () => {
    // Cyrillic а (U+0430) → Latin a
    const input = '\u0430njing'
    expect(normalizeText(input)).toContain('anjing')
  })

  it('preserves non-homoglyph non-ASCII characters (e.g. Chinese)', () => {
    // Chinese chars are not in HOMOGLYPH_MAP — they pass through as-is (then stripped by step 7)
    // But the branch "safeGet returns undefined → keep original char" must be hit
    const input = 'hello \u4E16\u754C' // 世界
    const result = normalizeText(input)
    // After step 5 (homoglyph), Chinese chars survive; step 7 strips non-word
    // So they become spaces. Just verify no crash and result contains 'hello'
    expect(result).toContain('hello')
  })

  it('strips zero-width characters', () => {
    const input = 'hello\u200Bworld' // zero-width space
    expect(normalizeText(input)).not.toContain('\u200B')
  })

  it('converts fullwidth characters via NFKC', () => {
    // Fullwidth Ａ → A → a (after lowercase)
    const input = '\uFF21NJING'
    expect(normalizeText(input)).toContain('anjing')
  })

  it('lowercases text', () => {
    expect(normalizeText('HELLO')).toContain('hello')
  })

  it('strips combining marks (diacritics)', () => {
    // e + combining acute accent → e
    const input = 'e\u0301'
    expect(normalizeText(input)).toContain('e')
  })

  it('strips non-word characters', () => {
    const result = normalizeText('hello! world?')
    expect(result).not.toContain('!')
    expect(result).not.toContain('?')
  })

  it('handles empty string', () => {
    expect(normalizeText('')).toBe('')
  })

  it('preserves @ sign for mentions', () => {
    expect(normalizeText('@user')).toContain('@user')
  })

  it('collapses multiple spaces', () => {
    expect(normalizeText('hello    world')).toBe('hello world')
  })

  it('strips variation selectors (U+FE00-FE0F)', () => {
    const input = 'a\uFE00b' // variation selector after 'a'
    const result = normalizeText(input)
    expect(result).toContain('a')
    expect(result).not.toContain('\uFE00')
  })
})

describe('normalizeForFilter', () => {
  it('preserves case (unlike normalizeText)', () => {
    const result = normalizeForFilter('HELLO')
    expect(result).toBe('HELLO')
  })

  it('strips zero-width characters', () => {
    const input = 'hello\u200Bworld'
    expect(normalizeForFilter(input)).not.toContain('\u200B')
  })

  it('converts fullwidth characters via NFKC', () => {
    const input = '\uFF21test' // Ａtest → Atest
    expect(normalizeForFilter(input)).toContain('Atest')
  })

  it('strips combining marks', () => {
    const input = 'e\u0301' // e + combining acute
    expect(normalizeForFilter(input)).toBe('e')
  })

  it('preserves structure for regex matching', () => {
    // Should keep punctuation, URLs etc. intact for regex checks
    expect(normalizeForFilter('https://example.com')).toContain('https://example.com')
  })

  it('handles plain text', () => {
    expect(normalizeForFilter('hello world')).toBe('hello world')
  })
})
