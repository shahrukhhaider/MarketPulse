import { describe, it, expect } from 'vitest';
import { computeSuperTrend, DEFAULT_SUPERTREND_PARAMS } from '../../src/indicators/supertrend.js';
import type { HistoricalDataPoint } from '../../src/types.js';

function makeBar(overrides: Partial<HistoricalDataPoint> = {}): HistoricalDataPoint {
  return {
    date: '2024-01-01',
    open: 100,
    high: 105,
    low: 95,
    close: 100,
    volume: 1000,
    ...overrides,
  };
}

/**
 * Generate a series of bars with controlled price movement.
 */
function generateBars(
  count: number,
  startClose: number,
  increment: number,
  spread: number = 5
): HistoricalDataPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const close = startClose + i * increment;
    return makeBar({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      open: close - increment * 0.5,
      high: close + spread,
      low: close - spread,
      close,
      volume: 1000 + i * 100,
    });
  });
}

describe('computeSuperTrend', () => {
  // ============================================================
  // Insufficient data
  // ============================================================

  it('returns empty array when data.length < period + 1 (default period=26)', () => {
    const data = generateBars(26, 100, 1); // Exactly 26 bars, need 27
    const result = computeSuperTrend(data);
    expect(result).toEqual([]);
  });

  it('returns empty array when data is empty', () => {
    expect(computeSuperTrend([])).toEqual([]);
  });

  it('returns empty array for single bar', () => {
    expect(computeSuperTrend([makeBar()])).toEqual([]);
  });

  // ============================================================
  // Basic output structure
  // ============================================================

  it('returns correct number of bars (data.length - period)', () => {
    const period = 5;
    const data = generateBars(20, 100, 1);
    const result = computeSuperTrend(data, { period, multiplier: 2, source: 'low' });
    // Should return data.length - period bars
    expect(result.length).toBe(20 - period);
  });

  it('starts with bullish trend (trend=1)', () => {
    const period = 5;
    const data = generateBars(20, 100, 1, 3);
    const result = computeSuperTrend(data, { period, multiplier: 2, source: 'low' });
    expect(result[0].trend).toBe(1);
  });

  it('each bar has trend, upperBand, and lowerBand properties', () => {
    const period = 5;
    const data = generateBars(10, 100, 1);
    const result = computeSuperTrend(data, { period, multiplier: 2, source: 'low' });
    for (const bar of result) {
      expect(bar).toHaveProperty('trend');
      expect(bar).toHaveProperty('upperBand');
      expect(bar).toHaveProperty('lowerBand');
      expect([1, -1]).toContain(bar.trend);
      expect(typeof bar.upperBand).toBe('number');
      expect(typeof bar.lowerBand).toBe('number');
    }
  });

  // ============================================================
  // Basic uptrend (stays bullish)
  // ============================================================

  it('stays bullish in a steady uptrend', () => {
    const period = 5;
    // Strong uptrend: close rises well above any lower band
    const data = generateBars(30, 100, 3, 2);
    const result = computeSuperTrend(data, { period, multiplier: 1.5, source: 'low' });
    // All bars should remain bullish since close never drops below lower band
    for (const bar of result) {
      expect(bar.trend).toBe(1);
    }
  });

  // ============================================================
  // Basic downtrend (flips to bearish)
  // ============================================================

  it('flips to bearish in a strong downtrend', () => {
    const period = 5;
    // Start flat then drop sharply
    const flatBars = generateBars(10, 100, 0, 2);
    const dropBars = generateBars(20, 95, -5, 2);
    const data = [...flatBars, ...dropBars];
    const result = computeSuperTrend(data, { period, multiplier: 1.5, source: 'low' });
    // At some point the trend should flip to -1
    const hasBearish = result.some(bar => bar.trend === -1);
    expect(hasBearish).toBe(true);
  });

  // ============================================================
  // Trend flip from bullish to bearish
  // ============================================================

  it('flips from bullish to bearish when close drops below lower band', () => {
    const period = 3;
    // Build data: uptrend then sudden crash
    const upBars = generateBars(8, 100, 2, 3);
    // Crash: close drops far below where the lower band would be
    const crashBars = generateBars(5, 80, -5, 2);
    const data = [...upBars, ...crashBars];
    const result = computeSuperTrend(data, { period, multiplier: 1.5, source: 'low' });

    // First bar starts bullish
    expect(result[0].trend).toBe(1);
    // Should eventually flip to bearish
    const bearishIdx = result.findIndex(bar => bar.trend === -1);
    expect(bearishIdx).toBeGreaterThan(0);
  });

  // ============================================================
  // Trend flip from bearish to bullish
  // ============================================================

  it('flips from bearish to bullish when close rises above upper band', () => {
    const period = 3;
    // Start with a downtrend to establish bearish, then strong recovery
    const downBars = generateBars(8, 120, -4, 2);
    const recoveryBars = generateBars(8, 100, 8, 3);
    const data = [...downBars, ...recoveryBars];
    const result = computeSuperTrend(data, { period, multiplier: 1.5, source: 'low' });

    // Should have bearish bars followed by bullish bars
    const hasBearish = result.some(bar => bar.trend === -1);
    const hasBullish = result.some(bar => bar.trend === 1);
    expect(hasBearish).toBe(true);
    expect(hasBullish).toBe(true);

    // Find the transition point: bearish then bullish
    let foundTransition = false;
    for (let i = 1; i < result.length; i++) {
      if (result[i - 1].trend === -1 && result[i].trend === 1) {
        foundTransition = true;
        break;
      }
    }
    expect(foundTransition).toBe(true);
  });

  // ============================================================
  // Band ratcheting behavior
  // ============================================================

  it('lower band only ratchets up (never decreases) during bullish trend', () => {
    const period = 3;
    // Steady uptrend — lower band should only increase
    const data = generateBars(20, 100, 2, 3);
    const result = computeSuperTrend(data, { period, multiplier: 1.5, source: 'low' });

    // Filter to only bullish bars and check lower band is non-decreasing
    let prevLowerBand = -Infinity;
    for (const bar of result) {
      if (bar.trend === 1) {
        expect(bar.lowerBand).toBeGreaterThanOrEqual(prevLowerBand - 1e-10);
        prevLowerBand = bar.lowerBand;
      }
    }
  });

  it('upper band only ratchets down (never increases) during bearish trend', () => {
    const period = 3;
    // Steady downtrend — upper band should only decrease
    const data = generateBars(20, 200, -3, 3);
    const result = computeSuperTrend(data, { period, multiplier: 1.5, source: 'low' });

    // Find bearish bars and check upper band is non-increasing
    let prevUpperBand = Infinity;
    let bearishCount = 0;
    for (const bar of result) {
      if (bar.trend === -1) {
        expect(bar.upperBand).toBeLessThanOrEqual(prevUpperBand + 1e-10);
        prevUpperBand = bar.upperBand;
        bearishCount++;
      }
    }
    // Ensure we actually tested some bearish bars
    expect(bearishCount).toBeGreaterThan(0);
  });

  // ============================================================
  // Custom params (different period/multiplier)
  // ============================================================

  it('works with custom period and multiplier', () => {
    const data = generateBars(30, 100, 1, 4);
    const result = computeSuperTrend(data, { period: 10, multiplier: 2.0, source: 'close' });
    // Should return data.length - period bars
    expect(result.length).toBe(30 - 10);
    expect(result[0].trend).toBe(1);
  });

  it('higher multiplier produces wider bands', () => {
    const period = 5;
    const data = generateBars(20, 100, 1, 4);
    const narrowResult = computeSuperTrend(data, { period, multiplier: 1.0, source: 'low' });
    const wideResult = computeSuperTrend(data, { period, multiplier: 3.0, source: 'low' });

    // First bar: wider multiplier should produce wider spread between bands
    const narrowSpread = narrowResult[0].upperBand - narrowResult[0].lowerBand;
    const wideSpread = wideResult[0].upperBand - wideResult[0].lowerBand;
    expect(wideSpread).toBeGreaterThan(narrowSpread);
  });

  it('shorter period makes indicator more responsive', () => {
    // With a shorter period, the ATR is computed over fewer bars,
    // and the indicator starts producing results sooner
    const data = generateBars(30, 100, 1, 4);
    const shortResult = computeSuperTrend(data, { period: 3, multiplier: 2, source: 'low' });
    const longResult = computeSuperTrend(data, { period: 10, multiplier: 2, source: 'low' });
    // Short period produces more output bars
    expect(shortResult.length).toBeGreaterThan(longResult.length);
  });

  // ============================================================
  // Different source types (hl2, hlc3)
  // ============================================================

  it('uses hl2 source correctly', () => {
    const period = 3;
    const data = generateBars(10, 100, 1, 5);
    const result = computeSuperTrend(data, { period, multiplier: 2, source: 'hl2' });
    expect(result.length).toBe(10 - period);
    // hl2 = (high + low) / 2, bands should be centered around this
    // Just verify it produces valid output
    expect(result[0].upperBand).toBeGreaterThan(result[0].lowerBand);
  });

  it('uses hlc3 source correctly', () => {
    const period = 3;
    const data = generateBars(10, 100, 1, 5);
    const result = computeSuperTrend(data, { period, multiplier: 2, source: 'hlc3' });
    expect(result.length).toBe(10 - period);
    expect(result[0].upperBand).toBeGreaterThan(result[0].lowerBand);
  });

  it('different sources produce different band values', () => {
    const period = 5;
    // Create asymmetric data where close != (high+low)/2
    // high = close + 7, low = close - 3, so hl2 = close + 2, hlc3 = close + 4/3
    const data = Array.from({ length: 15 }, (_, i) => {
      const close = 100 + i * 1.5;
      return makeBar({
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        open: close - 1,
        high: close + 7,
        low: close - 3,
        close,
        volume: 1000 + i * 100,
      });
    });
    const lowResult = computeSuperTrend(data, { period, multiplier: 2, source: 'low' });
    const hl2Result = computeSuperTrend(data, { period, multiplier: 2, source: 'hl2' });
    const hlc3Result = computeSuperTrend(data, { period, multiplier: 2, source: 'hlc3' });
    const closeResult = computeSuperTrend(data, { period, multiplier: 2, source: 'close' });

    // low source uses close - 3, hl2 uses close + 2, close uses close, hlc3 uses close + 4/3
    // All should produce different band values
    expect(lowResult[0].lowerBand).not.toBe(hl2Result[0].lowerBand);
    expect(hl2Result[0].lowerBand).not.toBe(closeResult[0].lowerBand);
    expect(hlc3Result[0].upperBand).not.toBe(hl2Result[0].upperBand);
  });

  // ============================================================
  // Default params
  // ============================================================

  it('uses default params when none provided', () => {
    const data = generateBars(30, 100, 1, 4);
    const resultDefault = computeSuperTrend(data);
    const resultExplicit = computeSuperTrend(data, DEFAULT_SUPERTREND_PARAMS);
    // Both should produce identical results
    expect(resultDefault).toEqual(resultExplicit);
  });

  it('partial params merge with defaults', () => {
    const data = generateBars(30, 100, 1, 4);
    // Only override multiplier, period and source should use defaults
    const result = computeSuperTrend(data, { multiplier: 5.0 });
    // Should still use default period=26, so output length = 30 - 26 = 4
    expect(result.length).toBe(30 - 26);
  });
});
