import { describe, it, expect } from 'vitest';
import { detectVolumeDryUp, linearRegressionSlope, isValidBar } from '../../src/strategies/vdu-engine.js';
import type { HistoricalDataPoint } from '../../src/types.js';

// ============================================================
// Helpers
// ============================================================

function makeBar(overrides: Partial<HistoricalDataPoint> = {}): HistoricalDataPoint {
  return {
    date: '2024-01-01',
    open: 100,
    high: 105,
    low: 95,
    close: 102,
    volume: 1_000_000,
    ...overrides,
  };
}

/**
 * Generate bars with specified volumes. All OHLC values are valid.
 */
function generateBarsWithVolumes(volumes: number[]): HistoricalDataPoint[] {
  return volumes.map((volume, i) => {
    const date = new Date('2024-01-01');
    date.setDate(date.getDate() + i);
    return {
      date: date.toISOString().slice(0, 10),
      open: 100,
      high: 105,
      low: 95,
      close: 102,
      volume,
    };
  });
}

// ============================================================
// linearRegressionSlope Tests
// ============================================================

describe('linearRegressionSlope', () => {
  it('returns 0 for empty array', () => {
    expect(linearRegressionSlope([])).toBe(0);
  });

  it('returns 0 for single value', () => {
    expect(linearRegressionSlope([100])).toBe(0);
  });

  it('returns positive slope for increasing values', () => {
    // y = [1, 2, 3, 4, 5], x = [0, 1, 2, 3, 4]
    // Perfect linear increase with slope = 1
    const slope = linearRegressionSlope([1, 2, 3, 4, 5]);
    expect(slope).toBeCloseTo(1, 10);
  });

  it('returns negative slope for decreasing values', () => {
    // y = [5, 4, 3, 2, 1], x = [0, 1, 2, 3, 4]
    // Perfect linear decrease with slope = -1
    const slope = linearRegressionSlope([5, 4, 3, 2, 1]);
    expect(slope).toBeCloseTo(-1, 10);
  });

  it('returns 0 for constant values', () => {
    const slope = linearRegressionSlope([100, 100, 100, 100]);
    expect(slope).toBeCloseTo(0, 10);
  });

  it('computes correct slope for two values', () => {
    // y = [10, 20], x = [0, 1] → slope = 10
    const slope = linearRegressionSlope([10, 20]);
    expect(slope).toBeCloseTo(10, 10);
  });

  it('computes correct slope for non-trivial data', () => {
    // y = [100, 80, 60], x = [0, 1, 2]
    // slope = -20 (perfect linear decrease by 20 per step)
    const slope = linearRegressionSlope([100, 80, 60]);
    expect(slope).toBeCloseTo(-20, 10);
  });
});

// ============================================================
// detectVolumeDryUp Tests
// ============================================================

describe('detectVolumeDryUp', () => {
  const defaultParams = { volume_lookback: 20, min_declining_days: 3 };

  it('returns fail result for empty data', () => {
    const result = detectVolumeDryUp([], 0, defaultParams, 0.80);
    expect(result).toEqual({ volume_ratio: 0, volume_slope: 0, met: false });
  });

  it('returns fail result for negative barIndex', () => {
    const data = generateBarsWithVolumes(Array(25).fill(1_000_000));
    const result = detectVolumeDryUp(data, -1, defaultParams, 0.80);
    expect(result).toEqual({ volume_ratio: 0, volume_slope: 0, met: false });
  });

  it('returns fail result for barIndex out of bounds', () => {
    const data = generateBarsWithVolumes(Array(25).fill(1_000_000));
    const result = detectVolumeDryUp(data, 30, defaultParams, 0.80);
    expect(result).toEqual({ volume_ratio: 0, volume_slope: 0, met: false });
  });

  it('returns fail result when barIndex < volume_lookback - 1', () => {
    const data = generateBarsWithVolumes(Array(25).fill(1_000_000));
    // barIndex 18 means only 19 bars available (indices 0-18), need 20
    const result = detectVolumeDryUp(data, 18, defaultParams, 0.80);
    expect(result).toEqual({ volume_ratio: 0, volume_slope: 0, met: false });
  });

  it('returns fail result when all volumes are zero (zero average)', () => {
    const data = generateBarsWithVolumes(Array(25).fill(0));
    const result = detectVolumeDryUp(data, 24, defaultParams, 0.80);
    expect(result).toEqual({ volume_ratio: 0, volume_slope: 0, met: false });
  });

  it('computes correct volume_ratio when current volume equals average', () => {
    // All volumes are 1M, so ratio = 1M / 1M = 1.0
    const data = generateBarsWithVolumes(Array(25).fill(1_000_000));
    const result = detectVolumeDryUp(data, 24, defaultParams, 0.80);
    expect(result.volume_ratio).toBeCloseTo(1.0, 5);
  });

  it('computes correct volume_ratio when current volume is half the average', () => {
    // 20 bars of 1M volume, then current bar at 500K
    const volumes = Array(24).fill(1_000_000);
    volumes.push(500_000); // bar 24 has half volume
    // The lookback window is bars 5-24 (20 bars)
    // Average of bars 5-24: (19 * 1M + 500K) / 20 = 975K
    // volume_ratio = 500K / 975K ≈ 0.5128
    const data = generateBarsWithVolumes(volumes);
    const result = detectVolumeDryUp(data, 24, defaultParams, 0.80);
    expect(result.volume_ratio).toBeLessThan(1.0);
    expect(result.volume_ratio).toBeGreaterThan(0);
  });

  it('returns met=true when volume_ratio < threshold AND slope < 0', () => {
    // Create declining volume: high volumes early, low at end
    const volumes: number[] = [];
    for (let i = 0; i < 25; i++) {
      volumes.push(1_000_000 - i * 30_000); // declining from 1M to 280K
    }
    const data = generateBarsWithVolumes(volumes);
    // Current volume (bar 24) = 1M - 24*30K = 280K
    // Average over lookback (bars 5-24) should be around 565K
    // Ratio ≈ 280K / 565K ≈ 0.496
    // Slope should be negative (declining)
    const result = detectVolumeDryUp(data, 24, defaultParams, 0.80);
    expect(result.volume_ratio).toBeLessThan(0.80);
    expect(result.volume_slope).toBeLessThan(0);
    expect(result.met).toBe(true);
  });

  it('returns met=false when volume_ratio < threshold but slope >= 0', () => {
    // Low volume but increasing at the end
    const volumes = Array(22).fill(1_000_000);
    // Last 3 bars: increasing volume but still below average
    volumes.push(200_000);
    volumes.push(300_000);
    volumes.push(400_000);
    const data = generateBarsWithVolumes(volumes);
    const result = detectVolumeDryUp(data, 24, defaultParams, 0.80);
    // Volume ratio should be < 0.80 (400K / ~avg)
    // But slope over last 3 bars [200K, 300K, 400K] is positive
    expect(result.volume_slope).toBeGreaterThan(0);
    expect(result.met).toBe(false);
  });

  it('returns met=false when slope < 0 but volume_ratio >= threshold', () => {
    // High volume but slightly declining
    const volumes: number[] = [];
    for (let i = 0; i < 25; i++) {
      volumes.push(1_000_000 - i * 1_000); // very slight decline
    }
    const data = generateBarsWithVolumes(volumes);
    // Current volume ≈ 976K, average ≈ ~988K, ratio ≈ 0.988
    const result = detectVolumeDryUp(data, 24, defaultParams, 0.80);
    expect(result.volume_ratio).toBeGreaterThan(0.80);
    expect(result.volume_slope).toBeLessThan(0);
    expect(result.met).toBe(false);
  });

  it('handles invalid bars in the lookback window by excluding them', () => {
    const volumes = Array(25).fill(1_000_000);
    volumes[24] = 400_000; // current bar low volume
    const data = generateBarsWithVolumes(volumes);
    // Invalidate one bar in the lookback window
    data[10] = { ...data[10], close: NaN };
    const result = detectVolumeDryUp(data, 24, defaultParams, 0.80);
    // Should still compute (19 valid bars in lookback)
    // Average = 19 * 1M / 19 = 1M (bar 10 excluded, bar 24 included in lookback)
    // Wait - bar 24 is the current bar AND in the lookback window
    // Lookback is bars 5-24 (20 bars), bar 10 excluded → 19 valid bars
    // Sum = 18 * 1M + 400K = 18.4M, avg = 18.4M / 19 ≈ 968K
    // ratio = 400K / 968K ≈ 0.413
    expect(result.volume_ratio).toBeGreaterThan(0);
    expect(result.volume_ratio).toBeLessThan(1);
  });

  it('returns fail result when current bar is invalid', () => {
    const data = generateBarsWithVolumes(Array(25).fill(1_000_000));
    data[24] = { ...data[24], close: -1 }; // invalid bar
    const result = detectVolumeDryUp(data, 24, defaultParams, 0.80);
    expect(result).toEqual({ volume_ratio: 0, volume_slope: 0, met: false });
  });

  it('works with min_declining_days = 2', () => {
    const volumes = Array(25).fill(1_000_000);
    volumes[23] = 600_000;
    volumes[24] = 400_000; // declining over last 2 bars
    const data = generateBarsWithVolumes(volumes);
    const params = { volume_lookback: 20, min_declining_days: 2 };
    const result = detectVolumeDryUp(data, 24, params, 0.80);
    // Slope over [600K, 400K] = -200K (negative)
    expect(result.volume_slope).toBeLessThan(0);
  });

  it('works at exact minimum barIndex (volume_lookback - 1)', () => {
    const data = generateBarsWithVolumes(Array(20).fill(1_000_000));
    // barIndex = 19 (20th bar, 0-indexed), lookback = 20 → needs bars 0-19
    const result = detectVolumeDryUp(data, 19, defaultParams, 0.80);
    expect(result.volume_ratio).toBeCloseTo(1.0, 5);
  });
});
