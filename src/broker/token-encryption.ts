import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Derives the 32-byte AES key from the BROKER_ENCRYPTION_KEY env var.
 * Throws immediately if the key is missing or not exactly 64 hex characters.
 */
function getKey(): Buffer {
  const hex = process.env.BROKER_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'BROKER_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)',
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns base64(iv + authTag + ciphertext).
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypts a base64-encoded payload produced by encrypt().
 * Expects format: base64(iv + authTag + ciphertext).
 */
export function decrypt(encoded: string): string {
  const key = getKey();
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

const TEN_MINUTES_MS = 10 * 60 * 1000;

/**
 * Encodes a secure link token for the key submission form.
 * Contains userId, mode, timestamp, and a 16-byte nonce.
 * Encrypted with AES-256-GCM (existing encrypt function).
 */
export function encodeFormToken(userId: string, mode: 'paper' | 'live' = 'paper'): { token: string; nonce: string } {
  const nonce = randomBytes(16).toString('hex');
  const payload = JSON.stringify({
    userId,
    mode,
    timestamp: Date.now(),
    nonce,
  });
  return { token: encrypt(payload), nonce };
}

/**
 * Decodes and validates a form token.
 * Throws if expired (>10 minutes).
 * Returns userId, mode, and nonce for single-use validation.
 */
export function decodeFormToken(token: string): { userId: string; mode: 'paper' | 'live'; nonce: string } {
  const json = decrypt(token);
  const payload = JSON.parse(json) as {
    userId: string;
    mode?: 'paper' | 'live';
    timestamp: number;
    nonce: string;
  };

  const age = Date.now() - payload.timestamp;
  if (age > TEN_MINUTES_MS) {
    throw new Error('Link expired (older than 10 minutes)');
  }

  return { userId: payload.userId, mode: payload.mode ?? 'paper', nonce: payload.nonce };
}
