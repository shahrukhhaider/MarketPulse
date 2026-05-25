import { describe, it, expect } from 'vitest';
import { detectDirection, isValidBar } from '../../src/strategies/vdu-engine.js';
import type { HistoricalDataPoint } from '../../src/types.js';

// ============================================================
// Helpers
// ============================================================

/**
 * Generate an uptrending series of bars where close prices rise steadily.
 * This ensures SMA(20) > SMA(50), close > SMA(50), and SMA(50) slope positive.
 */
function generateUptrendBars(count: number, startPrice: number): HistoricalDataPoint[] {
  const bars: HistoricalDataPoint[] = [];
  for (let i = 0; i < count; i++) {
    const close = startPrice + i * 0.5; // steady uptrend
    const open = close - 0.2;
    const high = close + 0.3;
    const low = open - 0.1;
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
 * Generate a downtrending series of bars.
 */
function generateDowntrendBars(count: number, startPrice: number): HistoricalDataPoint[] {
  const bars: HistoricalDataPoint[] = [];
  for (let i = 0; i < count; i++) {
    const close = startPrice - i * 0.5; // steady downtrend
    const open = close + 0.2;
    const high = open + 0.1;
    const low = close - 0.3;
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

// ============================================================
// Tests
// ============================================================

describe('detectDirection', () => {
  it('returns false when barIndex < 50', () => {
    const data = generateUptrendBars(100, 50);
    expect(detectDirection(data, 49)).toBe(false);
    expect(detectDirection(data, 0)).toBe(false);
    expect(detectDirection(data, 10)).toBe(false);
  });

  it('returns false when barIndex >= data.length', () => {
    const data = generateUptrendBars(60, 50);
    expect(detectDirection(data, 60)).toBe(false);
    expect(detectDirection(data, 100)).toBe(false);
  });

  it('returns false for empty data', () => {
    expect(detectDirection([], 50)).toBe(false);
  });

  it('returns true for a clear uptrend at barIndex = 50', () => {
    // With 60 bars of steady uptrend starting at 50, by bar 50:
    // close = 50 + 50*0.5 = 75
    // SMA(50) at bar 50 = mean of closes[1..50] = mean(50.5, 51, ..., 75) = 62.75
    // SMA(50) at bar 49 = mean of closes[0..49] = mean(50, 50.5, ..., 74.5) = 62.25
    // SMA(20) at bar 50 = mean of closes[31..50] = mean(65.5, 66, ..., 75) = 70.25
    // close(75) > SMA50(62.75) ✓
    // SMA20(70.25) > SMA50(62.75) ✓
    // SMA50_current(62.75) > SMA50_prev(62.25) ✓
    const data = generateUptrendBars(60, 50);
    expect(detectDirection(data, 50)).toBe(true);
  });

  it('returns false for a downtrend', () => {
    const data = generateDowntrendBars(100, 150);
    // In a downtrend, close < SMA(50) and SMA(50) slope is negative
    expect(detectDirection(data, 50)).toBe(false);
    expect(detectDirection(data, 70)).toBe(false);
  });

  it('returns false when current bar is invalid (NaN close)', () => {
    const data = generateUptrendBars(60, 50);
    data[50] = { ...data[50], close: NaN };
    expect(detectDirection(data, 50)).toBe(false);
  });

  it('returns false when too many bars in the SMA window are invalid', () => {
    const data = generateUptrendBars(60, 50);
    // Invalidate enough bars in the SMA(50) window to make it uncomputable
    for (let i = 1; i <= 10; i++) {
      data[i] = { ...data[i], close: NaN };
    }
    expect(detectDirection(data, 50)).toBe(false);
  });

  it('returns true for barIndex > 50 in a strong uptrend', () => {
    const data = generateUptrendBars(100, 50);
    expect(detectDirection(data, 60)).toBe(true);
    expect(detectDirection(data, 80)).toBe(true);
  });

  it('returns false when close is below SMA(50)', () => {
    // Create data where close drops below SMA(50) at the evaluation bar
    const data = generateUptrendBars(60, 50);
    // Force the last bar's close to be well below SMA(50)
    data[50] = { ...data[50], close: 30 };
    expect(detectDirection(data, 50)).toBe(false);
  });
});
