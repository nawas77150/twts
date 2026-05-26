import { describe, it, expect } from 'vitest'
import { checkBlockedWords } from '@/lib/content-filter-blocked'

describe('checkBlockedWords', () => {
  it('matches a single blocked word', () => {
    const result = checkBlockedWords('anjing bodoh', ['anjing'])
    expect(result.matched).toEqual(['anjing'])
    expect(result.reasons).toEqual(['blocked_word:anjing'])
  })

  it('returns empty for clean message', () => {
    const result = checkBlockedWords('halo apa kabar', ['anjing'])
    expect(result.matched).toEqual([])
    expect(result.reasons).toEqual([])
  })

  it('matches multi-word blocked term', () => {
    const result = checkBlockedWords('mau bunuh diri', ['bunuh diri'])
    expect(result.matched).toEqual(['bunuh diri'])
    expect(result.reasons).toEqual(['blocked_word:bunuh diri'])
  })

  it('catches punctuation-insertion bypass (consecutive token pair)', () => {
    // "kon.tol" splits into ["kon", "tol"], pair "kontol" matches
    const result = checkBlockedWords('kon.tol', ['kontol'])
    expect(result.matched).toEqual(['kontol'])
  })

  it('is case insensitive', () => {
    const result = checkBlockedWords('ANJING bodoh', ['anjing'])
    expect(result.matched).toEqual(['anjing'])
  })

  it('uses custom reason prefix', () => {
    const result = checkBlockedWords('anjing', ['anjing'], 'nsfw_word')
    expect(result.reasons).toEqual(['nsfw_word:anjing'])
  })

  it('returns empty for empty blocked words list', () => {
    const result = checkBlockedWords('anjing', [])
    expect(result.matched).toEqual([])
    expect(result.reasons).toEqual([])
  })

  it('skips empty/whitespace blocked words', () => {
    const result = checkBlockedWords('anjing', ['', '  ', 'anjing'])
    expect(result.matched).toEqual(['anjing'])
    expect(result.reasons).toEqual(['blocked_word:anjing'])
  })

  it('returns empty for empty message', () => {
    const result = checkBlockedWords('', ['anjing'])
    expect(result.matched).toEqual([])
    expect(result.reasons).toEqual([])
  })

  it('does not duplicate matches when word appears twice', () => {
    const result = checkBlockedWords('anjing anjing', ['anjing'])
    expect(result.matched).toEqual(['anjing'])
    expect(result.reasons).toEqual(['blocked_word:anjing'])
  })

  it('matches multiple different blocked words', () => {
    const result = checkBlockedWords('anjing babi', ['anjing', 'babi'])
    expect(result.matched).toEqual(['anjing', 'babi'])
    expect(result.reasons).toEqual(['blocked_word:anjing', 'blocked_word:babi'])
  })
})
