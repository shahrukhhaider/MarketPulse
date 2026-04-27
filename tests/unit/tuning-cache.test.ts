import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TuningResultCache } from '../../src/tuning-cache.js';
import type { TuningResult } from '../../src/tuning-engine.js';

function makeTuningResult(overrides: Partial<TuningResult> = {}): TuningResult {
  return {
    ticker: 'TSLA',
    strategy: 'trend_pullback',
    profile: 'long_term_low',
    best_region: {
      sma_fast: { min: 50, max: 100 },
      sma_slow: { min: 200, max: 300 },
    },
    summary_metrics: {
      totalReturnPercent: 45.2,
      sharpeRatio: 1.35,
      maxDrawdownPercent: 12.8,
      winRate: 0.62,
      tradeCount: 28,
      profitFactor: 2.1,
    },
    configurations_evaluated: 48,
    configurations_passed_filter: 10,
    computed_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('TuningResultCache', () => {
  let tmpDir: string;
  let cache: TuningResultCache;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tuning-cache-test-'));
    cache = new TuningResultCache(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('creates the cache directory if it does not exist', () => {
      const nested = path.join(tmpDir, 'nested', 'cache');
      new TuningResultCache(nested);
      expect(fs.existsSync(nested)).toBe(true);
    });
  });

  describe('filePath', () => {
    it('returns {cacheDir}/{TICKER}_{strategy}_{profile}.json', () => {
      const fp = cache.filePath('TSLA', 'trend_pullback', 'long_term_low');
      expect(fp).toBe(path.join(tmpDir, 'TSLA_trend_pullback_long_term_low.json'));
    });
  });

  describe('write and read', () => {
    it('round-trips a valid TuningResult', () => {
      const result = makeTuningResult();
      const written = cache.write(result);
      expect(written).toBe(true);

      const loaded = cache.read(result.ticker, result.strategy, result.profile);
      expect(loaded).toEqual(result);
    });

    it('returns false and logs warning on I/O failure', () => {
      // Use a path that cannot be written to
      const badCache = new TuningResultCache(tmpDir);
      const result = makeTuningResult({ ticker: '' });
      // Write to a directory that is actually a file to force failure
      const blocker = path.join(tmpDir, '_trend_pullback_long_term_low.json');
      fs.mkdirSync(blocker); // create dir where file should go
      const written = badCache.write(result);
      expect(written).toBe(false);
    });
  });

  describe('read', () => {
    it('returns null when file does not exist', () => {
      const loaded = cache.read('NOPE', 'trend_pullback', 'long_term_low');
      expect(loaded).toBeNull();
    });

    it('returns null for expired cache (>= 24 hours old)', () => {
      const old = makeTuningResult({
        computed_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      });
      cache.write(old);
      const loaded = cache.read(old.ticker, old.strategy, old.profile);
      expect(loaded).toBeNull();
    });

    it('returns result for fresh cache (< 24 hours old)', () => {
      const fresh = makeTuningResult({
        computed_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
      });
      cache.write(fresh);
      const loaded = cache.read(fresh.ticker, fresh.strategy, fresh.profile);
      expect(loaded).toEqual(fresh);
    });

    it('returns null for malformed JSON on disk', () => {
      const fp = cache.filePath('TSLA', 'trend_pullback', 'long_term_low');
      fs.writeFileSync(fp, '{{not valid json}}', 'utf-8');
      const loaded = cache.read('TSLA', 'trend_pullback', 'long_term_low');
      expect(loaded).toBeNull();
    });

    it('returns null for JSON missing required fields', () => {
      const fp = cache.filePath('TSLA', 'trend_pullback', 'long_term_low');
      fs.writeFileSync(fp, JSON.stringify({ foo: 'bar' }), 'utf-8');
      const loaded = cache.read('TSLA', 'trend_pullback', 'long_term_low');
      expect(loaded).toBeNull();
    });
  });

  describe('isFresh', () => {
    it('returns false when file does not exist', () => {
      expect(cache.isFresh('NOPE', 'trend_pullback', 'long_term_low')).toBe(false);
    });

    it('returns true for a recently written result', () => {
      const result = makeTuningResult();
      cache.write(result);
      expect(cache.isFresh(result.ticker, result.strategy, result.profile)).toBe(true);
    });

    it('returns false for an expired result', () => {
      const old = makeTuningResult({
        computed_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      });
      cache.write(old);
      expect(cache.isFresh(old.ticker, old.strategy, old.profile)).toBe(false);
    });

    it('returns false for malformed cache file', () => {
      const fp = cache.filePath('TSLA', 'trend_pullback', 'long_term_low');
      fs.writeFileSync(fp, 'garbage', 'utf-8');
      expect(cache.isFresh('TSLA', 'trend_pullback', 'long_term_low')).toBe(false);
    });
  });

  describe('serialize / deserialize stubs', () => {
    it('serialize produces valid JSON', () => {
      const result = makeTuningResult();
      const json = cache.serialize(result);
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('deserialize returns null for invalid JSON', () => {
      expect(cache.deserialize('not json')).toBeNull();
    });

    it('deserialize returns null for JSON missing required fields', () => {
      expect(cache.deserialize('{"foo": 1}')).toBeNull();
    });

    it('deserialize returns valid TuningResult for correct JSON', () => {
      const result = makeTuningResult();
      const json = cache.serialize(result);
      const deserialized = cache.deserialize(json);
      expect(deserialized).toEqual(result);
    });
  });
});
