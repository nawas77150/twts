import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type {
  encrypt as EncryptFn,
  decrypt as DecryptFn,
  isEncrypted as IsEncryptedFn,
  decryptSetting as DecryptSettingFn,
  isEncryptionEnabled as IsEncryptionEnabledFn,
} from '@/lib/encrypt'

// ---------------------------------------------------------------------------
// ENCRYPTION_KEY is set in vitest.setup.ts before any module loads,
// so encrypt.ts initializes with _encryptionKeyAvailable = true.
// For "no key" scenarios, we use vi.resetModules() + dynamic import
// (works with `vitest run` which supports proper module isolation).
// ---------------------------------------------------------------------------

const KEY_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const KEY_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

let encrypt: typeof EncryptFn
let decrypt: typeof DecryptFn
let isEncrypted: typeof IsEncryptedFn
let decryptSetting: typeof DecryptSettingFn
let isEncryptionEnabled: typeof IsEncryptionEnabledFn

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = KEY_A
  const mod = await import('@/lib/encrypt')
  encrypt = mod.encrypt
  decrypt = mod.decrypt
  isEncrypted = mod.isEncrypted
  decryptSetting = mod.decryptSetting
  isEncryptionEnabled = mod.isEncryptionEnabled
})

afterAll(() => {
  delete process.env.ENCRYPTION_KEY
})

// ---------------------------------------------------------------------------
// encrypt / decrypt roundtrip
// ---------------------------------------------------------------------------
describe('encrypt + decrypt roundtrip', () => {
  it('encrypts and then decrypts to the original value', () => {
    const plaintext = 'hello world'
    const encrypted = encrypt(plaintext)
    expect(encrypted).not.toBe(plaintext)
    expect(decrypt(encrypted)).toBe(plaintext)
  })

  it('produces the "iv:authTag:ciphertext" format', () => {
    const encrypted = encrypt('test')
    const parts = encrypted.split(':')
    expect(parts).toHaveLength(3)
    for (const part of parts) {
      expect(part.length).toBeGreaterThan(0)
      expect(Buffer.from(part, 'base64').toString('base64')).toBe(part)
    }
  })
})

// ---------------------------------------------------------------------------
// encrypt without key
// ---------------------------------------------------------------------------
describe('encrypt without ENCRYPTION_KEY', () => {
  it('returns {PLAINTEXT} prefix when key is not set', async () => {
    const { vi } = await import('vitest')
    const origKey = process.env.ENCRYPTION_KEY
    delete process.env.ENCRYPTION_KEY
    vi.resetModules()

    const mod = await import('@/lib/encrypt')
    expect(mod.encrypt('my-secret')).toBe('{PLAINTEXT}my-secret')
    expect(mod.isEncryptionEnabled()).toBe(false)

    // Restore
    process.env.ENCRYPTION_KEY = origKey
    vi.resetModules()
    const restored = await import('@/lib/encrypt')
    encrypt = restored.encrypt
    decrypt = restored.decrypt
    isEncrypted = restored.isEncrypted
    decryptSetting = restored.decryptSetting
    isEncryptionEnabled = restored.isEncryptionEnabled
  })
})

// ---------------------------------------------------------------------------
// decrypt
// ---------------------------------------------------------------------------
describe('decrypt', () => {
  it('strips {PLAINTEXT} prefix and returns value', () => {
    expect(decrypt('{PLAINTEXT}hello')).toBe('hello')
  })

  it('returns value as-is when no key and no prefix', async () => {
    const { vi } = await import('vitest')
    const origKey = process.env.ENCRYPTION_KEY
    delete process.env.ENCRYPTION_KEY
    vi.resetModules()

    const mod = await import('@/lib/encrypt')
    expect(mod.decrypt('raw-value')).toBe('raw-value')

    // Restore
    process.env.ENCRYPTION_KEY = origKey
    vi.resetModules()
    const restored = await import('@/lib/encrypt')
    encrypt = restored.encrypt
    decrypt = restored.decrypt
    isEncrypted = restored.isEncrypted
    decryptSetting = restored.decryptSetting
    isEncryptionEnabled = restored.isEncryptionEnabled
  })

  it('throws with descriptive error for invalid format', () => {
    expect(() => decrypt('not:enough')).toThrow(/invalid encrypted format/i)
    expect(() => decrypt('a:b:c:d')).toThrow(/invalid encrypted format/i)
  })

  it('throws when ENCRYPTION_KEY has wrong length', async () => {
    const { vi } = await import('vitest')
    const origKey = process.env.ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY = 'tooshort'
    vi.resetModules()

    const mod = await import('@/lib/encrypt')
    expect(() => mod.encrypt('test')).toThrow(/ENCRYPTION_KEY must be 64 hex characters/)

    // Restore
    process.env.ENCRYPTION_KEY = origKey
    vi.resetModules()
    const restored = await import('@/lib/encrypt')
    encrypt = restored.encrypt
    decrypt = restored.decrypt
    isEncrypted = restored.isEncrypted
    decryptSetting = restored.decryptSetting
    isEncryptionEnabled = restored.isEncryptionEnabled
  })

  it('throws for invalid segments in decrypt', () => {
    expect(() => decrypt('not:enough')).toThrow()
  })

  it('throws when decrypting with the wrong key', async () => {
    // Encrypt with KEY_A
    const encrypted = encrypt('secret-data')

    // Switch to KEY_B and re-import
    const { vi } = await import('vitest')
    const origKey = process.env.ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY = KEY_B
    vi.resetModules()
    const mod = await import('@/lib/encrypt')

    expect(() => mod.decrypt(encrypted)).toThrow(/unable to decrypt/)

    // Restore KEY_A
    process.env.ENCRYPTION_KEY = origKey
    vi.resetModules()
    const restored = await import('@/lib/encrypt')
    encrypt = restored.encrypt
    decrypt = restored.decrypt
    isEncrypted = restored.isEncrypted
    decryptSetting = restored.decryptSetting
    isEncryptionEnabled = restored.isEncryptionEnabled
  })

  it('throws when data is tampered (auth tag mismatch)', () => {
    const encrypted = encrypt('tamper-test')
    const parts = encrypted.split(':')
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const ciphertext = Buffer.from(parts[2]!, 'base64')
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    ciphertext[0]! ^= 0xff
    const tampered = `${parts[0]}:${parts[1]}:${ciphertext.toString('base64')}`
    expect(() => decrypt(tampered)).toThrow(/unable to decrypt/)
  })
})

// ---------------------------------------------------------------------------
// isEncrypted
// ---------------------------------------------------------------------------
describe('isEncrypted', () => {
  it('returns true for a valid encrypted value', () => {
    const encrypted = encrypt('check-me')
    expect(isEncrypted(encrypted)).toBe(true)
  })

  it('returns false for strings shorter than 40 chars', () => {
    expect(isEncrypted('a:b:c')).toBe(false)
    expect(isEncrypted('')).toBe(false)
    expect(isEncrypted('short')).toBe(false)
  })

  it('returns false for non-base64 segments', () => {
    expect(isEncrypted('!!!invalid!!!:!!!invalid!!!:!!!invalid!!!')).toBe(false)
  })

  it('returns false for wrong segment count', () => {
    expect(isEncrypted('aGVsbG8gd29ybGQ=:aGVsbG8gd29ybGQ=')).toBe(false)
    expect(isEncrypted('a:b:c:d')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// decryptSetting
// ---------------------------------------------------------------------------
describe('decryptSetting', () => {
  it('decrypts an encrypted value', () => {
    const encrypted = encrypt('setting-value')
    expect(decryptSetting(encrypted)).toBe('setting-value')
  })

  it('strips {PLAINTEXT} prefix', () => {
    expect(decryptSetting('{PLAINTEXT}my-setting')).toBe('my-setting')
  })

  it('returns plaintext value as-is', () => {
    expect(decryptSetting('just-a-plain-string')).toBe('just-a-plain-string')
  })

  it('returns empty string as-is when no fallback', () => {
    expect(decryptSetting('')).toBe('')
  })

  it('returns fallback on decryption failure', () => {
    const fake = Buffer.from('fake-iv-12-bytes').toString('base64') + ':' +
                 Buffer.from('fake-tag-16-byte').toString('base64') + ':' +
                 Buffer.from('fake-cipher-data').toString('base64')
    expect(decryptSetting(fake, 'fallback')).toBe('fallback')
  })

  it('returns raw value on decryption failure when no fallback given', () => {
    const fake = Buffer.from('fake-iv-12-bytes').toString('base64') + ':' +
                 Buffer.from('fake-tag-16-byte').toString('base64') + ':' +
                 Buffer.from('fake-cipher-data').toString('base64')
    expect(decryptSetting(fake)).toBe(fake)
  })
})

// ---------------------------------------------------------------------------
// isEncryptionEnabled
// ---------------------------------------------------------------------------
describe('isEncryptionEnabled', () => {
  it('returns true when ENCRYPTION_KEY is set', () => {
    // KEY_A is set in beforeAll and the module loaded with it
    expect(isEncryptionEnabled()).toBe(true)
  })

  it('returns false when ENCRYPTION_KEY is not set', async () => {
    const { vi } = await import('vitest')
    delete process.env.ENCRYPTION_KEY
    vi.resetModules()
    const mod = await import('@/lib/encrypt')
    expect(mod.isEncryptionEnabled()).toBe(false)

    // Restore
    process.env.ENCRYPTION_KEY = KEY_A
    vi.resetModules()
    const restored = await import('@/lib/encrypt')
    encrypt = restored.encrypt
    decrypt = restored.decrypt
    isEncrypted = restored.isEncrypted
    decryptSetting = restored.decryptSetting
    isEncryptionEnabled = restored.isEncryptionEnabled
  })
})
