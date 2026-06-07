/**
 * Unit Tests: get_ticker_profile tool
 *
 * **Validates: Requirements 8.1–8.5**
 *
 * Tests the get_ticker_profile tool implementation including:
 * - Reading profiles from strategy subdirectories
 * - Filtering by specific strategy
 * - Returning all strategies when strategy is omitted
 * - Parameter name mapping to plain English
 * - Handling missing profiles gracefully
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';
import { executeTool, toolDefinitions } from '../tools.js';

const mockedReadFile = vi.mocked(readFile);

// Sample profile fixture
const makeTrendPullbackProfile = (ticker: string) => JSON.stringify({
  ticker,
  strategy: 'trend_pullback',
  params: {
    pullback_proximity_pct: 5,
    atr_contraction_threshold: 0.8,
    volume_below_avg_multiplier: 1,
    trigger_volume_multiplier: 1,
    overextension_pct: 5,
    stop_atr_multiple: 1.5,
    r_multiple: 3,
    swing_lookback: 10,
    exit_preset: 0,
    weight_preset: 0,
  },
  walk_forward_metrics: {
    return: 15.0,
    benchmark: 0,
    win_rate: 0.6,
    trades: 3,
    max_drawdown: 5,
    sharpe: 1.2,
  },
  last_tuned_at: '2026-06-07T05:16:11.582Z',
  valid_until: '2026-06-14T05:16:11.582Z',
});

const makeConsolidationProfile = (ticker: string) => JSON.stringify({
  ticker,
  strategy: 'consolidation_breakout',
  params: {
    consolidation_window: 5,
    max_range_pct: 4,
    atr_ratio_threshold: 0.8,
    volume_multiplier: 1.2,
    overextension_pct: 5,
    atr_multiple: 1.6,
    swing_lookback: 10,
    max_risk_pct: 3,
    r_multiple: 2.5,
    exit_preset: 0,
    weight_preset: 0,
  },
  walk_forward_metrics: {
    return: 20.0,
    benchmark: 0,
    win_rate: 0.5,
    trades: 4,
    max_drawdown: 8,
    sharpe: 0.9,
  },
  last_tuned_at: '2026-06-07T05:16:11.581Z',
  valid_until: '2026-06-14T05:16:11.581Z',
});

describe('get_ticker_profile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should be defined in toolDefinitions with correct schema', () => {
    const tool = toolDefinitions.find((t) => t.name === 'get_ticker_profile');
    expect(tool).toBeDefined();
    expect(tool!.input_schema.required).toContain('ticker');
    expect(tool!.input_schema.properties).toHaveProperty('ticker');
    expect(tool!.input_schema.properties).toHaveProperty('strategy');
  });

  it('should return profiles for a ticker across all strategies', async () => {
    mockedReadFile.mockImplementation(async (filePath) => {
      const p = filePath as string;
      if (p.includes('trend_pullback') && p.includes('AAPL.json')) {
        return makeTrendPullbackProfile('AAPL');
      }
      if (p.includes('consolidation_breakout') && p.includes('AAPL.json')) {
        return makeConsolidationProfile('AAPL');
      }
      throw new Error('ENOENT');
    });

    const result = await executeTool('get_ticker_profile', { ticker: 'AAPL' }) as any;

    expect(result.ticker).toBe('AAPL');
    expect(result.profiles).toHaveLength(2);
    expect(result.profiles[0].strategy).toBe('consolidation_breakout');
    expect(result.profiles[1].strategy).toBe('trend_pullback');
  });

  it('should filter by specific strategy when provided', async () => {
    mockedReadFile.mockImplementation(async (filePath) => {
      const p = filePath as string;
      if (p.includes('trend_pullback') && p.includes('AAPL.json')) {
        return makeTrendPullbackProfile('AAPL');
      }
      throw new Error('ENOENT');
    });

    const result = await executeTool('get_ticker_profile', {
      ticker: 'AAPL',
      strategy: 'trend_pullback',
    }) as any;

    expect(result.ticker).toBe('AAPL');
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].strategy).toBe('trend_pullback');
  });

  it('should return empty profiles with message when no profile exists', async () => {
    mockedReadFile.mockRejectedValue(new Error('ENOENT'));

    const result = await executeTool('get_ticker_profile', { ticker: 'ZZZZ' }) as any;

    expect(result.ticker).toBe('ZZZZ');
    expect(result.profiles).toEqual([]);
    expect(result.message).toBe('No tuned profile found — ticker may use default parameters');
  });

  it('should map parameter names to plain English', async () => {
    mockedReadFile.mockImplementation(async (filePath) => {
      const p = filePath as string;
      if (p.includes('trend_pullback') && p.includes('NVDA.json')) {
        return makeTrendPullbackProfile('NVDA');
      }
      throw new Error('ENOENT');
    });

    const result = await executeTool('get_ticker_profile', {
      ticker: 'NVDA',
      strategy: 'trend_pullback',
    }) as any;

    const params = result.profiles[0].parameters;
    expect(params).toHaveProperty('pullback proximity %');
    expect(params).toHaveProperty('ATR contraction threshold');
    expect(params).toHaveProperty('swing lookback (days)');
    expect(params).toHaveProperty('target R-multiple');
    // Should NOT have raw internal names
    expect(params).not.toHaveProperty('pullback_proximity_pct');
    expect(params).not.toHaveProperty('atr_contraction_threshold');
  });

  it('should compute OOS avg R-multiple from return / trades', async () => {
    mockedReadFile.mockImplementation(async (filePath) => {
      const p = filePath as string;
      if (p.includes('trend_pullback') && p.includes('AAPL.json')) {
        return makeTrendPullbackProfile('AAPL');
      }
      throw new Error('ENOENT');
    });

    const result = await executeTool('get_ticker_profile', {
      ticker: 'AAPL',
      strategy: 'trend_pullback',
    }) as any;

    // 15.0 / 3 = 5.0
    expect(result.profiles[0].oos_avg_r_multiple).toBe(5);
    expect(result.profiles[0].oos_win_rate).toBe(0.6);
  });

  it('should return null for oos_avg_r_multiple when trades is 0', async () => {
    const zeroTradesProfile = JSON.stringify({
      ticker: 'TEST',
      strategy: 'trend_pullback',
      params: { pullback_proximity_pct: 5 },
      walk_forward_metrics: {
        return: 0,
        benchmark: 0,
        win_rate: 0,
        trades: 0,
        max_drawdown: 0,
        sharpe: 0,
      },
      last_tuned_at: '2026-06-07T00:00:00.000Z',
      valid_until: '2026-06-14T00:00:00.000Z',
    });

    mockedReadFile.mockImplementation(async (filePath) => {
      const p = filePath as string;
      if (p.includes('trend_pullback') && p.includes('TEST.json')) {
        return zeroTradesProfile;
      }
      throw new Error('ENOENT');
    });

    const result = await executeTool('get_ticker_profile', {
      ticker: 'TEST',
      strategy: 'trend_pullback',
    }) as any;

    expect(result.profiles[0].oos_avg_r_multiple).toBeNull();
  });

  it('should uppercase the ticker for case-insensitive matching', async () => {
    mockedReadFile.mockImplementation(async (filePath) => {
      const p = filePath as string;
      if (p.includes('AAPL.json')) {
        return makeTrendPullbackProfile('AAPL');
      }
      throw new Error('ENOENT');
    });

    const result = await executeTool('get_ticker_profile', { ticker: 'aapl' }) as any;

    expect(result.ticker).toBe('AAPL');
    // The readFile should be called with uppercase path
    const calls = mockedReadFile.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes('AAPL.json'))).toBe(true);
  });

  it('should include created_at from last_tuned_at field', async () => {
    mockedReadFile.mockImplementation(async (filePath) => {
      const p = filePath as string;
      if (p.includes('trend_pullback') && p.includes('AAPL.json')) {
        return makeTrendPullbackProfile('AAPL');
      }
      throw new Error('ENOENT');
    });

    const result = await executeTool('get_ticker_profile', {
      ticker: 'AAPL',
      strategy: 'trend_pullback',
    }) as any;

    expect(result.profiles[0].created_at).toBe('2026-06-07T05:16:11.582Z');
  });
});
