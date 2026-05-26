import { describe, it, expect } from 'vitest'
import {
  checkJualan,
  checkUrls,
  checkMentions,
  checkCapsSpam,
  checkRepeatedChars,
  checkTooShort,
  checkCsam,
  checkSolicitation,
  checkPii,
  checkDuplicate24h,
} from '@/lib/content-filter-checks'

describe('checkJualan', () => {
  it('detects WTS tag', () => {
    const result = checkJualan('WTS jacket murah')
    expect(result).toEqual(expect.arrayContaining([expect.stringContaining('jualan:WTS')]))
  })

  it('detects WTB tag', () => {
    const result = checkJualan('WTB sepatu')
    expect(result).toEqual(expect.arrayContaining([expect.stringContaining('jualan:WTB')]))
  })

  it('detects WTT tag', () => {
    const result = checkJualan('WTT hp ke laptop')
    expect(result).toEqual(expect.arrayContaining([expect.stringContaining('jualan:WTT')]))
  })

  it('detects LF tag', () => {
    const result = checkJualan('LF rekomendasi')
    expect(result).toEqual(expect.arrayContaining([expect.stringContaining('jualan:LF')]))
  })

  it('does not flag normal message', () => {
    expect(checkJualan('halo apa kabar')).toEqual([])
  })

  it('does not flag "self" as LF', () => {
    expect(checkJualan('self care')).toEqual([])
  })
})

describe('checkUrls', () => {
  it('detects https URL', () => {
    expect(checkUrls('visit https://example.com')).toContain('contains_url')
  })

  it('detects bit.ly shortlink', () => {
    expect(checkUrls('check bit.ly/abc123')).toContain('contains_url')
  })

  it('does not flag normal text', () => {
    expect(checkUrls('no links here')).toEqual([])
  })
})

describe('checkMentions', () => {
  it('detects @username', () => {
    const result = checkMentions('hey @john')
    expect(result).toEqual([expect.stringContaining('contains_mention:')])
  })

  it('counts multiple mentions', () => {
    const result = checkMentions('hey @john @jane')
    expect(result[0]).toContain('contains_mention:2')
  })

  it('does not flag email addresses', () => {
    expect(checkMentions('email me at user@example.com')).toEqual([])
  })

  it('does not flag normal text', () => {
    expect(checkMentions('no mentions')).toEqual([])
  })
})

describe('checkCapsSpam', () => {
  it('flags ALL CAPS spam (>80% uppercase, >10 alpha chars)', () => {
    expect(checkCapsSpam('THIS IS ALL CAPS SPAM MESSAGE')).toContain('caps_spam')
  })

  it('does not flag normal casing', () => {
    expect(checkCapsSpam('Hello World')).toEqual([])
  })

  it('does not flag short messages (<=10 alpha chars)', () => {
    expect(checkCapsSpam('HI THERE')).toEqual([])
  })
})

describe('checkRepeatedChars', () => {
  it('flags 6+ consecutive identical characters', () => {
    expect(checkRepeatedChars('hiiiiiiiii')).toContain('repeated_characters')
  })

  it('does not flag normal text', () => {
    expect(checkRepeatedChars('normal text')).toEqual([])
  })

  it('flags exactly at 6 consecutive', () => {
    expect(checkRepeatedChars('waaaaaa')).toContain('repeated_characters')
  })
})

describe('checkTooShort', () => {
  it('flags messages shorter than 5 chars', () => {
    expect(checkTooShort('ab')).toContain('too_short')
  })

  it('does not flag 5+ char messages', () => {
    expect(checkTooShort('hello')).toEqual([])
  })

  it('does not flag empty messages', () => {
    expect(checkTooShort('')).toEqual([])
  })

  it('trims whitespace before checking', () => {
    expect(checkTooShort('  ab  ')).toContain('too_short')
  })
})

describe('checkCsam', () => {
  const sexualTerms = ['bokep', 'colmek']
  const ageTerms = ['anak smp', 'underage']

  it('flags when both sexual and age terms present', () => {
    const result = checkCsam('bokep anak smp', sexualTerms, ageTerms)
    expect(result.length).toBeGreaterThan(0)
  })

  it('does not flag sexual terms alone', () => {
    const result = checkCsam('bokep terbaru', sexualTerms, ageTerms)
    expect(result).toEqual([])
  })

  it('does not flag age terms alone', () => {
    const result = checkCsam('anak smp belajar', sexualTerms, ageTerms)
    expect(result).toEqual([])
  })
})

describe('checkSolicitation', () => {
  const sexualTerms = ['open bo', 'escort']
  const paymentTerms = ['berbayar', 'tarif']

  it('flags when both sexual and payment terms present', () => {
    const result = checkSolicitation('open bo berbayar', sexualTerms, paymentTerms)
    expect(result.length).toBeGreaterThan(0)
  })

  it('does not flag sexual terms alone', () => {
    const result = checkSolicitation('open bo gratis', sexualTerms, paymentTerms)
    expect(result).toEqual([])
  })

  it('does not flag payment terms alone', () => {
    const result = checkSolicitation('jasa desain berbayar', sexualTerms, paymentTerms)
    expect(result).toEqual([])
  })
})

describe('checkPii', () => {
  it('detects email addresses', () => {
    expect(checkPii('email me at user@example.com')).toContain('contains_email')
  })

  it('detects Indonesian NIK (16+ consecutive digits)', () => {
    expect(checkPii('NIK: 1234567890123456')).toContain('contains_nik')
  })

  it('detects IPv4 addresses', () => {
    expect(checkPii('server at 192.168.1.1')).toContain('contains_ip_address')
  })

  it('detects Indonesian phone numbers (08xx)', () => {
    expect(checkPii('hubungi 081234567890')).toContain('contains_phone')
  })

  it('detects NPWP format', () => {
    expect(checkPii('NPWP: 12.345.678.9-012.345')).toContain('contains_npwp')
  })

  it('does not flag clean text', () => {
    expect(checkPii('pesan biasa tanpa PII')).toEqual([])
  })
})

describe('checkDuplicate24h', () => {
  it('returns isDuplicate=true when DB finds existing submission', async () => {
    const mockDb = {
      submission: {
        findFirst: async () => ({ id: 'existing-id' }),
      },
    }
    const result = await checkDuplicate24h('test message', mockDb, 'user1')
    expect(result.isDuplicate).toBe(true)
    expect(result.reason).toBe('duplicate_24h')
  })

  it('returns isDuplicate=false when no existing submission found', async () => {
    const mockDb = {
      submission: {
        findFirst: async () => null,
      },
    }
    const result = await checkDuplicate24h('test message', mockDb, 'user1')
    expect(result.isDuplicate).toBe(false)
    expect(result.reason).toBeUndefined()
  })

  it('returns isDuplicate=false for empty normalized message', async () => {
    const mockDb = {
      submission: {
        findFirst: async () => null,
      },
    }
    // Message with only special chars normalizes to empty string
    const result = await checkDuplicate24h('!!!', mockDb, 'user1')
    expect(result.isDuplicate).toBe(false)
  })
})
