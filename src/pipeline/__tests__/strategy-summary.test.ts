/**
 * Unit Tests: Shared Strategy Summary
 *
 * **Validates: Requirements 3.6, 3.7, 3.8**
 *
 * Tests the buildStrategySummary and toWalkForwardMetrics utilities
 * extracted from parallel-tune.ts and tune-command.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildStrategySummary, toWalkForwardMetrics } from '../strategy-summary.js';
import type { TuningPerformanceMetrics } from '../tuning-engine.js';
import type { TuneResult } from '../pipeline-functions.js';

// ============================================================
// Mock profile-store module
// ============================================================

vi.mock('../../data/profile-store.js', () => ({
  saveStrategyProfile: vi.fn(() => ({ success: true, data: undefined })),
  computeExpiry: vi.fn(() => '2025-02-01T00:00:00.000Z'),
}));

import { saveStrategyProfile, computeExpiry } from '../../data/profile-store.js';

// ============================================================
// Test Fixtures
// ============================================================

const makeMockMetrics = (overrides?: Partial<TuningPerformanceMetrics>): TuningPerformanceMetrics => ({
  totalReturnPercent: 12.5,
  sharpeRatio: 1.8,
  maxDrawdownPercent: -5.2,
  winRate: 0.65,
  tradeCount: 42,
  profitFactor: 2.1,
  ...overrides,
});

const makeMockTuneResult = (overrides?: Partial<TuneResult>): TuneResult => ({
  bestParams: { period: 14, threshold: 0.5 },
  bestEntry: {} as TuneResult['bestEntry'],
  isMetrics: makeMockMetrics(),
  oosMetrics: makeMockMetrics({ totalReturnPercent: 10.0, sharpeRatio: 1.5 }),
  configurationsEvaluated: 128,
  configurationsPassed: 45,
  ...overrides,
});

// ============================================================
// Tests: buildStrategySummary — Error Classification
// ============================================================

describe('buildStrategySummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('error classification', () => {
    it('classifies "insufficient data" error → status insufficient_data', () => {
      const result = buildStrategySummary(
        'AAPL',
        'consolidation_breakout',
        { error: 'Insufficient data for backtest — need 252 bars, got 100' },
        false,
        '/tmp/data',
      );

      expect(result.status).toBe('insufficient_data');
      expect(result.ticker).toBe('AAPL');
      expect(result.strategy).toBe('consolidation_breakout');
      expect(result.profile_saved).toBe(false);
      expect(result.error_message).toContain('Insufficient data');
    });

    it('classifies "no viable" error → status no_viable_configs', () => {
      const result = buildStrategySummary(
        'MSFT',
        'trend_pullback',
        { error: 'No viable configurations found after grid search' },
        false,
        '/tmp/data',
      );

      expect(result.status).toBe('no_viable_configs');
      expect(result.ticker).toBe('MSFT');
      expect(result.strategy).toBe('trend_pullback');
      expect(result.profile_saved).toBe(false);
      expect(result.error_message).toContain('No viable');
    });

    it('classifies generic error → status error', () => {
      const result = buildStrategySummary(
        'GOOG',
        'bear_breakdown',
        { error: 'Network timeout fetching historical data' },
        false,
        '/tmp/data',
      );

      expect(result.status).toBe('error');
      expect(result.ticker).toBe('GOOG');
      expect(result.strategy).toBe('bear_breakdown');
      expect(result.profile_saved).toBe(false);
      expect(result.error_message).toContain('Network timeout');
    });
  });

  // ============================================================
  // Tests: buildStrategySummary — Profile Save Behavior
  // ============================================================

  describe('profile save behavior', () => {
    it('saves profile when shouldSave=true and sets profile_saved: true', () => {
      const tuneResult = makeMockTuneResult();

      const result = buildStrategySummary(
        'AAPL',
        'consolidation_breakout',
        tuneResult,
        true,
        '/tmp/data',
      );

      expect(result.status).toBe('success');
      expect(result.profile_saved).toBe(true);
      expect(computeExpiry).toHaveBeenCalledOnce();
      expect(saveStrategyProfile).toHaveBeenCalledOnce();

      // Verify the profile passed to saveStrategyProfile has correct shape
      const savedProfile = vi.mocked(saveStrategyProfile).mock.calls[0][0];
      expect(savedProfile.ticker).toBe('AAPL');
      expect(savedProfile.strategy).toBe('consolidation_breakout');
      expect(savedProfile.params).toEqual({ period: 14, threshold: 0.5 });
      expect(savedProfile.valid_until).toBe('2025-02-01T00:00:00.000Z');

      // Verify dataDir passed correctly
      const passedDataDir = vi.mocked(saveStrategyProfile).mock.calls[0][1];
      expect(passedDataDir).toBe('/tmp/data');
    });

    it('does NOT save profile when shouldSave=false', () => {
      const tuneResult = makeMockTuneResult();

      const result = buildStrategySummary(
        'MSFT',
        'trend_pullback',
        tuneResult,
        false,
        '/tmp/data',
      );

      expect(result.status).toBe('success');
      expect(result.profile_saved).toBe(false);
      expect(saveStrategyProfile).not.toHaveBeenCalled();
      expect(computeExpiry).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Tests: buildStrategySummary — Success Return Shape
  // ============================================================

  describe('success return shape', () => {
    it('includes in_sample, out_of_sample, and configurations_evaluated on success', () => {
      const tuneResult = makeMockTuneResult();

      const result = buildStrategySummary(
        'TSLA',
        'keltner_mean_reversion',
        tuneResult,
        false,
        '/tmp/data',
      );

      expect(result.status).toBe('success');
      expect(result.in_sample).toBe(tuneResult.isMetrics);
      expect(result.out_of_sample).toBe(tuneResult.oosMetrics);
      expect(result.configurations_evaluated).toBe(128);
    });
  });
});

// ============================================================
// Tests: toWalkForwardMetrics
// ============================================================

describe('toWalkForwardMetrics', () => {
  it('produces correct field mapping from TuningPerformanceMetrics', () => {
    const input: TuningPerformanceMetrics = {
      totalReturnPercent: 15.3,
      sharpeRatio: 2.1,
      maxDrawdownPercent: -8.5,
      winRate: 0.72,
      tradeCount: 55,
      profitFactor: 2.8,
    };

    const result = toWalkForwardMetrics(input);

    expect(result).toEqual({
      return: 15.3,
      benchmark: 0,
      win_rate: 0.72,
      trades: 55,
      max_drawdown: -8.5,
      sharpe: 2.1,
    });
  });

  it('maps all fields correctly with different values', () => {
    const input: TuningPerformanceMetrics = {
      totalReturnPercent: -3.2,
      sharpeRatio: -0.5,
      maxDrawdownPercent: -22.1,
      winRate: 0.35,
      tradeCount: 8,
      profitFactor: 0.7,
    };

    const result = toWalkForwardMetrics(input);

    expect(result.return).toBe(-3.2);
    expect(result.benchmark).toBe(0);
    expect(result.win_rate).toBe(0.35);
    expect(result.trades).toBe(8);
    expect(result.max_drawdown).toBe(-22.1);
    expect(result.sharpe).toBe(-0.5);
  });
});
