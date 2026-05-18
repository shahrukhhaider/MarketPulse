import { describe, it, expect, beforeEach } from 'vitest';
import { CompositeStrategyEngine } from '../../src/strategies/composite-engine.js';
import type { PricePoint, HistoricalDataPoint } from '../../src/types.js';
import type { CompositeStrategyParams, StrategyConfiguration } from '../../src/strategies/strategy-configs.js';
import { buildConfig } from '../../src/strategies/parameter-grid.js';

// ============================================================
// Helpers
// ============================================================

/**
 * Generate a series of PricePoints with a gentle uptrend.
 */
function generatePricePoints(
  count: number,
  startPrice: number,
  opts: { dailyGain?: number; ticker?: string; startDate?: string } = {}
): PricePoint[] {
  const { dailyGain = 0.5, ticker = 'TEST', startDate = '2024-01-01' } = opts;
  const points: PricePoint[] = [];

  for (let i = 0; i < count; i++) {
    const price = startPrice + i * dailyGain;
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);

    points.push({
      ticker,
      price,
      timestamp: date.toISOString().slice(0, 10),
    });
  }
  return points;
}

/**
 * Generate OHLCV bars matching the price points for primaryDataPoints.
 */
function generateOHLCVBars(
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
 * Build a simple trend_pullback config using the parameter grid builder.
 */
function buildTestConfig(): StrategyConfiguration {
  return buildConfig('trend_pullback', {
    sma_fast: 20,
    sma_slow: 100,
    rsi_threshold: 40,
    atr_stop_multiple: 2.0,
    hold_days: 7,
    exit_sma_period: 10,
    exit_rsi_threshold: 70,
    confidence_threshold: 0.6,
    direction_weight: 1.0,
    timing_weight: 1.0,
    confirmation_weight: 1.0,
  });
}

// ============================================================
// Tests
// ============================================================

describe('CompositeStrategyEngine', () => {
  let engine: CompositeStrategyEngine;

  beforeEach(() => {
    engine = new CompositeStrategyEngine('trend_pullback');
  });

  describe('constructor', () => {
    it('sets the strategy type', () => {
      expect(engine.type).toBe('trend_pullback');
    });

    it('accepts different strategy types', () => {
      const momentumEngine = new CompositeStrategyEngine('momentum_continuation');
      expect(momentumEngine.type).toBe('momentum_continuation');
    });
  });

  describe('evaluate', () => {
    it('returns HOLD for insufficient data', () => {
      const config = buildTestConfig();
      const params: CompositeStrategyParams = { config };
      // Only 5 bars — well below the minimum required
      const priceHistory = generatePricePoints(5, 100);

      const signal = engine.evaluate(priceHistory, params as any);

      expect(signal.direction).toBe('HOLD');
      expect(signal.strategyType).toBe('trend_pullback');
    });

    it('returns correct strategyType in signal', () => {
      const config = buildTestConfig();
      const params: CompositeStrategyParams = { config };
      const priceHistory = generatePricePoints(10, 100);

      const signal = engine.evaluate(priceHistory, params as any);

      expect(signal.strategyType).toBe('trend_pullback');
    });

    it('processes bars sequentially and maintains state', () => {
      const config = buildTestConfig();
      const dataPoints = generateOHLCVBars(250, 80, { dailyGain: 0.3 });
      const params: CompositeStrategyParams = { config, primaryDataPoints: dataPoints };

      const signals: string[] = [];

      // Feed bars one at a time (growing window)
      for (let i = 1; i <= dataPoints.length; i++) {
        const slice = dataPoints.slice(0, i);
        const priceHistory: PricePoint[] = slice.map(dp => ({
          ticker: 'TEST',
          price: dp.close,
          timestamp: dp.date,
        }));
        const sliceParams: CompositeStrategyParams = {
          config,
          primaryDataPoints: slice,
        };
        const signal = engine.evaluate(priceHistory, sliceParams as any);
        signals.push(signal.direction);
      }

      // Should have processed all bars
      expect(signals.length).toBe(250);
      // All signals should be valid directions
      for (const dir of signals) {
        expect(['BUY', 'SELL', 'HOLD']).toContain(dir);
      }
    });

    it('returns HOLD when no entry conditions are met with sufficient data', () => {
      // Use a config that requires strong momentum — flat data won't trigger
      const config = buildConfig('momentum_continuation', {
        return_period: 20,
        return_threshold: 15, // very high threshold
        sma_period: 50,
        short_return_period: 5,
        short_return_threshold: 10,
        atr_stop_multiple: 2.0,
        hold_days: 7,
        exit_sma_period: 10,
        exit_rsi_threshold: 70,
        confidence_threshold: 0.9, // very high confidence needed
        direction_weight: 1.0,
        timing_weight: 1.0,
        confirmation_weight: 1.0,
      });

      // Flat price data — no momentum
      const priceHistory = generatePricePoints(200, 100, { dailyGain: 0.01 });
      const params: CompositeStrategyParams = { config };

      engine = new CompositeStrategyEngine('momentum_continuation');
      const signal = engine.evaluate(priceHistory, params as any);

      expect(signal.direction).toBe('HOLD');
    });
  });

  describe('minimumDataPointsForParams', () => {
    it('returns a reasonable minimum (>= 50) for trend_pullback', () => {
      const config = buildTestConfig();
      const params: CompositeStrategyParams = { config };

      const min = engine.minimumDataPointsForParams(params);

      expect(min).toBeGreaterThanOrEqual(50);
    });

    it('returns a value based on the longest period in filters', () => {
      const config = buildConfig('trend_pullback', {
        sma_fast: 50,
        sma_slow: 200,
        rsi_threshold: 40,
        atr_stop_multiple: 2.0,
        hold_days: 7,
        exit_sma_period: 10,
        exit_rsi_threshold: 70,
        confidence_threshold: 0.6,
        direction_weight: 1.0,
        timing_weight: 1.0,
        confirmation_weight: 1.0,
      });
      const params: CompositeStrategyParams = { config };

      const min = engine.minimumDataPointsForParams(params);

      // sma_slow=200 is the longest period, so minimum should be at least 200
      expect(min).toBeGreaterThanOrEqual(200);
    });

    it('accounts for exit rule periods', () => {
      const config = buildConfig('breakout_volume', {
        sma_trend_period: 20,
        breakout_period: 10,
        volume_avg_period: 10,
        volume_multiplier: 1.5,
        atr_stop_multiple: 2.0,
        hold_days: 7,
        exit_sma_period: 50, // large exit SMA
        exit_rsi_threshold: 70,
        confidence_threshold: 0.6,
        direction_weight: 1.0,
        timing_weight: 1.0,
        confirmation_weight: 1.0,
      });
      const params: CompositeStrategyParams = { config };

      const breakoutEngine = new CompositeStrategyEngine('breakout_volume');
      const min = breakoutEngine.minimumDataPointsForParams(params);

      // exit_sma_period=50 should be reflected
      expect(min).toBeGreaterThanOrEqual(50);
    });
  });

  describe('reset', () => {
    it('resets internal state for reuse', () => {
      const config = buildTestConfig();
      const dataPoints = generateOHLCVBars(250, 80, { dailyGain: 0.3 });
      const params: CompositeStrategyParams = { config, primaryDataPoints: dataPoints };

      // Run through some bars
      for (let i = 1; i <= 100; i++) {
        const slice = dataPoints.slice(0, i);
        const priceHistory: PricePoint[] = slice.map(dp => ({
          ticker: 'TEST',
          price: dp.close,
          timestamp: dp.date,
        }));
        engine.evaluate(priceHistory, { config, primaryDataPoints: slice } as any);
      }

      // Reset
      engine.reset();

      // After reset, feeding the same initial data should produce the same result
      const firstSlice = dataPoints.slice(0, 5);
      const firstPriceHistory: PricePoint[] = firstSlice.map(dp => ({
        ticker: 'TEST',
        price: dp.close,
        timestamp: dp.date,
      }));
      const signal = engine.evaluate(firstPriceHistory, { config, primaryDataPoints: firstSlice } as any);

      // With only 5 bars, should return HOLD (insufficient data)
      expect(signal.direction).toBe('HOLD');
    });

    it('allows the engine to be reused after reset', () => {
      const config = buildTestConfig();

      // First run
      const priceHistory1 = generatePricePoints(10, 100);
      engine.evaluate(priceHistory1, { config } as any);

      // Reset
      engine.reset();

      // Second run — should not throw
      const priceHistory2 = generatePricePoints(10, 150);
      const signal = engine.evaluate(priceHistory2, { config } as any);

      expect(signal).toBeDefined();
      expect(signal.direction).toBe('HOLD');
    });
  });

  describe('validateParams', () => {
    it('returns valid for a well-formed config', () => {
      const config = buildTestConfig();
      const result = engine.validateParams({ config } as any);
      expect(result.valid).toBe(true);
    });

    it('returns invalid when config is missing', () => {
      const result = engine.validateParams({} as any);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Missing');
    });
  });
});
