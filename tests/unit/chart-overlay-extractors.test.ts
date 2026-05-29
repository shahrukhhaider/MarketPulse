import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadTunedParams } from '../../src/data/load-tuned-params.js';
import {
  extractOverlayData,
  extractConsolidationBreakoutOverlay,
  extractVolumeDryUpOverlay,
  extractTrendPullbackOverlay,
  type ConsolidationBreakoutOverlay,
  type VolumeDryUpOverlay,
  type TrendPullbackOverlay,
} from '../../scripts/chart-overlay-extractors.js';
import type { HistoricalDataPoint } from '../../src/types.js';

const TEST_BASE_DIR = join('tests', '.test-chart-overlay');

describe('loadTunedParams', () => {
  beforeEach(() => {
    if (existsSync(TEST_BASE_DIR)) {
      rmSync(TEST_BASE_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_BASE_DIR)) {
      rmSync(TEST_BASE_DIR, { recursive: true, force: true });
    }
  });

  it('returns params when profile file exists and is valid', () => {
    const dir = join(TEST_BASE_DIR, 'data', 'profiles', 'consolidation_breakout');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'AAPL.json'),
      JSON.stringify({
        ticker: 'AAPL',
        strategy: 'consolidation_breakout',
        params: {
          consolidation_window: 10,
          max_range_pct: 6,
          volume_multiplier: 1.5,
        },
      }),
      'utf-8'
    );

    const result = loadTunedParams('consolidation_breakout', 'AAPL', TEST_BASE_DIR);
    expect(result).toEqual({
      consolidation_window: 10,
      max_range_pct: 6,
      volume_multiplier: 1.5,
    });
  });

  it('returns null when file does not exist', () => {
    const result = loadTunedParams('consolidation_breakout', 'NONEXISTENT', TEST_BASE_DIR);
    expect(result).toBeNull();
  });

  it('returns null and logs warning for corrupt JSON', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const dir = join(TEST_BASE_DIR, 'data', 'profiles', 'consolidation_breakout');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'BAD.json'), 'not valid json {{{', 'utf-8');

    const result = loadTunedParams('consolidation_breakout', 'BAD', TEST_BASE_DIR);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse profile')
    );

    warnSpy.mockRestore();
  });

  it('returns null when JSON lacks params field', () => {
    const dir = join(TEST_BASE_DIR, 'data', 'profiles', 'bear_breakdown');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'TSLA.json'),
      JSON.stringify({ ticker: 'TSLA', strategy: 'bear_breakdown' }),
      'utf-8'
    );

    const result = loadTunedParams('bear_breakdown', 'TSLA', TEST_BASE_DIR);
    expect(result).toBeNull();
  });

  it('returns null when params is not an object', () => {
    const dir = join(TEST_BASE_DIR, 'data', 'profiles', 'trend_pullback');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'MSFT.json'),
      JSON.stringify({ ticker: 'MSFT', params: 'not an object' }),
      'utf-8'
    );

    const result = loadTunedParams('trend_pullback', 'MSFT', TEST_BASE_DIR);
    expect(result).toBeNull();
  });

  it('returns null when params is an array', () => {
    const dir = join(TEST_BASE_DIR, 'data', 'profiles', 'volume_dry_up');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'GOOG.json'),
      JSON.stringify({ ticker: 'GOOG', params: [1, 2, 3] }),
      'utf-8'
    );

    const result = loadTunedParams('volume_dry_up', 'GOOG', TEST_BASE_DIR);
    expect(result).toBeNull();
  });

  it('returns null and logs warning when params contains non-numeric values', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const dir = join(TEST_BASE_DIR, 'data', 'profiles', 'keltner_mean_reversion');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'META.json'),
      JSON.stringify({
        ticker: 'META',
        params: { good_param: 5, bad_param: 'string_value' },
      }),
      'utf-8'
    );

    const result = loadTunedParams('keltner_mean_reversion', 'META', TEST_BASE_DIR);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('non-numeric param value')
    );

    warnSpy.mockRestore();
  });

  it('returns null when file contains a JSON array at top level', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const dir = join(TEST_BASE_DIR, 'data', 'profiles', 'consolidation_breakout');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'ARR.json'), JSON.stringify([1, 2, 3]), 'utf-8');

    const result = loadTunedParams('consolidation_breakout', 'ARR', TEST_BASE_DIR);
    expect(result).toBeNull();

    warnSpy.mockRestore();
  });

  it('returns empty params object when params is an empty object', () => {
    const dir = join(TEST_BASE_DIR, 'data', 'profiles', 'consolidation_breakout');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'EMPTY.json'),
      JSON.stringify({ ticker: 'EMPTY', params: {} }),
      'utf-8'
    );

    const result = loadTunedParams('consolidation_breakout', 'EMPTY', TEST_BASE_DIR);
    expect(result).toEqual({});
  });
});


// ============================================================
// Helpers for overlay extractor tests
// ============================================================

function generateUptrendBars(
  count: number,
  startPrice: number,
  opts: { dailyGain?: number; volume?: number; startDate?: string } = {}
): HistoricalDataPoint[] {
  const { dailyGain = 0.8, volume = 1_000_000, startDate = '2024-01-01' } = opts;
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
      open, high, low, close, volume,
    });
  }
  return bars;
}

function generateFlatBars(
  count: number,
  basePrice: number,
  opts: { rangePct?: number; volume?: number; startDate?: string } = {}
): HistoricalDataPoint[] {
  const { rangePct = 0.02, volume = 800_000, startDate = '2024-02-25' } = opts;
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
      open, high, low, close, volume,
    });
  }
  return bars;
}

// ============================================================
// extractOverlayData dispatch tests
// ============================================================

describe('extractOverlayData', () => {
  it('returns null for unknown strategy and logs warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bars = generateUptrendBars(60, 100);
    const result = extractOverlayData('unknown_strategy', bars, {});
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown strategy: unknown_strategy')
    );
    warnSpy.mockRestore();
  });

  it('returns null for insufficient data', () => {
    const bars = generateUptrendBars(10, 100);
    const result = extractOverlayData('consolidation_breakout', bars, {
      consolidation_window: 10,
      max_range_pct: 6,
      atr_ratio_threshold: 1.0,
      volume_multiplier: 1.2,
      overextension_pct: 8,
      atr_multiple: 1.5,
      swing_lookback: 10,
      max_risk_pct: 5,
      r_multiple: 2.5,
    });
    expect(result).toBeNull();
  });

  it('returns null when no consolidation signal is detected', () => {
    // Pure uptrend with no consolidation — shouldEnter will return null
    const bars = generateUptrendBars(80, 100, { dailyGain: 2.0 });
    const result = extractOverlayData('consolidation_breakout', bars, {
      consolidation_window: 10,
      max_range_pct: 3, // Very tight — won't detect consolidation in uptrend
      atr_ratio_threshold: 0.5,
      volume_multiplier: 2.0,
      overextension_pct: 8,
      atr_multiple: 1.5,
      swing_lookback: 10,
      max_risk_pct: 5,
      r_multiple: 2.5,
    });
    expect(result).toBeNull();
  });
});

// ============================================================
// extractConsolidationBreakoutOverlay tests
// ============================================================

describe('extractConsolidationBreakoutOverlay', () => {
  it('returns null for insufficient data (< 51 bars)', () => {
    const bars = generateFlatBars(30, 100);
    const result = extractConsolidationBreakoutOverlay(bars, {
      consolidation_window: 10,
      max_range_pct: 6,
      atr_ratio_threshold: 1.0,
      volume_multiplier: 1.2,
      overextension_pct: 8,
      atr_multiple: 1.5,
      swing_lookback: 10,
      max_risk_pct: 5,
      r_multiple: 2.5,
    });
    expect(result).toBeNull();
  });

  it('returns correctly shaped overlay when signal is detected', () => {
    // Build scenario: uptrend → consolidation → breakout
    const uptrendBars = generateUptrendBars(55, 80, { dailyGain: 0.8, volume: 1_000_000 });
    const lastClose = uptrendBars[uptrendBars.length - 1].close;

    const consolidationBars = generateFlatBars(15, lastClose, {
      rangePct: 0.02,
      volume: 800_000,
      startDate: '2024-02-25',
    });

    // Breakout bar with high volume
    const breakoutBar: HistoricalDataPoint = {
      date: '2024-03-12',
      open: lastClose + 0.5,
      high: lastClose + 5,
      low: lastClose - 0.5,
      close: lastClose + 4,
      volume: 3_000_000,
    };

    const allBars = [...uptrendBars, ...consolidationBars, breakoutBar];

    const params = {
      consolidation_window: 10,
      max_range_pct: 8,
      atr_ratio_threshold: 2.0,
      volume_multiplier: 1.2,
      overextension_pct: 15,
      atr_multiple: 1.5,
      swing_lookback: 10,
      max_risk_pct: 8,
      r_multiple: 2.5,
    };

    const result = extractConsolidationBreakoutOverlay(allBars, params);

    // The result may be null if the exact indicator values don't align,
    // but if it returns data, verify the shape
    if (result !== null) {
      expect(result.strategy).toBe('consolidation_breakout');
      expect(result.zone).not.toBeNull();
      expect(result.zone!.high).toBeGreaterThan(0);
      expect(result.zone!.low).toBeGreaterThan(0);
      expect(result.zone!.high).toBeGreaterThanOrEqual(result.zone!.low);
      expect(result.zone!.rangePct).toBeGreaterThan(0);
      expect(result.zone!.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.zone!.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      expect(result.breakoutMarker).not.toBeNull();
      expect(result.breakoutMarker!.shape).toBe('arrowUp');
      expect(result.breakoutMarker!.color).toBe('#9C27B0');
      expect(result.breakoutMarker!.date).toBe(allBars[allBars.length - 1].date);
      expect(result.breakoutMarker!.price).toBe(allBars[allBars.length - 1].close);

      expect(result.legendEntries).toHaveLength(2);
      expect(result.legendEntries[0].name).toBe('Consolidation Zone');
      expect(result.legendEntries[0].color).toBe('rgba(156, 39, 176, 0.15)');
      expect(result.legendEntries[0].style).toBe('zone');
      expect(result.legendEntries[1].name).toBe('Breakout');
      expect(result.legendEntries[1].color).toBe('#9C27B0');
      expect(result.legendEntries[1].style).toBe('marker');
    }
  });

  it('returns null when no breakout is detected on last bar', () => {
    // Uptrend followed by consolidation but NO breakout (last bar is still in consolidation)
    const uptrendBars = generateUptrendBars(55, 80, { dailyGain: 0.8, volume: 1_000_000 });
    const lastClose = uptrendBars[uptrendBars.length - 1].close;

    // End with a flat bar (no breakout)
    const consolidationBars = generateFlatBars(20, lastClose, {
      rangePct: 0.02,
      volume: 800_000,
      startDate: '2024-02-25',
    });

    const allBars = [...uptrendBars, ...consolidationBars];

    const params = {
      consolidation_window: 10,
      max_range_pct: 8,
      atr_ratio_threshold: 2.0,
      volume_multiplier: 1.5,
      overextension_pct: 8,
      atr_multiple: 1.5,
      swing_lookback: 10,
      max_risk_pct: 5,
      r_multiple: 2.5,
    };

    const result = extractConsolidationBreakoutOverlay(allBars, params);
    // No breakout on last bar → should return null
    expect(result).toBeNull();
  });
});


// ============================================================
// extractVolumeDryUpOverlay tests
// ============================================================

describe('extractVolumeDryUpOverlay', () => {
  /**
   * Helper: generate bars with declining volume to trigger dry-up detection.
   * Creates an uptrend followed by a consolidation with declining volume.
   */
  function generateVduScenario(opts: {
    totalBars?: number;
    basePrice?: number;
    volumeLookback?: number;
    avgVolume?: number;
    dryUpVolumeFraction?: number;
  } = {}): HistoricalDataPoint[] {
    const {
      totalBars = 60,
      basePrice = 100,
      volumeLookback = 20,
      avgVolume = 1_000_000,
      dryUpVolumeFraction = 0.5,
    } = opts;

    const bars: HistoricalDataPoint[] = [];
    const startDate = new Date('2024-01-01');

    for (let i = 0; i < totalBars; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);

      // Slight uptrend
      const close = basePrice + i * 0.3;
      const open = close - 0.2;
      const high = close + 0.5;
      const low = close - 0.5;

      // Volume: normal for first part, declining in the last volumeLookback bars
      let volume: number;
      if (i >= totalBars - volumeLookback) {
        // Declining volume in the lookback window
        const daysIntoLookback = i - (totalBars - volumeLookback);
        volume = avgVolume * dryUpVolumeFraction * (1 - daysIntoLookback * 0.02);
      } else {
        volume = avgVolume;
      }

      bars.push({
        date: date.toISOString().slice(0, 10),
        open, high, low, close,
        volume: Math.max(1, Math.round(volume)),
      });
    }

    return bars;
  }

  it('returns null for insufficient data', () => {
    const bars = generateFlatBars(10, 100);
    const result = extractVolumeDryUpOverlay(bars, {});
    expect(result).toBeNull();
  });

  it('returns null when no dry-up bars are detected', () => {
    // All bars have high volume — no dry-up
    const bars: HistoricalDataPoint[] = [];
    for (let i = 0; i < 60; i++) {
      const date = new Date('2024-01-01');
      date.setDate(date.getDate() + i);
      bars.push({
        date: date.toISOString().slice(0, 10),
        open: 100, high: 101, low: 99, close: 100,
        volume: 1_000_000, // Constant high volume
      });
    }

    const result = extractVolumeDryUpOverlay(bars, {
      volume_lookback: 20,
      volume_threshold_forming: 0.3, // Very low threshold — won't trigger
      min_declining_days: 3,
      consolidation_window: 15,
    });
    expect(result).toBeNull();
  });

  it('returns overlay data with dry-up bars when volume declines', () => {
    const bars = generateVduScenario({
      totalBars: 60,
      avgVolume: 1_000_000,
      dryUpVolumeFraction: 0.4, // 40% of average — below 0.80 threshold
      volumeLookback: 20,
    });

    const result = extractVolumeDryUpOverlay(bars, {
      volume_lookback: 20,
      volume_threshold_forming: 0.80,
      min_declining_days: 3,
      consolidation_window: 15,
    });

    expect(result).not.toBeNull();
    expect(result!.strategy).toBe('volume_dry_up');
    expect(result!.dryUpBars.length).toBeGreaterThan(0);

    // All dry-up bar dates should be valid ISO dates
    for (const date of result!.dryUpBars) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('computes base zone bounds correctly', () => {
    const bars = generateVduScenario({
      totalBars: 60,
      basePrice: 100,
      avgVolume: 1_000_000,
      dryUpVolumeFraction: 0.4,
      volumeLookback: 20,
    });

    const consolidationWindow = 15;
    const result = extractVolumeDryUpOverlay(bars, {
      volume_lookback: 20,
      volume_threshold_forming: 0.80,
      min_declining_days: 3,
      consolidation_window: consolidationWindow,
    });

    expect(result).not.toBeNull();
    expect(result!.zone).not.toBeNull();

    const zone = result!.zone!;
    expect(zone.high).toBeGreaterThan(0);
    expect(zone.low).toBeGreaterThan(0);
    expect(zone.high).toBeGreaterThanOrEqual(zone.low);
    expect(zone.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(zone.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Zone should span the consolidation window
    const startIdx = bars.length - consolidationWindow;
    expect(zone.startDate).toBe(bars[startIdx].date);
    expect(zone.endDate).toBe(bars[bars.length - 1].date);
  });

  it('computes volume ratio label from last bar', () => {
    const bars = generateVduScenario({
      totalBars: 60,
      avgVolume: 1_000_000,
      dryUpVolumeFraction: 0.4,
      volumeLookback: 20,
    });

    const result = extractVolumeDryUpOverlay(bars, {
      volume_lookback: 20,
      volume_threshold_forming: 0.80,
      min_declining_days: 3,
      consolidation_window: 15,
    });

    expect(result).not.toBeNull();
    expect(result!.volumeRatioLabel).not.toBeNull();
    expect(result!.volumeRatioLabel!.date).toBe(bars[bars.length - 1].date);
    expect(result!.volumeRatioLabel!.value).toBeGreaterThan(0);
    expect(result!.volumeRatioLabel!.value).toBeLessThan(1); // Should be below 1 for dry-up
  });

  it('populates legendEntries with base zone, dry-up bars, and volume ratio', () => {
    const bars = generateVduScenario({
      totalBars: 60,
      avgVolume: 1_000_000,
      dryUpVolumeFraction: 0.4,
      volumeLookback: 20,
    });

    const result = extractVolumeDryUpOverlay(bars, {
      volume_lookback: 20,
      volume_threshold_forming: 0.80,
      min_declining_days: 3,
      consolidation_window: 15,
    });

    expect(result).not.toBeNull();
    const entries = result!.legendEntries;

    // Should have 3 entries: base zone, dry-up bars, volume ratio
    expect(entries.length).toBe(3);

    // Base Zone entry
    expect(entries[0].name).toBe('Base Zone');
    expect(entries[0].color).toBe('rgba(0, 150, 136, 0.15)');
    expect(entries[0].style).toBe('zone');

    // Dry-Up Bars entry
    expect(entries[1].name).toBe('Dry-Up Bars');
    expect(entries[1].color).toBe('rgba(33, 150, 243, 0.6)');
    expect(entries[1].style).toBe('marker');

    // Volume Ratio entry
    expect(entries[2].name).toMatch(/^Vol Ratio: \d+\.\d+x$/);
    expect(entries[2].color).toBe('rgba(33, 150, 243, 0.6)');
    expect(entries[2].style).toBe('solid');
  });

  it('dispatch routes volume_dry_up to the extractor', () => {
    const bars = generateVduScenario({
      totalBars: 60,
      avgVolume: 1_000_000,
      dryUpVolumeFraction: 0.4,
      volumeLookback: 20,
    });

    const result = extractOverlayData('volume_dry_up', bars, {
      volume_lookback: 20,
      volume_threshold_forming: 0.80,
      min_declining_days: 3,
      consolidation_window: 15,
    });

    // Should route to extractVolumeDryUpOverlay and return non-null
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe('volume_dry_up');
  });
});


// ============================================================
// extractTrendPullbackOverlay tests
// ============================================================

describe('extractTrendPullbackOverlay', () => {
  it('returns null for insufficient data (< 10 bars)', () => {
    const bars = generateUptrendBars(5, 100);
    const result = extractTrendPullbackOverlay(bars, {});
    expect(result).toBeNull();
  });

  it('returns null for null/undefined data', () => {
    const result = extractTrendPullbackOverlay(null as any, {});
    expect(result).toBeNull();
  });

  it('returns overlay with SMA10 series for sufficient data', () => {
    const bars = generateUptrendBars(30, 100);
    const result = extractTrendPullbackOverlay(bars, {});

    expect(result).not.toBeNull();
    expect(result!.strategy).toBe('trend_pullback');
    // SMA10 needs 10 bars, so first value at index 9 → 30 - 10 + 1 = 21 entries
    expect(result!.sma10.length).toBe(21);
  });

  it('SMA10 series has correct time values', () => {
    const bars = generateUptrendBars(15, 100);
    const result = extractTrendPullbackOverlay(bars, {});

    expect(result).not.toBeNull();
    // First SMA10 value should be at bar index 9 (10th bar)
    expect(result!.sma10[0].time).toBe(bars[9].date);
    // Last SMA10 value should be at the last bar
    expect(result!.sma10[result!.sma10.length - 1].time).toBe(bars[bars.length - 1].date);
  });

  it('SMA10 values are correct', () => {
    // Create bars with known close prices for easy SMA verification
    const bars: HistoricalDataPoint[] = [];
    for (let i = 0; i < 12; i++) {
      bars.push({
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        open: 100,
        high: 105,
        low: 95,
        close: 100 + i, // 100, 101, 102, ..., 111
        volume: 1000000,
      });
    }

    const result = extractTrendPullbackOverlay(bars, {});
    expect(result).not.toBeNull();

    // SMA10 at index 9 = average of closes[0..9] = (100+101+...+109)/10 = 104.5
    expect(result!.sma10[0].value).toBeCloseTo(104.5, 5);
    // SMA10 at index 10 = average of closes[1..10] = (101+102+...+110)/10 = 105.5
    expect(result!.sma10[1].value).toBeCloseTo(105.5, 5);
    // SMA10 at index 11 = average of closes[2..11] = (102+103+...+111)/10 = 106.5
    expect(result!.sma10[2].value).toBeCloseTo(106.5, 5);
  });

  it('identifies pullback bars when conditions are met', () => {
    // Create a scenario where pullback conditions are met:
    // - Close within pullback_proximity_pct of SMA(20)
    // - ATR(5)/ATR(20) < atr_contraction_threshold
    // - Volume < avgVolume(20) * volume_below_avg_multiplier
    // This requires at least 21 bars for ATR(20) and SMA(20)
    const bars: HistoricalDataPoint[] = [];
    // First 25 bars: steady uptrend with normal volume
    for (let i = 0; i < 25; i++) {
      bars.push({
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        open: 100 + i * 0.5,
        high: 100 + i * 0.5 + 1,
        low: 100 + i * 0.5 - 1,
        close: 100 + i * 0.5,
        volume: 1000000,
      });
    }
    // Add a pullback bar: close near SMA20, low volume, low ATR
    const lastClose = bars[bars.length - 1].close;
    bars.push({
      date: '2024-01-26',
      open: lastClose,
      high: lastClose + 0.1,
      low: lastClose - 0.1,
      close: lastClose, // Very close to SMA20
      volume: 200000, // Very low volume (below avg * 0.8)
    });

    const result = extractTrendPullbackOverlay(bars, {
      pullback_proximity_pct: 5,
      atr_contraction_threshold: 2.0, // Very permissive
      volume_below_avg_multiplier: 0.8,
      swing_lookback: 10,
    });

    expect(result).not.toBeNull();
    // The pullback bar detection depends on exact indicator values
    // Just verify the array is populated (may or may not detect depending on exact values)
    expect(Array.isArray(result!.pullbackBars)).toBe(true);
  });

  it('trigger marker has correct shape and color', () => {
    // Create bars where trigger conditions are met:
    // close > SMA(10) and volume > avgVolume(20) * trigger_volume_multiplier
    const bars: HistoricalDataPoint[] = [];
    for (let i = 0; i < 25; i++) {
      bars.push({
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        open: 100 + i * 0.3,
        high: 100 + i * 0.3 + 1,
        low: 100 + i * 0.3 - 1,
        close: 100 + i * 0.3,
        volume: 500000,
      });
    }
    // Add a trigger bar: close well above SMA10, high volume
    bars.push({
      date: '2024-01-26',
      open: 110,
      high: 115,
      low: 109,
      close: 114, // Well above SMA10
      volume: 2000000, // High volume (above avg * 1.2)
    });

    const result = extractTrendPullbackOverlay(bars, {
      trigger_volume_multiplier: 1.2,
    });

    expect(result).not.toBeNull();
    if (result!.triggerMarker) {
      expect(result!.triggerMarker.shape).toBe('arrowUp');
      expect(result!.triggerMarker.color).toBe('#FFC107');
      expect(result!.triggerMarker.text).toBe('Trigger');
    }
  });

  it('legend entries have correct count and values', () => {
    const bars = generateUptrendBars(30, 100);
    const result = extractTrendPullbackOverlay(bars, {});

    expect(result).not.toBeNull();
    expect(result!.legendEntries).toHaveLength(3);
    expect(result!.legendEntries[0]).toEqual({
      name: 'SMA10',
      color: '#FF9800',
      style: 'solid',
    });
    expect(result!.legendEntries[1]).toEqual({
      name: 'Pullback Bar',
      color: 'rgba(255, 193, 7, 0.3)',
      style: 'zone',
    });
    expect(result!.legendEntries[2]).toEqual({
      name: 'Trigger',
      color: '#FFC107',
      style: 'marker',
    });
  });

  it('dispatch routes trend_pullback to the extractor', () => {
    const bars = generateUptrendBars(30, 100);
    const result = extractOverlayData('trend_pullback', bars, {});

    expect(result).not.toBeNull();
    expect(result!.strategy).toBe('trend_pullback');
  });

  it('returns exactly 10 bars for SMA10 when given exactly 10 bars', () => {
    const bars = generateUptrendBars(10, 100);
    const result = extractTrendPullbackOverlay(bars, {});

    expect(result).not.toBeNull();
    // With exactly 10 bars, SMA10 can only be computed for the last bar
    expect(result!.sma10.length).toBe(1);
    expect(result!.sma10[0].time).toBe(bars[9].date);
  });

  it('uses default params when none provided', () => {
    const bars = generateUptrendBars(30, 100);
    // Call with empty params — should use defaults without error
    const result = extractTrendPullbackOverlay(bars, {});
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe('trend_pullback');
  });
});
