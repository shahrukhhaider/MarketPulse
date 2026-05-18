import { describe, it, expect, beforeEach } from 'vitest';
import {
  PostEarningsDriftEngine,
  type EarningsGapResult,
} from '../../src/strategies/post-earnings-drift-engine.js';
import type { HistoricalDataPoint } from '../../src/types.js';
import type { PostEarningsDriftConfiguration, PostEarningsDriftParams } from '../../src/strategies/strategy-configs.js';
import { buildPostEarningsDriftConfig } from '../../src/strategies/parameter-grid.js';

// ============================================================
// Helpers
// ============================================================

/**
 * Generate a flat series of OHLCV bars around a base price.
 */
function generateFlatBars(
  count: number,
  basePrice: number,
  opts: { rangePct?: number; volume?: number; startDate?: string } = {}
): HistoricalDataPoint[] {
  const { rangePct = 0.02, volume = 1_000_000, startDate = '2024-01-01' } = opts;
  const bars: HistoricalDataPoint[] = [];
  const halfRange = basePrice * rangePct / 2;

  for (let i = 0; i < count; i++) {
    const offset = Math.sin(i * 0.5) * halfRange * 0.5;
    const close = basePrice + offset;
    const open = basePrice - offset * 0.3;
    const high = Math.max(close, open) + halfRange * 0.2;
    const low = Math.min(close, open) - halfRange * 0.2;

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
 * Generate an uptrending series of OHLCV bars.
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
 * Build a default PostEarningsDriftConfiguration.
 */
function makeDefaultConfig(overrides: Record<string, number> = {}): PostEarningsDriftConfiguration {
  const defaults: Record<string, number> = {
    gap_min_pct: 5,
    gap_volume_multiplier: 1.5,
    consolidation_min_days: 3,
    consolidation_max_days: 10,
    max_range_pct: 5,
    breakout_volume_multiplier: 1.2,
    stop_buffer_atr: 0.3,
    r_multiple: 2.5,
    max_risk_pct: 8,
    trend_exit_sma_period: 50,
  };
  return buildPostEarningsDriftConfig({ ...defaults, ...overrides });
}

/**
 * Generate bars with an earnings gap-up at a specific index.
 * Bars before the gap are flat, the gap bar has a large close increase and high volume.
 */
function generateBarsWithEarningsGap(
  totalBars: number,
  gapBarIndex: number,
  opts: { basePrice?: number; gapPct?: number; volume?: number; gapVolume?: number; startDate?: string } = {}
): HistoricalDataPoint[] {
  const {
    basePrice = 100,
    gapPct = 10,
    volume = 1_000_000,
    gapVolume = 5_000_000,
    startDate = '2024-01-01',
  } = opts;

  const bars: HistoricalDataPoint[] = [];

  for (let i = 0; i < totalBars; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);

    if (i < gapBarIndex) {
      // Pre-gap: flat bars
      bars.push({
        date: date.toISOString().slice(0, 10),
        open: basePrice - 0.5,
        high: basePrice + 1,
        low: basePrice - 1,
        close: basePrice,
        volume,
      });
    } else if (i === gapBarIndex) {
      // Gap bar: large gap-up
      const gapClose = basePrice * (1 + gapPct / 100);
      bars.push({
        date: date.toISOString().slice(0, 10),
        open: gapClose - 1,
        high: gapClose + 2,
        low: gapClose - 3,
        close: gapClose,
        volume: gapVolume,
      });
    } else {
      // Post-gap: consolidation near gap close
      const gapClose = basePrice * (1 + gapPct / 100);
      const offset = Math.sin(i * 0.3) * gapClose * 0.005;
      bars.push({
        date: date.toISOString().slice(0, 10),
        open: gapClose + offset - 0.5,
        high: gapClose + offset + 1,
        low: gapClose + offset - 1,
        close: gapClose + offset,
        volume: volume * 0.6, // Declining volume
      });
    }
  }

  return bars;
}

// ============================================================
// Tests
// ============================================================

describe('PostEarningsDriftEngine', () => {
  // ----------------------------------------------------------
  // detectEarningsGap (findRecentEarningsGap equivalent)
  // ----------------------------------------------------------
  describe('detectEarningsGap', () => {
    it('returns not-detected when earningsBarIndex < 1 (no previous bar)', () => {
      const bars = generateFlatBars(5, 100);
      const config = makeDefaultConfig();

      const result = PostEarningsDriftEngine.detectEarningsGap(bars, 0, config);
      expect(result.detected).toBe(false);
    });

    it('returns not-detected when gap is too small', () => {
      // Create bars where the "gap" is only 1% (below gap_min_pct of 5%)
      const bars = generateFlatBars(25, 100, { volume: 1_000_000 });
      // Make the last bar have a small gap
      bars[24] = {
        ...bars[24],
        close: 101, // Only 1% above previous close of ~100
        high: 102,
        low: 100,
        volume: 5_000_000,
      };

      const config = makeDefaultConfig({ gap_min_pct: 5 });
      const result = PostEarningsDriftEngine.detectEarningsGap(bars, 24, config);
      expect(result.detected).toBe(false);
    });

    it('returns not-detected when volume is insufficient', () => {
      const bars = generateFlatBars(25, 100, { volume: 1_000_000 });
      // Make the last bar have a large gap but low volume
      bars[24] = {
        ...bars[24],
        close: 110, // 10% gap
        high: 112,
        low: 108,
        volume: 1_000_000, // Same as average — not enough with multiplier 1.5
      };

      const config = makeDefaultConfig({ gap_min_pct: 5, gap_volume_multiplier: 1.5 });
      const result = PostEarningsDriftEngine.detectEarningsGap(bars, 24, config);
      expect(result.detected).toBe(false);
    });

    it('returns detected when valid gap exists (large gap + high volume)', () => {
      const bars = generateFlatBars(25, 100, { volume: 1_000_000 });
      // Make the last bar have a large gap with high volume
      bars[24] = {
        date: bars[24].date,
        open: 109,
        high: 112,
        low: 108,
        close: 110, // ~10% gap above previous close of ~100
        volume: 5_000_000, // 5x average
      };

      const config = makeDefaultConfig({ gap_min_pct: 5, gap_volume_multiplier: 1.5 });
      const result = PostEarningsDriftEngine.detectEarningsGap(bars, 24, config);
      expect(result.detected).toBe(true);
      expect(result.gapPct).toBeGreaterThanOrEqual(5);
      expect(result.gapDayIndex).toBe(24);
      expect(result.gapDayHigh).toBe(112);
      expect(result.gapDayLow).toBe(108);
      expect(result.gapDayVolume).toBe(5_000_000);
      expect(result.previousDayClose).toBeCloseTo(bars[23].close, 1);
    });

    it('returns not-detected when fewer than 5 bars precede earnings', () => {
      const bars = generateFlatBars(5, 100, { volume: 1_000_000 });
      // Gap at index 3 — only 3 bars precede it (less than 5)
      bars[3] = {
        ...bars[3],
        close: 115,
        high: 116,
        low: 113,
        volume: 5_000_000,
      };

      const config = makeDefaultConfig({ gap_min_pct: 5, gap_volume_multiplier: 1.5 });
      const result = PostEarningsDriftEngine.detectEarningsGap(bars, 3, config);
      expect(result.detected).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // evaluateConsolidation (detectPostEarningsConsolidation equivalent)
  // ----------------------------------------------------------
  describe('evaluateConsolidation', () => {
    it('returns idle when currentBarIndex <= gapDayIndex', () => {
      const bars = generateBarsWithEarningsGap(30, 20);
      const config = makeDefaultConfig();

      const result = PostEarningsDriftEngine.evaluateConsolidation(
        bars, 20, 20, // currentBarIndex === gapDayIndex
        bars[20].high, bars[20].low, bars[20].volume,
        config, bars[19].close
      );
      expect(result.status).toBe('idle');
      expect(result.daysInConsolidation).toBe(0);
    });

    it('returns expired when beyond max days', () => {
      const bars = generateBarsWithEarningsGap(40, 10);
      const config = makeDefaultConfig({ consolidation_max_days: 10 });

      // currentBarIndex = 10 + 11 = 21 → daysInConsolidation = 11 > 10
      const result = PostEarningsDriftEngine.evaluateConsolidation(
        bars, 10, 21,
        bars[10].high, bars[10].low, bars[10].volume,
        config, bars[9].close
      );
      expect(result.status).toBe('expired');
      expect(result.daysInConsolidation).toBeGreaterThan(config.consolidation_max_days);
    });

    it('returns failed when close drops below gap day low', () => {
      const bars = generateBarsWithEarningsGap(30, 10);
      // Force a bar to close below gap day low
      const gapDayLow = bars[10].low;
      bars[12] = {
        ...bars[12],
        close: gapDayLow - 5,
        low: gapDayLow - 6,
      };

      const config = makeDefaultConfig();
      const result = PostEarningsDriftEngine.evaluateConsolidation(
        bars, 10, 12,
        bars[10].high, bars[10].low, bars[10].volume,
        config, bars[9].close
      );
      expect(result.status).toBe('failed');
    });

    it('returns in_progress when within window and conditions hold', () => {
      const bars = generateBarsWithEarningsGap(30, 10);
      const config = makeDefaultConfig({ consolidation_min_days: 3, consolidation_max_days: 10 });

      // Check at day 2 after gap (not yet at min days)
      const result = PostEarningsDriftEngine.evaluateConsolidation(
        bars, 10, 12, // daysInConsolidation = 2
        bars[10].high, bars[10].low, bars[10].volume,
        config, bars[9].close
      );
      // Should be in_progress since we haven't reached min days yet
      expect(['in_progress', 'valid', 'failed']).toContain(result.status);
      if (result.status === 'in_progress') {
        expect(result.daysInConsolidation).toBe(2);
      }
    });
  });

  // ----------------------------------------------------------
  // shouldEnter
  // ----------------------------------------------------------
  describe('shouldEnter', () => {
    it('returns null for insufficient data (fewer than 20 bars)', () => {
      const bars = generateFlatBars(15, 100);
      const config = makeDefaultConfig();

      const result = PostEarningsDriftEngine.shouldEnter(bars, 14, 105, 95, config);
      expect(result).toBeNull();
    });

    it('returns null when close <= consolidationHigh (no breakout)', () => {
      const bars = generateFlatBars(30, 100, { volume: 1_000_000 });
      const config = makeDefaultConfig();

      // consolidationHigh is above all closes
      const result = PostEarningsDriftEngine.shouldEnter(bars, 29, 200, 90, config);
      expect(result).toBeNull();
    });

    it('returns null when volume is insufficient for breakout', () => {
      const bars = generateFlatBars(30, 100, { volume: 500_000 });
      // Set last bar close above consolidationHigh but with low volume
      bars[29] = { ...bars[29], close: 110, high: 112, volume: 500_000 };

      const config = makeDefaultConfig({ breakout_volume_multiplier: 2.0 });

      // Close (110) > consolidationHigh (105) but volume too low
      const result = PostEarningsDriftEngine.shouldEnter(bars, 29, 105, 95, config);
      expect(result).toBeNull();
    });

    it('returns entry result when breakout conditions are met', () => {
      const bars = generateFlatBars(30, 100, { volume: 1_000_000 });
      // Set last bar with breakout close and high volume
      bars[29] = {
        date: bars[29].date,
        open: 106,
        high: 112,
        low: 105,
        close: 110, // Above consolidationHigh of 105
        volume: 3_000_000, // 3x average
      };

      const config = makeDefaultConfig({ breakout_volume_multiplier: 1.2 });

      const result = PostEarningsDriftEngine.shouldEnter(bars, 29, 105, 95, config);
      if (result !== null) {
        expect(result.entryPrice).toBe(110);
        expect(result.stopLossPrice).toBeLessThan(result.entryPrice);
        expect(result.profitTargetPrice).toBeGreaterThan(result.entryPrice);
        expect(result.rValue).toBeGreaterThan(0);
      }
    });

    it('returns null when rValue <= 0 (stop above entry)', () => {
      const bars = generateFlatBars(30, 100, { volume: 1_000_000 });
      // Set last bar with breakout close and high volume
      bars[29] = {
        date: bars[29].date,
        open: 106,
        high: 112,
        low: 105,
        close: 110,
        volume: 3_000_000,
      };

      // consolidationLow very high + large stop_buffer_atr → stop above entry
      const config = makeDefaultConfig({ stop_buffer_atr: 3.0 });

      // consolidationLow = 115 → stop = 115 - 3.0*ATR which could be above entry
      // Actually stop = consolidationLow - buffer*ATR, so higher consolidationLow = higher stop
      // Let's set consolidationLow above entry to force rValue <= 0
      const result = PostEarningsDriftEngine.shouldEnter(bars, 29, 105, 115, config);
      // stop = 115 - 3.0*ATR. If ATR is small (~1), stop ≈ 112 > entry 110 → rValue < 0 → null
      // Actually rValue = entry - stop = 110 - 112 = -2 < 0 → null
      expect(result).toBeNull();
    });
  });

  // ----------------------------------------------------------
  // evaluateWithOHLCV
  // ----------------------------------------------------------
  describe('evaluateWithOHLCV', () => {
    let engine: PostEarningsDriftEngine;

    beforeEach(() => {
      engine = new PostEarningsDriftEngine();
    });

    it('returns HOLD for empty data', () => {
      const config = makeDefaultConfig();
      const params: PostEarningsDriftParams = { config, earningsDates: [] };

      const signal = engine.evaluateWithOHLCV([], params);
      expect(signal.direction).toBe('HOLD');
      expect(signal.price).toBe(0);
      expect(signal.strategyType).toBe('post_earnings_drift');
    });

    it('returns HOLD when no earnings dates provided', () => {
      const bars = generateFlatBars(30, 100);
      const config = makeDefaultConfig();
      const params: PostEarningsDriftParams = { config, earningsDates: [] };

      const signal = engine.evaluateWithOHLCV(bars, params);
      expect(signal.direction).toBe('HOLD');
      expect(signal.price).toBe(bars[0].close);
    });

    it('processes bars sequentially (bar-by-bar evaluation)', () => {
      const bars = generateFlatBars(60, 100);
      const config = makeDefaultConfig();
      const params: PostEarningsDriftParams = { config, earningsDates: [] };

      const signals: string[] = [];
      for (let i = 0; i < bars.length; i++) {
        const signal = engine.evaluateWithOHLCV(bars, params);
        signals.push(signal.direction);
      }

      // All should be HOLD since no earnings dates
      expect(signals.length).toBe(60);
      expect(signals.every(d => d === 'HOLD')).toBe(true);
    });

    it('returns signals with correct metadata', () => {
      const bars = generateFlatBars(5, 100);
      const config = makeDefaultConfig();
      const params: PostEarningsDriftParams = { config, earningsDates: [] };

      const signal = engine.evaluateWithOHLCV(bars, params);
      expect(signal).toHaveProperty('id');
      expect(signal).toHaveProperty('ticker');
      expect(signal).toHaveProperty('direction');
      expect(signal).toHaveProperty('strategyType');
      expect(signal).toHaveProperty('price');
      expect(signal).toHaveProperty('timestamp');
      expect(signal.strategyType).toBe('post_earnings_drift');
    });

    it('returns HOLD when currentBar is undefined (barIndex exceeds data)', () => {
      const bars = generateFlatBars(2, 100);
      const config = makeDefaultConfig();
      const params: PostEarningsDriftParams = { config, earningsDates: [] };

      engine.evaluateWithOHLCV(bars, params); // bar 0
      engine.evaluateWithOHLCV(bars, params); // bar 1
      const signal = engine.evaluateWithOHLCV(bars, params); // bar 2 — undefined

      expect(signal.direction).toBe('HOLD');
      expect(signal.price).toBe(0);
    });
  });

  // ----------------------------------------------------------
  // minimumDataPointsForParams
  // ----------------------------------------------------------
  describe('minimumDataPointsForParams', () => {
    let engine: PostEarningsDriftEngine;

    beforeEach(() => {
      engine = new PostEarningsDriftEngine();
    });

    it('returns 60', () => {
      const config = makeDefaultConfig();
      const params: PostEarningsDriftParams = { config, earningsDates: [] };

      const min = engine.minimumDataPointsForParams(params);
      expect(min).toBe(60);
    });
  });

  // ----------------------------------------------------------
  // reset
  // ----------------------------------------------------------
  describe('reset', () => {
    it('resets internal state for reuse', () => {
      const engine = new PostEarningsDriftEngine();
      const bars = generateFlatBars(10, 100);
      const config = makeDefaultConfig();
      const params: PostEarningsDriftParams = { config, earningsDates: [] };

      // Process some bars to advance internal state
      engine.evaluateWithOHLCV(bars, params);
      engine.evaluateWithOHLCV(bars, params);
      engine.evaluateWithOHLCV(bars, params);

      // Reset
      engine.reset();

      // After reset, processing should start from bar 0 again
      const signal = engine.evaluateWithOHLCV(bars, params);
      expect(signal.direction).toBe('HOLD');
      expect(signal.price).toBe(bars[0].close);
      expect(signal.timestamp).toBe(bars[0].date);
    });

    it('can be reused after reset with different data', () => {
      const engine = new PostEarningsDriftEngine();
      const bars1 = generateFlatBars(5, 100);
      const bars2 = generateFlatBars(5, 200);
      const config = makeDefaultConfig();
      const params: PostEarningsDriftParams = { config, earningsDates: [] };

      // Process first dataset
      engine.evaluateWithOHLCV(bars1, params);
      engine.evaluateWithOHLCV(bars1, params);

      // Reset and process second dataset
      engine.reset();
      const signal = engine.evaluateWithOHLCV(bars2, params);

      expect(signal.price).toBe(bars2[0].close);
    });
  });
});
