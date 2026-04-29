import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeExpiry,
  isValidProfile,
  saveStrategyProfile,
  loadStrategyProfile,
  DEFAULT_EXPIRY_DAYS,
  type StrategyProfile,
} from '../../src/profile-store.js';

const TEST_BASE_DIR = join('tests', '.test-profile-store');

function makeProfile(overrides: Partial<StrategyProfile> = {}): StrategyProfile {
  return {
    ticker: 'TSLA',
    strategy: 'consolidation_breakout',
    params: { consolidation_window: 10, max_range_pct: 6 },
    walk_forward_metrics: {
      return: 15.2,
      benchmark: 8.1,
      win_rate: 0.65,
      trades: 12,
      max_drawdown: -10.5,
      sharpe: 1.3,
    },
    last_tuned_at: '2025-01-15T10:30:00.000Z',
    valid_until: '2099-01-22T10:30:00.000Z',
    ...overrides,
  };
}

describe('profile-store', () => {
  beforeEach(() => {
    if (existsSync(TEST_BASE_DIR)) {
      rmSync(TEST_BASE_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_BASE_DIR)) {
      rmSync(TEST_BASE_DIR, { recursive: true, force: true });
    }
  });

  describe('computeExpiry', () => {
    it('adds 7 days by default', () => {
      const result = computeExpiry('2025-01-15T10:30:00.000Z');
      expect(result).toBe('2025-01-22T10:30:00.000Z');
    });

    it('accepts custom expiry days', () => {
      const result = computeExpiry('2025-01-15T10:30:00.000Z', 14);
      expect(result).toBe('2025-01-29T10:30:00.000Z');
    });

    it('handles month boundary', () => {
      const result = computeExpiry('2025-01-28T00:00:00.000Z', 7);
      expect(result).toBe('2025-02-04T00:00:00.000Z');
    });
  });

  describe('isValidProfile', () => {
    it('returns true for a valid profile', () => {
      expect(isValidProfile(makeProfile())).toBe(true);
    });

    it('returns false for null', () => {
      expect(isValidProfile(null)).toBe(false);
    });

    it('returns false when ticker is missing', () => {
      const { ticker, ...rest } = makeProfile();
      expect(isValidProfile(rest)).toBe(false);
    });

    it('returns false when params has non-number value', () => {
      const profile = makeProfile();
      (profile.params as Record<string, unknown>).bad = 'string';
      expect(isValidProfile(profile)).toBe(false);
    });

    it('returns false when walk_forward_metrics is missing a field', () => {
      const profile = makeProfile();
      delete (profile.walk_forward_metrics as unknown as Record<string, unknown>).sharpe;
      expect(isValidProfile(profile)).toBe(false);
    });

    it('returns false when walk_forward_metrics is an array', () => {
      const obj = { ...makeProfile(), walk_forward_metrics: [1, 2, 3] };
      expect(isValidProfile(obj)).toBe(false);
    });
  });

  describe('saveStrategyProfile', () => {
    it('creates directories and writes JSON with 2-space indentation', () => {
      const profile = makeProfile();
      const result = saveStrategyProfile(profile, TEST_BASE_DIR);
      expect(result.success).toBe(true);

      const filePath = join(TEST_BASE_DIR, 'data', 'profiles', 'consolidation_breakout', 'TSLA.json');
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, 'utf-8');
      expect(content).toBe(JSON.stringify(profile, null, 2));
    });

    it('overwrites existing profile', () => {
      const profile1 = makeProfile({ params: { a: 1 } });
      saveStrategyProfile(profile1, TEST_BASE_DIR);

      const profile2 = makeProfile({ params: { b: 2 } });
      const result = saveStrategyProfile(profile2, TEST_BASE_DIR);
      expect(result.success).toBe(true);

      const filePath = join(TEST_BASE_DIR, 'data', 'profiles', 'consolidation_breakout', 'TSLA.json');
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(content.params).toEqual({ b: 2 });
    });
  });

  describe('loadStrategyProfile', () => {
    it('returns PROFILE_NOT_FOUND when file does not exist', () => {
      const result = loadStrategyProfile('TSLA', 'consolidation_breakout', { baseDir: TEST_BASE_DIR });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PROFILE_NOT_FOUND');
        expect(result.error.message).toContain('npm run tune');
      }
    });

    it('returns PROFILE_CORRUPT for malformed JSON', () => {
      const dir = join(TEST_BASE_DIR, 'data', 'profiles', 'consolidation_breakout');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'TSLA.json'), 'not json', 'utf-8');

      const result = loadStrategyProfile('TSLA', 'consolidation_breakout', { baseDir: TEST_BASE_DIR });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PROFILE_CORRUPT');
      }
    });

    it('returns PROFILE_CORRUPT for valid JSON missing required fields', () => {
      const dir = join(TEST_BASE_DIR, 'data', 'profiles', 'consolidation_breakout');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'TSLA.json'), JSON.stringify({ ticker: 'TSLA' }), 'utf-8');

      const result = loadStrategyProfile('TSLA', 'consolidation_breakout', { baseDir: TEST_BASE_DIR });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PROFILE_CORRUPT');
      }
    });

    it('returns PROFILE_EXPIRED when valid_until is in the past', () => {
      const profile = makeProfile({ valid_until: '2020-01-01T00:00:00.000Z' });
      saveStrategyProfile(profile, TEST_BASE_DIR);

      const result = loadStrategyProfile('TSLA', 'consolidation_breakout', { baseDir: TEST_BASE_DIR });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PROFILE_EXPIRED');
        expect(result.error.message).toContain('--allow-stale');
      }
    });

    it('returns profile when allowStale is true even if expired', () => {
      const profile = makeProfile({ valid_until: '2020-01-01T00:00:00.000Z' });
      saveStrategyProfile(profile, TEST_BASE_DIR);

      const result = loadStrategyProfile('TSLA', 'consolidation_breakout', {
        baseDir: TEST_BASE_DIR,
        allowStale: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ticker).toBe('TSLA');
      }
    });

    it('round-trips a valid profile', () => {
      const profile = makeProfile();
      saveStrategyProfile(profile, TEST_BASE_DIR);

      const result = loadStrategyProfile('TSLA', 'consolidation_breakout', {
        baseDir: TEST_BASE_DIR,
        allowStale: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(profile);
      }
    });
  });
});
