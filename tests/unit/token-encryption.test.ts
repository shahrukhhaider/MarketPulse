import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';

describe('token-encryption', () => {
  const VALID_KEY = randomBytes(32).toString('hex'); // 64-char hex string
  let encrypt: typeof import('../../src/broker/token-encryption.js').encrypt;
  let decrypt: typeof import('../../src/broker/token-encryption.js').decrypt;

  beforeEach(async () => {
    process.env.BROKER_ENCRYPTION_KEY = VALID_KEY;
    // Dynamic import to pick up env var changes
    const mod = await import('../../src/broker/token-encryption.js');
    encrypt = mod.encrypt;
    decrypt = mod.decrypt;
  });

  afterEach(() => {
    delete process.env.BROKER_ENCRYPTION_KEY;
  });

  it('encrypts and decrypts a simple string', () => {
    const plaintext = 'my-secret-token-value';
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('encrypts and decrypts an empty string', () => {
    const plaintext = '';
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const plaintext = 'same-input';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
  });

  it('output is valid base64', () => {
    const encrypted = encrypt('test-value');
    expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();
    // Round-trip through base64 should produce the same string
    expect(Buffer.from(encrypted, 'base64').toString('base64')).toBe(encrypted);
  });

  it('throws when BROKER_ENCRYPTION_KEY is missing', () => {
    delete process.env.BROKER_ENCRYPTION_KEY;
    expect(() => encrypt('test')).toThrow(
      'BROKER_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)',
    );
  });

  it('throws when BROKER_ENCRYPTION_KEY is too short', () => {
    process.env.BROKER_ENCRYPTION_KEY = 'abcdef1234'; // only 10 chars
    expect(() => encrypt('test')).toThrow(
      'BROKER_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)',
    );
  });

  it('throws when BROKER_ENCRYPTION_KEY is too long', () => {
    process.env.BROKER_ENCRYPTION_KEY = 'a'.repeat(128);
    expect(() => encrypt('test')).toThrow(
      'BROKER_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)',
    );
  });

  it('fails to decrypt with a different key', () => {
    const encrypted = encrypt('secret');
    // Switch to a different key
    process.env.BROKER_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    expect(() => decrypt(encrypted)).toThrow();
  });

  it('fails to decrypt tampered ciphertext', () => {
    const encrypted = encrypt('secret');
    const buf = Buffer.from(encrypted, 'base64');
    // Flip a byte in the ciphertext portion
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString('base64');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('handles unicode strings correctly', () => {
    const plaintext = '🔐 encrypted token — ñoño $pecial';
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('handles long strings', () => {
    const plaintext = 'x'.repeat(10_000);
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });
});
