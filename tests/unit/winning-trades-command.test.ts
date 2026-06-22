import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateWindow, createWinningTradesHandler, isWithinRollingWindow, daysBetween } from '../../src/commands/winning-trades-command.js';

// ============================================================
// validateWindow — direct unit tests
// ============================================================

describe('validateWindow', () => {
  describe('valid values', () => {
    it('accepts 7 (default value)', () => {
      const result = validateWindow('7');
      expect(result).toEqual({ valid: true, window: 7 });
    });

    it('accepts 14', () => {
      const result = validateWindow('14');
      expect(result).toEqual({ valid: true, window: 14 });
    });

    it('accepts boundary value 1 (minimum)', () => {
      const result = validateWindow('1');
      expect(result).toEqual({ valid: true, window: 1 });
    });

    it('accepts boundary value 365 (maximum)', () => {
      const result = validateWindow('365');
      expect(result).toEqual({ valid: true, window: 365 });
    });
  });

  describe('invalid values', () => {
    it('rejects 0 (below minimum)', () => {
      const result = validateWindow('0');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('Invalid --window value');
        expect(result.error).toContain('0');
      }
    });

    it('rejects 366 (above maximum)', () => {
      const result = validateWindow('366');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('Invalid --window value');
        expect(result.error).toContain('366');
      }
    });

    it('rejects non-numeric string "abc"', () => {
      const result = validateWindow('abc');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('Invalid --window value');
        expect(result.error).toContain('abc');
      }
    });

    it('rejects decimal value "3.5"', () => {
      const result = validateWindow('3.5');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('Invalid --window value');
      }
    });

    it('rejects negative value "-1"', () => {
      const result = validateWindow('-1');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('Invalid --window value');
      }
    });
  });
});

// ============================================================
// createWinningTradesHandler — window flag integration tests
// ============================================================

describe('createWinningTradesHandler — window validation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `winning-trades-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Minimal mock for cachingProvider — we never reach chart generation in these tests
  const mockCachingProvider = {
    get: async () => null,
    set: async () => {},
    has: async () => false,
    getHistoricalData: async () => ({ dataPoints: [], metadata: { ticker: '', lastUpdated: '', period: '1y', interval: '1d' } }),
  } as any;

  it('returns INVALID_PARAM_RANGE for --window 0', async () => {
    const handler = createWinningTradesHandler({ dataDir: tempDir, cachingProvider: mockCachingProvider });
    const result = await handler({ window: '0' });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAM_RANGE');
    expect(result.error?.message).toContain('Invalid --window value');
  });

  it('returns INVALID_PARAM_RANGE for --window 366', async () => {
    const handler = createWinningTradesHandler({ dataDir: tempDir, cachingProvider: mockCachingProvider });
    const result = await handler({ window: '366' });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAM_RANGE');
    expect(result.error?.message).toContain('Invalid --window value');
  });

  it('returns INVALID_PARAM_RANGE for --window abc', async () => {
    const handler = createWinningTradesHandler({ dataDir: tempDir, cachingProvider: mockCachingProvider });
    const result = await handler({ window: 'abc' });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAM_RANGE');
    expect(result.error?.message).toContain('Invalid --window value');
  });

  it('returns DATA_NOT_AVAILABLE when no signal history exists (default window)', async () => {
    // No signal history files in tempDir → proves validation passed with default window of 7
    const handler = createWinningTradesHandler({ dataDir: tempDir, cachingProvider: mockCachingProvider });
    const result = await handler({});
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('DATA_NOT_AVAILABLE');
    expect(result.error?.message).toContain('Signal history has not been populated');
  });

  it('returns DATA_NOT_AVAILABLE when --window 14 is valid (validation passes, no history)', async () => {
    // Passes validation but no data files exist → DATA_NOT_AVAILABLE not INVALID_PARAM_RANGE
    const handler = createWinningTradesHandler({ dataDir: tempDir, cachingProvider: mockCachingProvider });
    const result = await handler({ window: '14' });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('DATA_NOT_AVAILABLE');
  });

  it('returns DATA_NOT_AVAILABLE when --window 1 is valid (boundary)', async () => {
    const handler = createWinningTradesHandler({ dataDir: tempDir, cachingProvider: mockCachingProvider });
    const result = await handler({ window: '1' });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('DATA_NOT_AVAILABLE');
  });

  it('returns DATA_NOT_AVAILABLE when --window 365 is valid (boundary)', async () => {
    const handler = createWinningTradesHandler({ dataDir: tempDir, cachingProvider: mockCachingProvider });
    const result = await handler({ window: '365' });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('DATA_NOT_AVAILABLE');
  });
});


// ============================================================
// isWithinRollingWindow — boundary cases
// ============================================================

describe('isWithinRollingWindow — boundary cases', () => {
  it('includes trade whose hitDate is exactly window days ago (inclusive boundary)', () => {
    // window = 7, hitDate is exactly 7 days before today
    const today = '2026-06-21';
    const hitDate = '2026-06-14'; // daysBetween('2026-06-14', '2026-06-21') = 7
    expect(isWithinRollingWindow(hitDate, today, 7)).toBe(true);
  });

  it('excludes trade whose hitDate is window+1 days ago', () => {
    // window = 7, hitDate is 8 days before today
    const today = '2026-06-21';
    const hitDate = '2026-06-13'; // daysBetween('2026-06-13', '2026-06-21') = 8
    expect(isWithinRollingWindow(hitDate, today, 7)).toBe(false);
  });

  it('includes trade whose hitDate is today (0 days ago)', () => {
    const today = '2026-06-21';
    expect(isWithinRollingWindow(today, today, 7)).toBe(true);
  });

  it('includes trade whose hitDate is 1 day ago with window=1', () => {
    const today = '2026-06-21';
    const hitDate = '2026-06-20';
    expect(isWithinRollingWindow(hitDate, today, 1)).toBe(true);
  });

  it('excludes trade whose hitDate is 2 days ago with window=1', () => {
    const today = '2026-06-21';
    const hitDate = '2026-06-19';
    expect(isWithinRollingWindow(hitDate, today, 1)).toBe(false);
  });
});

// ============================================================
// createWinningTradesHandler — rolling window filtering & edge cases
// ============================================================

describe('createWinningTradesHandler — rolling window filtering and edge cases', () => {
  let tempDir: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  // Minimal mock for cachingProvider — returns empty data so no bars match
  const mockCachingProvider = {
    get: async () => null,
    set: async () => {},
    has: async () => false,
    getHistoricalData: async () => ({ dataPoints: [], metadata: { ticker: '', lastUpdated: '', period: '1y', interval: '1d' } }),
  } as any;

  beforeEach(() => {
    tempDir = join(tmpdir(), `winning-trades-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    stdoutSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('returns DATA_NOT_AVAILABLE when no signal history files exist', async () => {
    // tempDir has no signal-history.ndjson or signal-history-tech.ndjson
    const handler = createWinningTradesHandler({ dataDir: tempDir, cachingProvider: mockCachingProvider });
    const result = await handler({ window: '7' });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('DATA_NOT_AVAILABLE');
    expect(result.error?.message).toContain('Signal history has not been populated');
  });

  it('writes valid manifest with trades: [] when signal history exists but no trades qualify', async () => {
    // Write a signal history entry with an old signal
    // Since there's no cache data, checkTargetHitInBars returns { hit: false } → no winners
    const entry = {
      date: '2026-01-01',
      timestamp: '2026-01-01T12:00:00Z',
      market_context: { market_mood: 'bullish', market_regime: 'uptrend', vix: 15, vix_regime: 'low', breadth_pct: 60, breadth_label: 'healthy' },
      active: [{ ticker: 'FAKE', strategy: 'trend_pullback', entry: 100, stop: 95, target: 110, confidence: 0.8, rs_rating: 85, rationale: ['test'], rvol: 1.5 }],
      near: [],
      open_positions: [],
    };
    writeFileSync(join(tempDir, 'signal-history.ndjson'), JSON.stringify(entry) + '\n');

    const handler = createWinningTradesHandler({ dataDir: tempDir, cachingProvider: mockCachingProvider });
    const result = await handler({ 'min-age': '1', window: '7' });

    // Should succeed with empty trades (entries exist but no targets hit because no cache data)
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.trades).toEqual([]);
      expect(result.data.count).toBe(0);
    }
  });

  it('copies manifest to latest.json when no trades qualify', async () => {
    const entry = {
      date: '2026-01-01',
      timestamp: '2026-01-01T12:00:00Z',
      market_context: { market_mood: 'bullish', market_regime: 'uptrend', vix: 15, vix_regime: 'low', breadth_pct: 60, breadth_label: 'healthy' },
      active: [{ ticker: 'FAKE', strategy: 'trend_pullback', entry: 100, stop: 95, target: 110, confidence: 0.8, rs_rating: 85, rationale: ['test'], rvol: 1.5 }],
      near: [],
      open_positions: [],
    };
    writeFileSync(join(tempDir, 'signal-history.ndjson'), JSON.stringify(entry) + '\n');

    const handler = createWinningTradesHandler({ dataDir: tempDir, cachingProvider: mockCachingProvider });
    await handler({ 'min-age': '1', window: '7' });

    // latest.json should exist in the winning-trades root
    const latestPath = join(tempDir, 'winning-trades', 'latest.json');
    expect(existsSync(latestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(latestPath, 'utf-8'));
    expect(manifest.trades).toEqual([]);
  });

  it('prints summary message with "0 winning trade(s) found" when no trades qualify', async () => {
    const entry = {
      date: '2026-01-01',
      timestamp: '2026-01-01T12:00:00Z',
      market_context: { market_mood: 'bullish', market_regime: 'uptrend', vix: 15, vix_regime: 'low', breadth_pct: 60, breadth_label: 'healthy' },
      active: [{ ticker: 'FAKE', strategy: 'trend_pullback', entry: 100, stop: 95, target: 110, confidence: 0.8, rs_rating: 85, rationale: ['test'], rvol: 1.5 }],
      near: [],
      open_positions: [],
    };
    writeFileSync(join(tempDir, 'signal-history.ndjson'), JSON.stringify(entry) + '\n');

    const handler = createWinningTradesHandler({ dataDir: tempDir, cachingProvider: mockCachingProvider });
    await handler({ 'min-age': '1', window: '7' });

    // Check that stdout was called with a message containing "0 winning trade(s) found"
    const stdoutCalls = stdoutSpy.mock.calls.map(call => String(call[0]));
    const summaryMessage = stdoutCalls.find(msg => msg.includes('winning trade(s) found'));
    expect(summaryMessage).toBeDefined();
    expect(summaryMessage).toContain('0 winning trade(s) found');
  });
});
