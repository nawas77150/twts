// Vitest global setup — runs before any test file.
// Set ENCRYPTION_KEY so that encrypt.ts loads with encryption enabled,
// ensuring _encryptionKeyAvailable is true for the encrypt.test.ts suite.
process.env.ENCRYPTION_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
