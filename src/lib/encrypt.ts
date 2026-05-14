import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

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
 * If ENCRYPTION_KEY is not set, returns plaintext as-is.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext;

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
 * If ENCRYPTION_KEY is not set, returns input as-is.
 * Throws a descriptive error if decryption fails (wrong key, tampered data).
 */
export function decrypt(encrypted: string): string {
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
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(":");
  if (parts.length !== 3) return false;
  return parts.every((segment) => segment.length > 0 && BASE64_REGEX.test(segment));
}
