import { describe, it, expect, beforeEach } from 'vitest';
import { PhasedStrategyEngine } from '../../src/strategies/phased-engine.js';
import type { HistoricalDataPoint } from '../../src/types.js';
import type { PhasedStrategyParams, PhasedStrategyConfiguration } from '../../src/strategies/strategy-configs.js';
import { buildV2Config } from '../../src/strategies/parameter-grid.js';

// ============================================================
// Helpers
// ============================================================

/**
 * Generate a series of OHLCV bars with a gentle uptrend.
 */
function generateUptrendBars(
  count: number,
  startPrice: number,
  opts: { dailyGain?: number; volume?: number; startDate?: string } = {}
): HistoricalDataPoint[] {
  const { dailyGain = 0.5, volume = 1_000_000, startDate = '2024-01-01' } = opts;
  const bars: HistoricalDataPoint[] = [];

  for (let i = 0; i < count; i++) {
    const close = startPrice + i * dailyGain;
    const open = close - dailyGain * 0.3;
    const high = close + dailyGain * 0.5;
    const low = open - dailyGain * 0.3;

    const date = new Date(startDate);
    date.setDate(date.getDate() + i);

    bars.push({
      date: date.toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume,
    });
  }
  return bars;
}

/**
 * Generate flat/sideways OHLCV bars.
 */
function generateFlatBars(
  count: number,
  basePrice: number,
  opts: { volume?: number; startDate?: string } = {}
): HistoricalDataPoint[] {
  const { volume = 1_000_000, startDate = '2024-01-01' } = opts;
  const bars: HistoricalDataPoint[] = [];

  for (let i = 0; i < count; i++) {
    const offset = Math.sin(i * 0.3) * basePrice * 0.005;
    const close = basePrice + offset;
    const open = basePrice - offset * 0.5;
    const high = Math.max(close, open) + basePrice * 0.002;
    const low = Math.min(close, open) - basePrice * 0.002;

    const date = new Date(startDate);
    date.setDate(date.getDate() + i);

    bars.push({
      date: date.toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume,
    });
  }
  return bars;
}

/**
 * Build a test PhasedStrategyConfiguration using the V2 grid builder.
 */
function buildTestPhasedConfig(minHoldDays: number = 7): PhasedStrategyConfiguration {
  return buildV2Config(
    {
      rsi_threshold: 45,
      return_20d: 4,
      distance_to_sma50: 5,
      atr_multiple: 1.5,
      target_r_multiple: 2,
      swing_low_lookback: 10,
    },
    minHoldDays
  );
}

// ============================================================
// Tests
// ============================================================

describe('PhasedStrategyEngine', () => {
  let engine: PhasedStrategyEngine;

  beforeEach(() => {
    engine = new PhasedStrategyEngine('momentum_continuation');
  });

  describe('constructor', () => {
    it('sets the strategy type', () => {
      expect(engine.type).toBe('momentum_continuation');
    });

    it('defaults to momentum_continuation when no type provided', () => {
      const defaultEngine = new PhasedStrategyEngine();
      expect(defaultEngine.type).toBe('momentum_continuation');
    });
  });

  describe('evaluateWithOHLCV', () => {
    it('returns HOLD for empty data', () => {
      const config = buildTestPhasedConfig();
      const params: PhasedStrategyParams = { config };

      const signal = engine.evaluateWithOHLCV([], params);

      expect(signal.direction).toBe('HOLD');
      expect(signal.strategyType).toBe('momentum_continuation');
      expect(signal.price).toBe(0);
    });

    it('returns HOLD for insufficient data (single bar)', () => {
      const config = buildTestPhasedConfig();
      const params: PhasedStrategyParams = { config };
      const dataPoints = generateUptrendBars(1, 100);

      const signal = engine.evaluateWithOHLCV(dataPoints, params);

      expect(signal.direction).toBe('HOLD');
      expect(signal.strategyType).toBe('momentum_continuation');
    });

    it('returns correct strategyType in signal', () => {
      const config = buildTestPhasedConfig();
      const params: PhasedStrategyParams = { config };
      const dataPoints = generateUptrendBars(50, 100);

      const signal = engine.evaluateWithOHLCV(dataPoints, params);

      expect(signal.strategyType).toBe('momentum_continuation');
    });

    it('processes bars sequentially and produces valid signals', () => {
      const config = buildTestPhasedConfig();
      const dataPoints = generateUptrendBars(250, 80, { dailyGain: 0.3 });
      const signals: string[] = [];

      // Feed bars one at a time (growing window)
      for (let i = 1; i <= dataPoints.length; i++) {
        const slice = dataPoints.slice(0, i);
        const params: PhasedStrategyParams = { config };
        const signal = engine.evaluateWithOHLCV(slice, params);
        signals.push(signal.direction);
      }

      // Should have processed all bars
      expect(signals.length).toBe(250);
      // All signals should be valid directions
      for (const dir of signals) {
        expect(['BUY', 'SELL', 'HOLD']).toContain(dir);
      }
    });

    it('returns HOLD when phases do not align (flat data)', () => {
      const config = buildTestPhasedConfig();
      const params: PhasedStrategyParams = { config };
      // Flat data won't satisfy direction phase (price_above_sma, sma_above_sma)
      const dataPoints = generateFlatBars(250, 100);

      // Feed all bars at once
      const signal = engine.evaluateWithOHLCV(dataPoints, params);

      expect(signal.direction).toBe('HOLD');
    });

    it('includes timestamp from the latest bar', () => {
      const config = buildTestPhasedConfig();
      const params: PhasedStrategyParams = { config };
      const dataPoints = generateUptrendBars(50, 100, { startDate: '2024-06-01' });

      const signal = engine.evaluateWithOHLCV(dataPoints, params);

      // The timestamp should be from the last bar
      expect(signal.timestamp).toBe(dataPoints[dataPoints.length - 1].date);
    });

    it('includes price from the latest bar close', () => {
      const config = buildTestPhasedConfig();
      const params: PhasedStrategyParams = { config };
      const dataPoints = generateUptrendBars(50, 100);

      const signal = engine.evaluateWithOHLCV(dataPoints, params);

      expect(signal.price).toBe(dataPoints[dataPoints.length - 1].close);
    });
  });

  describe('minimumDataPointsForParams', () => {
    it('returns a reasonable minimum (>= 50) for default V2 config', () => {
      const config = buildTestPhasedConfig();
      const params: PhasedStrategyParams = { config };

      const min = engine.minimumDataPointsForParams(params);

      expect(min).toBeGreaterThanOrEqual(50);
    });

    it('accounts for phase condition periods', () => {
      // The default V2 config has sma_above_sma with longPeriod=200 in direction phase
      const config = buildTestPhasedConfig();
      const params: PhasedStrategyParams = { config };

      const min = engine.minimumDataPointsForParams(params);

      // Should be at least 200 due to sma_above_sma longPeriod
      expect(min).toBeGreaterThanOrEqual(200);
    });

    it('accounts for stop-loss ATR period', () => {
      const config = buildV2Config(
        {
          rsi_threshold: 45,
          return_20d: 4,
          distance_to_sma50: 5,
          atr_multiple: 1.5,
          target_r_multiple: 2,
          swing_low_lookback: 10,
        },
        7
      );
      // ATR period is 14, so requirement is at least 15
      const params: PhasedStrategyParams = { config };

      const min = engine.minimumDataPointsForParams(params);

      expect(min).toBeGreaterThanOrEqual(15);
    });

    it('accounts for swing_low_lookback', () => {
      const config = buildV2Config(
        {
          rsi_threshold: 45,
          return_20d: 4,
          distance_to_sma50: 5,
          atr_multiple: 1.5,
          target_r_multiple: 2,
          swing_low_lookback: 20, // large lookback
        },
        7
      );
      const params: PhasedStrategyParams = { config };

      const min = engine.minimumDataPointsForParams(params);

      expect(min).toBeGreaterThanOrEqual(20);
    });
  });

  describe('reset', () => {
    it('resets state for reuse', () => {
      const config = buildTestPhasedConfig();
      const dataPoints = generateUptrendBars(250, 80, { dailyGain: 0.3 });

      // Run through some bars
      for (let i = 1; i <= 100; i++) {
        const slice = dataPoints.slice(0, i);
        engine.evaluateWithOHLCV(slice, { config });
      }

      // Reset
      engine.reset();

      // After reset, feeding empty data should return HOLD with price=0
      const signal = engine.evaluateWithOHLCV([], { config });
      expect(signal.direction).toBe('HOLD');
      expect(signal.price).toBe(0);
    });

    it('allows the engine to be reused after reset', () => {
      const config = buildTestPhasedConfig();

      // First run
      const bars1 = generateUptrendBars(50, 100);
      engine.evaluateWithOHLCV(bars1, { config });

      // Reset
      engine.reset();

      // Second run — should not throw and should produce valid signal
      const bars2 = generateUptrendBars(50, 150);
      const signal = engine.evaluateWithOHLCV(bars2, { config });

      expect(signal).toBeDefined();
      expect(['BUY', 'SELL', 'HOLD']).toContain(signal.direction);
    });

    it('clears position state so new entries can occur', () => {
      const config = buildTestPhasedConfig();
      const dataPoints = generateUptrendBars(300, 80, { dailyGain: 0.3 });

      // Run through all bars collecting signals
      const signalsBefore: string[] = [];
      for (let i = 1; i <= dataPoints.length; i++) {
        const slice = dataPoints.slice(0, i);
        const signal = engine.evaluateWithOHLCV(slice, { config });
        signalsBefore.push(signal.direction);
      }

      // Reset and run again — should produce same sequence
      engine.reset();
      const signalsAfter: string[] = [];
      for (let i = 1; i <= dataPoints.length; i++) {
        const slice = dataPoints.slice(0, i);
        const signal = engine.evaluateWithOHLCV(slice, { config });
        signalsAfter.push(signal.direction);
      }

      expect(signalsAfter).toEqual(signalsBefore);
    });
  });

  describe('validateParams', () => {
    it('returns valid for a well-formed config', () => {
      const config = buildTestPhasedConfig();
      const result = engine.validateParams({ config } as any);
      expect(result.valid).toBe(true);
    });

    it('returns invalid when config is missing', () => {
      const result = engine.validateParams({} as any);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Missing');
    });

    it('returns invalid for atr_period < 1', () => {
      const config = buildTestPhasedConfig();
      config.stopLoss.atr_period = 0;
      const result = engine.validateParams({ config } as any);
      expect(result.valid).toBe(false);
    });

    it('returns invalid for target_r_multiple <= 0', () => {
      const config = buildTestPhasedConfig();
      config.profitTarget.target_r_multiple = 0;
      const result = engine.validateParams({ config } as any);
      expect(result.valid).toBe(false);
    });
  });
});
