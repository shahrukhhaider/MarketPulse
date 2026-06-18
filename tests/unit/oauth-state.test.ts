import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { encodeOAuthState, decodeOAuthState } from '../../src/broker/token-encryption.js';

// ============================================================
// Unit tests for OAuth state encode/decode helpers
// Validates: Requirements 6.2, 6.3
// ============================================================

describe('OAuth state encode/decode', () => {
  const TEST_KEY = 'a'.repeat(64); // valid 64-char hex key

  beforeEach(() => {
    process.env.BROKER_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.BROKER_ENCRYPTION_KEY;
    vi.restoreAllMocks();
  });

  it('round-trips a userId through encode then decode', () => {
    const userId = '123456789012345678'; // typical Discord user ID
    const state = encodeOAuthState(userId);
    const result = decodeOAuthState(state);
    expect(result.userId).toBe(userId);
  });

  it('encoded state is opaque (does not contain plaintext userId)', () => {
    const userId = 'myDiscordUserId12345';
    const state = encodeOAuthState(userId);
    expect(state).not.toContain(userId);
  });

  it('produces different encoded values for the same userId (nonce differs)', () => {
    const userId = 'sameUser';
    const state1 = encodeOAuthState(userId);
    const state2 = encodeOAuthState(userId);
    expect(state1).not.toBe(state2);
  });

  it('throws when state is older than 10 minutes', () => {
    const userId = 'expiredUser';

    // Mock Date.now to return a fixed value for encoding
    const encodedAt = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValueOnce(encodedAt);
    const state = encodeOAuthState(userId);

    // Mock Date.now to return 11 minutes later for decoding
    const elevenMinutesLater = encodedAt + 11 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(elevenMinutesLater);

    expect(() => decodeOAuthState(state)).toThrow(
      'OAuth state expired (older than 10 minutes)',
    );
  });

  it('does not throw when state is exactly 10 minutes old', () => {
    const userId = 'borderUser';

    const encodedAt = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValueOnce(encodedAt);
    const state = encodeOAuthState(userId);

    // Exactly 10 minutes = 600_000 ms
    const exactlyTenMinutes = encodedAt + 10 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(exactlyTenMinutes);

    // 10 minutes is NOT > 10 minutes, so it should pass
    const result = decodeOAuthState(state);
    expect(result.userId).toBe(userId);
  });

  it('throws when state is just over 10 minutes old', () => {
    const userId = 'justExpiredUser';

    const encodedAt = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValueOnce(encodedAt);
    const state = encodeOAuthState(userId);

    // 10 minutes + 1 ms
    const justOverTenMinutes = encodedAt + 10 * 60 * 1000 + 1;
    vi.spyOn(Date, 'now').mockReturnValue(justOverTenMinutes);

    expect(() => decodeOAuthState(state)).toThrow(
      'OAuth state expired (older than 10 minutes)',
    );
  });

  it('throws on tampered state (invalid ciphertext)', () => {
    expect(() => decodeOAuthState('invalidbase64garbage!!')).toThrow();
  });

  it('works with empty userId', () => {
    const userId = '';
    const state = encodeOAuthState(userId);
    const result = decodeOAuthState(state);
    expect(result.userId).toBe('');
  });

  it('works with special characters in userId', () => {
    const userId = 'user-with-spëcial_chars!@#$%';
    const state = encodeOAuthState(userId);
    const result = decodeOAuthState(state);
    expect(result.userId).toBe(userId);
  });
});
