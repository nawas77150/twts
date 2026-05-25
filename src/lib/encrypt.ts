import crypto from "crypto";

// Server-only guard — this module must never be bundled into the client.
// If a future import chain accidentally pulls this into a 'use client' component,
// this will throw immediately instead of silently bundling crypto-browserify.
if (typeof window !== 'undefined') {
  throw new Error(
    'encrypt.ts must only be imported on the server. ' +
    'A client component is importing it via a transitive dependency — check your import chain.'
  )
}

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/** Prefix added to values stored without encryption (ENCRYPTION_KEY not set).
 *  Enables safe migration: decrypt()/decryptSetting() strip this prefix,
 *  so tagged values are handled correctly even after ENCRYPTION_KEY is later added. */
const PLAINTEXT_PREFIX = '{PLAINTEXT}'

// Track whether encryption key is available (set once at module load)
const _encryptionKeyAvailable = !!process.env.ENCRYPTION_KEY;

// Warn once at startup if ENCRYPTION_KEY is not configured
if (!_encryptionKeyAvailable) {
  // eslint-disable-next-line no-console
  console.error(
    '[ENCRYPTION] ⚠️  ENCRYPTION_KEY is not set. Sensitive data (API keys, cookies, passwords) will be stored with a {PLAINTEXT} tag (not encrypted, but distinguishable from encrypted values). ' +
    'Generate a key with: openssl rand -hex 32  —  Then set ENCRYPTION_KEY in your environment variables.'
  );
}

// Throttled warning: log at most once per 60 seconds when encrypt() is called without a key
let _lastEncryptWarnTime = 0;

/**
 * Returns true if ENCRYPTION_KEY is configured and encryption is active.
 * Useful for admin UI to show a warning banner when encryption is disabled.
 */
export function isEncryptionEnabled(): boolean {
  return _encryptionKeyAvailable;
}

function getKey(): Buffer | null {
  const hexKey = process.env.ENCRYPTION_KEY;
  if (!hexKey) return null;
  const key = Buffer.from(hexKey, "hex");
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be 64 hex characters (32 bytes for AES-256), got ${hexKey.length} hex chars (${key.length} bytes). Generate one with: openssl rand -hex 32`
    );
  }
  return key;
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Returns "iv:authTag:ciphertext" (all base64 encoded).
 * If ENCRYPTION_KEY is not set, returns the value with a {PLAINTEXT} prefix tag,
 * which decrypt()/decryptSetting() will strip when reading.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  if (!key) {
    // Throttled warning — don't spam logs on every call
    const now = Date.now();
    if (now - _lastEncryptWarnTime > 60_000) {
      _lastEncryptWarnTime = now;
      // eslint-disable-next-line no-console
      console.warn(
        `[ENCRYPTION] encrypt() called without ENCRYPTION_KEY — value stored as {PLAINTEXT}-tagged string (not encrypted). ` +
        `Set ENCRYPTION_KEY to enable encryption. (This warning is throttled to once per minute)`
      );
    }
    return `${PLAINTEXT_PREFIX}${plaintext}`;
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * Decrypts a value produced by `encrypt`.
 * Handles {PLAINTEXT}-tagged values (stored when ENCRYPTION_KEY was not set)
 * by stripping the prefix and returning the raw value.
 * If ENCRYPTION_KEY is not set and the value is not tagged, returns input as-is.
 * Throws a descriptive error if decryption fails (wrong key, tampered data).
 */
export function decrypt(encrypted: string): string {
  // Handle {PLAINTEXT}-tagged values — strip the prefix regardless of key availability.
  // These were stored when ENCRYPTION_KEY was not configured.
  if (encrypted.startsWith(PLAINTEXT_PREFIX)) {
    return encrypted.slice(PLAINTEXT_PREFIX.length)
  }
  const key = getKey();
  if (!key) return encrypted;

  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new Error(
      "Decryption failed: invalid encrypted format. Expected 'iv:authTag:ciphertext' with 3 colon-separated segments."
    );
  }

  const [ivB64, authTagB64, ciphertextB64] = parts;

  let iv: Buffer;
  let authTag: Buffer;
  let ciphertext: Buffer;

  try {
    iv = Buffer.from(ivB64, "base64");
    authTag = Buffer.from(authTagB64, "base64");
    ciphertext = Buffer.from(ciphertextB64, "base64");
  } catch {
    throw new Error(
      "Decryption failed: one or more segments are not valid base64."
    );
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch (err) {
    throw new Error(
      `Decryption failed: unable to decrypt. The data may have been tampered with or the encryption key is wrong. ${err instanceof Error ? err.message : ""}`
    );
  }
}

const BASE64_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Returns true if the value matches the "iv:authTag:ciphertext" pattern
 * (3 colon-separated segments, each valid base64).
 * Includes a minimum length check: valid AES-256-GCM ciphertext is
 * "iv(16 b64):authTag(24 b64):ciphertext(≥4 b64)" → minimum ~46 chars.
 * Any value shorter than 40 chars cannot possibly be valid ciphertext,
 * so we early-return false to avoid false positives on strings that
 * happen to contain 3 colon-separated base64-like segments.
 */
export function isEncrypted(value: string): boolean {
  if (value.length < 40) return false;
  const parts = value.split(":");
  if (parts.length !== 3) return false;
  return parts.every((segment) => segment.length > 0 && BASE64_REGEX.test(segment));
}

/**
 * Decrypt a setting value if encrypted, return as-is if plaintext.
 * Handles {PLAINTEXT}-tagged values (stored when ENCRYPTION_KEY was not set)
 * by stripping the prefix and returning the raw value.
 * Handles migration from unencrypted to encrypted values.
 * On decryption failure, returns the fallback (defaults to raw value).
 */
export function decryptSetting(value: string, fallback?: string): string {
  if (!value) return fallback ?? value
  // Handle {PLAINTEXT}-tagged values — strip prefix, no decryption needed.
  if (value.startsWith(PLAINTEXT_PREFIX)) {
    return value.slice(PLAINTEXT_PREFIX.length)
  }
  try {
    return isEncrypted(value) ? decrypt(value) : value
  } catch {
    return fallback ?? value
  }
}
