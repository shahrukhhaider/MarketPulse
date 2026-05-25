import { describe, it, expect } from 'vitest';
import { detectBaseFormation, isValidBar } from '../../src/strategies/vdu-engine.js';
import type { HistoricalDataPoint } from '../../src/types.js';

// ============================================================
// Helpers
// ============================================================

/**
 * Generate a consolidating series of bars with tight range near highs.
 * Prices oscillate in a narrow band around `basePrice`.
 */
function generateConsolidationBars(
  count: number,
  basePrice: number,
  rangePct: number = 2
): HistoricalDataPoint[] {
  const bars: HistoricalDataPoint[] = [];
  const halfRange = (basePrice * rangePct) / 100 / 2;

  for (let i = 0; i < count; i++) {
    // Oscillate close within the range
    const offset = Math.sin(i * 0.5) * halfRange * 0.5;
    const close = basePrice + offset;
    const open = close - 0.1;
    const high = basePrice + halfRange;
    const low = basePrice - halfRange;
    const date = new Date('2024-01-01');
    date.setDate(date.getDate() + i);
    bars.push({
      date: date.toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume: 1_000_000,
    });
  }
  return bars;
}

/**
 * Generate bars with known OHLC values for precise ATR testing.
 * Each bar has the same true range for predictable ATR.
 */
function generateFixedTrBars(
  count: number,
  basePrice: number,
  trueRange: number
): HistoricalDataPoint[] {
  const bars: HistoricalDataPoint[] = [];
  for (let i = 0; i < count; i++) {
    const close = basePrice;
    const open = basePrice;
    const high = basePrice + trueRange / 2;
    const low = basePrice - trueRange / 2;
    const date = new Date('2024-01-01');
    date.setDate(date.getDate() + i);
    bars.push({
      date: date.toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume: 1_000_000,
    });
  }
  return bars;
}

const DEFAULT_PARAMS = {
  consolidation_window: 15,
  proximity_to_highs_pct: 3,
  atr_ratio_threshold: 1.0,
};

// ============================================================
// Tests
// ============================================================

describe('detectBaseFormation', () => {
  describe('invalid inputs — returns zero metrics', () => {
    it('returns zero metrics when barIndex is negative', () => {
      const data = generateConsolidationBars(60, 100);
      const result = detectBaseFormation(data, -1, DEFAULT_PARAMS);
      expect(result).toEqual({ range_pct: 0, proximity_to_highs: 0, atr_ratio: 0 });
    });

    it('returns zero metrics when barIndex >= data.length', () => {
      const data = generateConsolidationBars(60, 100);
      const result = detectBaseFormation(data, 60, DEFAULT_PARAMS);
      expect(result).toEqual({ range_pct: 0, proximity_to_highs: 0, atr_ratio: 0 });
    });

    it('returns zero metrics when insufficient data for consolidation window', () => {
      const data = generateConsolidationBars(10, 100);
      // barIndex=9, window=15 → need bars from index -5 to 9, which is invalid
      const result = detectBaseFormation(data, 9, DEFAULT_PARAMS);
      expect(result).toEqual({ range_pct: 0, proximity_to_highs: 0, atr_ratio: 0 });
    });

    it('returns zero metrics for empty data', () => {
      const result = detectBaseFormation([], 0, DEFAULT_PARAMS);
      expect(result).toEqual({ range_pct: 0, proximity_to_highs: 0, atr_ratio: 0 });
    });

    it('returns zero metrics when current bar is invalid (NaN close)', () => {
      const data = generateConsolidationBars(60, 100);
      data[55] = { ...data[55], close: NaN };
      const result = detectBaseFormation(data, 55, DEFAULT_PARAMS);
      expect(result).toEqual({ range_pct: 0, proximity_to_highs: 0, atr_ratio: 0 });
    });

    it('returns zero metrics when insufficient data for ATR(50) (needs 51 bars)', () => {
      // With barIndex=50, slice is data[0..50] which is 51 elements — just enough for ATR(50)
      // With barIndex=49, slice is data[0..49] which is 50 elements — not enough for ATR(50)
      const data = generateConsolidationBars(50, 100);
      const result = detectBaseFormation(data, 49, {
        ...DEFAULT_PARAMS,
        consolidation_window: 10,
      });
      expect(result).toEqual({ range_pct: 0, proximity_to_highs: 0, atr_ratio: 0 });
    });
  });

  describe('range_pct computation', () => {
    it('computes range_pct as (highest_high - lowest_low) / close * 100', () => {
      // Create bars where we know the exact high/low over the window
      const data = generateFixedTrBars(60, 100, 2); // high=101, low=99 for all bars
      const barIndex = 55;
      const result = detectBaseFormation(data, barIndex, {
        ...DEFAULT_PARAMS,
        consolidation_window: 10,
      });

      // highest_high = 101, lowest_low = 99, close = 100
      // range_pct = (101 - 99) / 100 * 100 = 2%
      expect(result.range_pct).toBeCloseTo(2.0, 5);
    });
  });

  describe('proximity_to_highs computation', () => {
    it('computes proximity_to_highs as (highest_high - close) / highest_high * 100', () => {
      const data = generateFixedTrBars(60, 100, 2); // high=101, close=100
      const barIndex = 55;
      const result = detectBaseFormation(data, barIndex, {
        ...DEFAULT_PARAMS,
        consolidation_window: 10,
      });

      // highest_high = 101, close = 100
      // proximity_to_highs = (101 - 100) / 101 * 100 ≈ 0.99%
      expect(result.proximity_to_highs).toBeCloseTo((1 / 101) * 100, 5);
    });

    it('returns 0 proximity when close equals highest high', () => {
      // Create bars where the last bar's close equals the highest high
      const data = generateFixedTrBars(60, 100, 2);
      // Set the current bar's close to equal the highest high in the window
      data[55] = { ...data[55], close: 101, high: 101 };
      const barIndex = 55;
      const result = detectBaseFormation(data, barIndex, {
        ...DEFAULT_PARAMS,
        consolidation_window: 10,
      });

      expect(result.proximity_to_highs).toBeCloseTo(0, 5);
    });
  });

  describe('atr_ratio computation', () => {
    it('computes atr_ratio as ATR(14) / ATR(50) with uniform true range', () => {
      // When all bars have the same true range, ATR(14) == ATR(50)
      const data = generateFixedTrBars(60, 100, 2);
      const barIndex = 55;
      const result = detectBaseFormation(data, barIndex, {
        ...DEFAULT_PARAMS,
        consolidation_window: 10,
      });

      // With uniform true range, ATR(14)/ATR(50) should be 1.0
      expect(result.atr_ratio).toBeCloseTo(1.0, 5);
    });

    it('atr_ratio < 1 when recent volatility is lower than long-term', () => {
      // First 40 bars with high true range, then 20 bars with low true range
      const highVolBars = generateFixedTrBars(40, 100, 4); // TR = 4
      const lowVolBars = generateFixedTrBars(20, 100, 1);  // TR = 1

      const data = [...highVolBars, ...lowVolBars];
      const barIndex = 59;
      const result = detectBaseFormation(data, barIndex, {
        ...DEFAULT_PARAMS,
        consolidation_window: 10,
      });

      // ATR(14) should be based on the last 14 bars (all low vol, TR=1) → ATR14 ≈ 1
      // ATR(50) should be a mix of high and low vol bars → ATR50 > 1
      // So atr_ratio should be < 1
      expect(result.atr_ratio).toBeLessThan(1.0);
      expect(result.atr_ratio).toBeGreaterThan(0);
    });
  });

  describe('skips invalid bars in window', () => {
    it('still computes metrics when some bars in window are invalid', () => {
      const data = generateFixedTrBars(60, 100, 2);
      // Invalidate one bar in the consolidation window (but not the current bar)
      data[50] = { ...data[50], close: -1 }; // invalid: negative close
      const barIndex = 55;
      const result = detectBaseFormation(data, barIndex, {
        ...DEFAULT_PARAMS,
        consolidation_window: 10,
      });

      // Should still compute from the remaining valid bars
      // The invalid bar is excluded from high/low computation
      expect(result.range_pct).toBeGreaterThan(0);
      expect(result.atr_ratio).toBeGreaterThan(0);
    });
  });
});
