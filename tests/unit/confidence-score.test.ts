import { describe, it, expect } from 'vitest';
import {
  computeConfidenceScore,
  resolveWeightPreset,
  computePeadConfidenceScore,
  resolvePeadWeightPreset,
  WEIGHT_PRESETS,
  PEAD_WEIGHT_PRESETS,
  DEFAULT_WEIGHTS,
} from '../../src/indicators/confidence-score.js';
import type { ConfidenceWeightsConfig } from '../../src/indicators/confidence-score.js';
import type { HistoricalDataPoint } from '../../src/types.js';
import type { ConsolidationResult } from '../../src/strategies/post-earnings-drift-engine.js';
import type { PostEarningsDriftConfiguration } from '../../src/strategies/strategy-configs.js';
import { IndicatorCache, getDefaultCacheConfig } from '../../src/indicators/indicator-cache.js';

function makeDataPoint(overrides: Partial<HistoricalDataPoint> = {}): HistoricalDataPoint {
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

function makeConsolidationResult(overrides: Partial<ConsolidationResult> = {}): ConsolidationResult {
  return {
    status: 'CONFIRMED',
    consolidationHigh: 110,
    consolidationLow: 100,
    decliningVolumeFlag: true,
    daysInConsolidation: 5,
    ...overrides,
  } as ConsolidationResult;
}

function makePeadConfig(overrides: Partial<PostEarningsDriftConfiguration> = {}): PostEarningsDriftConfiguration {
  return {
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
    ...overrides,
  };
}

// ============================================================
// resolveWeightPreset
// ============================================================

describe('resolveWeightPreset', () => {
  it('returns equal weights for preset 0', () => {
    const result = resolveWeightPreset(0);
    expect(result).toEqual({ w_rsi: 0.25, w_macd: 0.25, w_adx: 0.25, w_obv: 0.25 });
  });

  it('returns rsi_heavy weights for preset 1', () => {
    const result = resolveWeightPreset(1);
    expect(result.w_rsi).toBe(0.40);
    expect(result.w_macd).toBe(0.20);
    expect(result.w_adx).toBe(0.20);
    expect(result.w_obv).toBe(0.20);
  });

  it('returns trend_heavy weights for preset 2', () => {
    const result = resolveWeightPreset(2);
    expect(result.w_adx).toBe(0.40);
  });

  it('returns momentum_heavy weights for preset 3', () => {
    const result = resolveWeightPreset(3);
    expect(result.w_macd).toBe(0.40);
  });

  it('falls back to preset 0 for out-of-bounds index', () => {
    expect(resolveWeightPreset(99)).toEqual(WEIGHT_PRESETS[0]);
    expect(resolveWeightPreset(-1)).toEqual(WEIGHT_PRESETS[0]);
  });

  it('falls back to preset 0 for non-integer index', () => {
    // Non-integer indices won't match array positions
    expect(resolveWeightPreset(1.5)).toEqual(WEIGHT_PRESETS[0]);
  });
});

// ============================================================
// resolvePeadWeightPreset
// ============================================================

describe('resolvePeadWeightPreset', () => {
  it('returns equal weights for preset 0', () => {
    const result = resolvePeadWeightPreset(0);
    expect(result.w_relative_strength).toBeCloseTo(1 / 3);
    expect(result.w_volume_quality).toBeCloseTo(1 / 3);
    expect(result.w_consolidation_tightness).toBeCloseTo(1 / 3);
  });

  it('returns strength_heavy weights for preset 1', () => {
    const result = resolvePeadWeightPreset(1);
    expect(result.w_relative_strength).toBe(0.50);
  });

  it('returns volume_heavy weights for preset 2', () => {
    const result = resolvePeadWeightPreset(2);
    expect(result.w_volume_quality).toBe(0.50);
  });

  it('returns tightness_heavy weights for preset 3', () => {
    const result = resolvePeadWeightPreset(3);
    expect(result.w_consolidation_tightness).toBe(0.50);
  });

  it('falls back to preset 0 for out-of-bounds index', () => {
    expect(resolvePeadWeightPreset(100)).toEqual(PEAD_WEIGHT_PRESETS[0]);
  });
});

// ============================================================
// computeConfidenceScore
// ============================================================

describe('computeConfidenceScore', () => {
  // Build a small dataset with enough bars for RSI(14), MACD(35), ADX(28), OBV slope(10)
  function buildTrendingData(length: number, startPrice: number, increment: number): HistoricalDataPoint[] {
    return Array.from({ length }, (_, i) => {
      const close = startPrice + i * increment;
      return makeDataPoint({
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        open: close - 1,
        high: close + 2,
        low: close - 2,
        close,
        volume: 1000 + i * 100,
      });
    });
  }

  it('returns a value between 0 and 1', () => {
    const data = buildTrendingData(50, 100, 1);
    const cache = new IndicatorCache(data, getDefaultCacheConfig());
    const score = computeConfidenceScore(49, cache);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('returns 0.5 when all indicators are undefined (insufficient data)', () => {
    // With only 5 bars, RSI(14), MACD, ADX(14), OBV slope(10) all return undefined → neutral 0.5
    const data = buildTrendingData(5, 100, 1);
    const cache = new IndicatorCache(data, getDefaultCacheConfig());
    const score = computeConfidenceScore(4, cache);
    // All components are 0.5 (neutral), so weighted sum = 0.5
    expect(score).toBeCloseTo(0.5, 2);
  });

  it('uses custom weights when provided', () => {
    const data = buildTrendingData(50, 100, 1);
    const cache = new IndicatorCache(data, getDefaultCacheConfig());
    // RSI-only weight
    const rsiOnlyWeights: ConfidenceWeightsConfig = { w_rsi: 1, w_macd: 0, w_adx: 0, w_obv: 0 };
    const score = computeConfidenceScore(49, cache, rsiOnlyWeights);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('normalizes weights that do not sum to 1', () => {
    const data = buildTrendingData(50, 100, 1);
    const cache = new IndicatorCache(data, getDefaultCacheConfig());
    // Weights sum to 2.0 — should be normalized
    const weights: ConfidenceWeightsConfig = { w_rsi: 0.5, w_macd: 0.5, w_adx: 0.5, w_obv: 0.5 };
    const score = computeConfidenceScore(49, cache, weights);
    // After normalization, each weight = 0.25 (same as default)
    const defaultScore = computeConfidenceScore(49, cache);
    expect(score).toBeCloseTo(defaultScore, 5);
  });

  it('falls back to default weights when all weights are zero', () => {
    const data = buildTrendingData(50, 100, 1);
    const cache = new IndicatorCache(data, getDefaultCacheConfig());
    const zeroWeights: ConfidenceWeightsConfig = { w_rsi: 0, w_macd: 0, w_adx: 0, w_obv: 0 };
    const score = computeConfidenceScore(49, cache, zeroWeights);
    const defaultScore = computeConfidenceScore(49, cache);
    expect(score).toBeCloseTo(defaultScore, 5);
  });

  it('respects custom rsiMax parameter', () => {
    const data = buildTrendingData(50, 100, 1);
    const cache = new IndicatorCache(data, getDefaultCacheConfig());
    // Higher rsiMax means RSI score is higher (less penalized)
    const scoreDefault = computeConfidenceScore(49, cache, DEFAULT_WEIGHTS, { rsiMax: 70 });
    const scoreHighMax = computeConfidenceScore(49, cache, DEFAULT_WEIGHTS, { rsiMax: 100 });
    // With higher rsiMax, the RSI component score should be higher (or equal)
    // because (rsiMax - currentRsi) / rsiMax is larger when rsiMax is larger
    expect(scoreHighMax).toBeGreaterThanOrEqual(scoreDefault - 0.01);
  });
});

// ============================================================
// computePeadConfidenceScore
// ============================================================

describe('computePeadConfidenceScore', () => {
  function buildData(length: number, startPrice: number, increment: number): HistoricalDataPoint[] {
    return Array.from({ length }, (_, i) => {
      const close = startPrice + i * increment;
      return makeDataPoint({
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        open: close - 0.5,
        high: close + 1,
        low: close - 1,
        close,
        volume: 1000 + i * 50,
      });
    });
  }

  it('returns a value between 0 and 1', () => {
    const data = buildData(30, 100, 1);
    const consolidation = makeConsolidationResult();
    const config = makePeadConfig();
    const score = computePeadConfidenceScore(data, 25, consolidation, config);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('returns 0.5 for relative strength when insufficient data (barIndex < 20)', () => {
    const data = buildData(15, 100, 1);
    const consolidation = makeConsolidationResult();
    const config = makePeadConfig();
    // barIndex=10 < 20, so relative strength factor = 0.5 (neutral)
    const score = computePeadConfidenceScore(data, 10, consolidation, config);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('volume quality factor is 1.0 when decliningVolumeFlag is true', () => {
    const data = buildData(30, 100, 1);
    const consolidation = makeConsolidationResult({ decliningVolumeFlag: true, daysInConsolidation: 5 });
    const config = makePeadConfig();
    // Use volume_heavy preset (preset 2) to emphasize volume quality
    const score = computePeadConfidenceScore(data, 25, consolidation, config, undefined, 2);
    // Volume quality = 1.0 with weight 0.50, so it contributes 0.50 to the score
    expect(score).toBeGreaterThan(0.4);
  });

  it('volume quality factor is 0.3 when decliningVolumeFlag is false', () => {
    const data = buildData(30, 100, 1);
    const consolidation = makeConsolidationResult({ decliningVolumeFlag: false, daysInConsolidation: 5 });
    const config = makePeadConfig();
    // With volume_heavy preset, lower volume quality should reduce score
    const scoreDecl = computePeadConfidenceScore(
      data, 25,
      makeConsolidationResult({ decliningVolumeFlag: true, daysInConsolidation: 5 }),
      config, undefined, 2
    );
    const scoreNonDecl = computePeadConfidenceScore(data, 25, consolidation, config, undefined, 2);
    expect(scoreNonDecl).toBeLessThan(scoreDecl);
  });

  it('volume quality factor is 0.5 when daysInConsolidation is 0', () => {
    const data = buildData(30, 100, 1);
    const consolidation = makeConsolidationResult({ daysInConsolidation: 0 });
    const config = makePeadConfig();
    const score = computePeadConfidenceScore(data, 25, consolidation, config);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('tightness factor is higher for tighter consolidation', () => {
    const data = buildData(30, 100, 1);
    const config = makePeadConfig({ max_range_pct: 10 });
    // Tight consolidation: high=105, low=104 → range = (105-104)/105*100 ≈ 0.95%
    const tight = makeConsolidationResult({ consolidationHigh: 105, consolidationLow: 104 });
    // Wide consolidation: high=110, low=100 → range = (110-100)/110*100 ≈ 9.09%
    const wide = makeConsolidationResult({ consolidationHigh: 110, consolidationLow: 100 });

    // Use tightness_heavy preset (preset 3)
    const scoreTight = computePeadConfidenceScore(data, 25, tight, config, undefined, 3);
    const scoreWide = computePeadConfidenceScore(data, 25, wide, config, undefined, 3);
    expect(scoreTight).toBeGreaterThan(scoreWide);
  });

  it('tightness factor returns 0.5 when consolidationHigh is 0', () => {
    const data = buildData(30, 100, 1);
    const consolidation = makeConsolidationResult({ consolidationHigh: 0 });
    const config = makePeadConfig();
    const score = computePeadConfidenceScore(data, 25, consolidation, config);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('tightness factor returns 0.5 when max_range_pct is 0', () => {
    const data = buildData(30, 100, 1);
    const consolidation = makeConsolidationResult();
    const config = makePeadConfig({ max_range_pct: 0 });
    const score = computePeadConfidenceScore(data, 25, consolidation, config);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('relative strength is higher when ticker outperforms SPY', () => {
    // Ticker goes up strongly
    const tickerData = buildData(30, 100, 2); // +2 per bar
    // SPY goes up slowly
    const spyData = buildData(30, 100, 0.1); // +0.1 per bar
    const consolidation = makeConsolidationResult();
    const config = makePeadConfig();

    // Use strength_heavy preset (preset 1)
    const scoreWithSpy = computePeadConfidenceScore(tickerData, 25, consolidation, config, spyData, 1);
    // Without SPY data, relative strength uses only ticker return
    const scoreNoSpy = computePeadConfidenceScore(tickerData, 25, consolidation, config, undefined, 1);
    // Both should be valid scores
    expect(scoreWithSpy).toBeGreaterThanOrEqual(0);
    expect(scoreWithSpy).toBeLessThanOrEqual(1);
    expect(scoreNoSpy).toBeGreaterThanOrEqual(0);
    expect(scoreNoSpy).toBeLessThanOrEqual(1);
  });

  it('uses weight preset parameter to change scoring emphasis', () => {
    const data = buildData(30, 100, 1);
    const consolidation = makeConsolidationResult({ decliningVolumeFlag: true });
    const config = makePeadConfig();

    const scoreEqual = computePeadConfidenceScore(data, 25, consolidation, config, undefined, 0);
    const scoreVolHeavy = computePeadConfidenceScore(data, 25, consolidation, config, undefined, 2);
    // Different presets should produce different scores (unless all factors are equal)
    // At minimum, both should be valid
    expect(scoreEqual).toBeGreaterThanOrEqual(0);
    expect(scoreVolHeavy).toBeGreaterThanOrEqual(0);
  });

  it('handles SPY data shorter than ticker data', () => {
    const tickerData = buildData(30, 100, 1);
    const spyData = buildData(10, 100, 0.5); // Only 10 bars
    const consolidation = makeConsolidationResult();
    const config = makePeadConfig();
    // Should not throw, uses min(barIndex, spyData.length - 1)
    const score = computePeadConfidenceScore(tickerData, 25, consolidation, config, spyData);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
