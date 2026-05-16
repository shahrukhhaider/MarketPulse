import type { IndicatorCache } from './indicator-cache.js';
import type { HistoricalDataPoint } from '../types.js';
import type { ConsolidationResult } from '../strategies/post-earnings-drift-engine.js';
import type { PostEarningsDriftConfiguration } from '../strategies/strategy-configs.js';

/**
 * Configuration for the four indicator weights used in the confidence score.
 * Each weight should be in [0, 1] and all weights should sum to 1.0.
 */
export interface ConfidenceWeightsConfig {
  w_rsi: number;   // weight for RSI component, in [0, 1]
  w_macd: number;  // weight for MACD component, in [0, 1]
  w_adx: number;   // weight for ADX component, in [0, 1]
  w_obv: number;   // weight for OBV component, in [0, 1]
}

/**
 * Optional parameters for confidence score computation.
 */
export interface ConfidenceScoreParams {
  /** Upper RSI threshold for scoring (default 70). */
  rsiMax?: number;
}

/**
 * Default equal weights for all four indicator components.
 */
export const DEFAULT_WEIGHTS: ConfidenceWeightsConfig = {
  w_rsi: 0.25,
  w_macd: 0.25,
  w_adx: 0.25,
  w_obv: 0.25,
};

/** Clamp a value between min and max. */
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Compute a confidence score in [0.0, 1.0] from weighted indicator values.
 *
 * Component scores:
 *   RSI:  clamp((rsiMax - currentRsi) / rsiMax, 0, 1)
 *   MACD: continuous mapping based on histogram (positive = higher)
 *   ADX:  clamp(adx / 50, 0, 1)
 *   OBV:  positive slope = 1.0, negative = 0.3, undefined = 0.5
 *
 * When any indicator returns undefined (insufficient data), uses neutral 0.5.
 *
 * Composite: w_rsi * rsiScore + w_macd * macdScore + w_adx * adxScore + w_obv * obvScore
 */
export function computeConfidenceScore(
  barIndex: number,
  cache: IndicatorCache,
  weights: ConfidenceWeightsConfig = DEFAULT_WEIGHTS,
  params: ConfidenceScoreParams = {}
): number {
  const rsiMax = params.rsiMax ?? 70;

  // --- Normalize weights ---
  let { w_rsi, w_macd, w_adx, w_obv } = weights;
  const weightSum = w_rsi + w_macd + w_adx + w_obv;

  if (weightSum === 0) {
    // All zero — fall back to default equal weights
    w_rsi = DEFAULT_WEIGHTS.w_rsi;
    w_macd = DEFAULT_WEIGHTS.w_macd;
    w_adx = DEFAULT_WEIGHTS.w_adx;
    w_obv = DEFAULT_WEIGHTS.w_obv;
  } else if (Math.abs(weightSum - 1.0) > 0.01) {
    // Normalize so they sum to 1.0
    w_rsi = w_rsi / weightSum;
    w_macd = w_macd / weightSum;
    w_adx = w_adx / weightSum;
    w_obv = w_obv / weightSum;
  }

  // --- RSI Score ---
  const currentRsi = cache.getRsi(14, barIndex);
  const rsiScore = currentRsi !== undefined
    ? clamp((rsiMax - currentRsi) / rsiMax, 0, 1)
    : 0.5;

  // --- MACD Score ---
  const macdData = cache.getMacd(barIndex);
  let macdScore: number;
  if (macdData === undefined) {
    macdScore = 0.5;
  } else {
    const { histogram, macdLine } = macdData;
    const denominator = 2 * Math.abs(macdLine) + 1e-10;
    if (histogram >= 0) {
      macdScore = clamp(0.5 + histogram / denominator, 0.5, 1.0);
    } else {
      macdScore = clamp(0.5 + histogram / denominator, 0.0, 0.5);
    }
  }

  // --- ADX Score ---
  const currentAdx = cache.getAdx(14, barIndex);
  const adxScore = currentAdx !== undefined
    ? clamp(currentAdx / 50, 0, 1)
    : 0.5;

  // --- OBV Score ---
  const obvSlopeValue = cache.getObvSlope(10, barIndex);
  let obvScore: number;
  if (obvSlopeValue === undefined) {
    obvScore = 0.5;
  } else if (obvSlopeValue === true) {
    obvScore = 1.0;
  } else {
    obvScore = 0.3;
  }

  // --- Weighted composite ---
  return w_rsi * rsiScore + w_macd * macdScore + w_adx * adxScore + w_obv * obvScore;
}

/**
 * Predefined weight configurations for common scoring strategies.
 * Index 0: equal — balanced baseline
 * Index 1: rsi_heavy — emphasize overbought/oversold
 * Index 2: trend_heavy — emphasize trend strength (ADX)
 * Index 3: momentum_heavy — emphasize momentum direction (MACD)
 */
export const WEIGHT_PRESETS: ConfidenceWeightsConfig[] = [
  { w_rsi: 0.25, w_macd: 0.25, w_adx: 0.25, w_obv: 0.25 },  // 0: equal
  { w_rsi: 0.40, w_macd: 0.20, w_adx: 0.20, w_obv: 0.20 },  // 1: rsi_heavy
  { w_rsi: 0.20, w_macd: 0.20, w_adx: 0.40, w_obv: 0.20 },  // 2: trend_heavy
  { w_rsi: 0.20, w_macd: 0.40, w_adx: 0.20, w_obv: 0.20 },  // 3: momentum_heavy
];

/**
 * Resolve a weight preset index to a ConfidenceWeightsConfig.
 * Falls back to index 0 (equal weights) if the preset index is out of bounds.
 */
export function resolveWeightPreset(preset: number): ConfidenceWeightsConfig {
  return WEIGHT_PRESETS[preset] ?? WEIGHT_PRESETS[0];
}


// ============================================================
// PEAD Confidence Score
// ============================================================

/**
 * Weight configuration for the three PEAD confidence score factors.
 * Each weight should be in [0, 1] and all weights should sum to 1.0.
 */
export interface PeadConfidenceWeightsConfig {
  w_relative_strength: number;
  w_volume_quality: number;
  w_consolidation_tightness: number;
}

/**
 * Predefined weight configurations for PEAD confidence scoring.
 * Index 0: equal — balanced baseline (1/3 each)
 * Index 1: strength_heavy — emphasize relative strength
 * Index 2: volume_heavy — emphasize volume quality
 * Index 3: tightness_heavy — emphasize consolidation tightness
 */
export const PEAD_WEIGHT_PRESETS: PeadConfidenceWeightsConfig[] = [
  { w_relative_strength: 1 / 3, w_volume_quality: 1 / 3, w_consolidation_tightness: 1 / 3 },  // 0: equal
  { w_relative_strength: 0.50, w_volume_quality: 0.25, w_consolidation_tightness: 0.25 },       // 1: strength_heavy
  { w_relative_strength: 0.25, w_volume_quality: 0.50, w_consolidation_tightness: 0.25 },       // 2: volume_heavy
  { w_relative_strength: 0.25, w_volume_quality: 0.25, w_consolidation_tightness: 0.50 },       // 3: tightness_heavy
];

/**
 * Resolve a PEAD weight preset index to a PeadConfidenceWeightsConfig.
 * Falls back to index 0 (equal weights) if the preset index is out of bounds.
 */
export function resolvePeadWeightPreset(preset: number): PeadConfidenceWeightsConfig {
  return PEAD_WEIGHT_PRESETS[preset] ?? PEAD_WEIGHT_PRESETS[0];
}

/**
 * Compute a PEAD-specific confidence score in [0.0, 1.0] by combining three
 * equally-weighted factors (unless overridden by weight preset):
 *
 * 1. Relative strength: (ticker 20-day return − SPY 20-day return),
 *    mapped from [−10%, +10%] to [0, 1] with clamping.
 * 2. Volume quality: ratio of declining-volume days to total consolidation days.
 * 3. Consolidation tightness: 1 − (actual range_pct / max_range_pct), clamped to [0, 1].
 *
 * Uses the weight preset system via the weight_preset parameter for tuning.
 */
export function computePeadConfidenceScore(
  data: HistoricalDataPoint[],
  barIndex: number,
  consolidationResult: ConsolidationResult,
  config: PostEarningsDriftConfiguration,
  spyData?: HistoricalDataPoint[],
  weightPreset?: number
): number {
  // Resolve weights from preset (default to equal weights at index 0)
  const weights = resolvePeadWeightPreset(weightPreset ?? 0);
  let { w_relative_strength, w_volume_quality, w_consolidation_tightness } = weights;

  // Normalize weights in case they don't sum to 1
  const weightSum = w_relative_strength + w_volume_quality + w_consolidation_tightness;
  if (weightSum === 0) {
    w_relative_strength = 1 / 3;
    w_volume_quality = 1 / 3;
    w_consolidation_tightness = 1 / 3;
  } else if (Math.abs(weightSum - 1.0) > 0.01) {
    w_relative_strength = w_relative_strength / weightSum;
    w_volume_quality = w_volume_quality / weightSum;
    w_consolidation_tightness = w_consolidation_tightness / weightSum;
  }

  // --- Factor 1: Relative Strength ---
  // (ticker 20-day return − SPY 20-day return), mapped from [-10%, +10%] to [0, 1]
  const relativeStrengthScore = computeRelativeStrengthFactor(data, barIndex, spyData);

  // --- Factor 2: Volume Quality ---
  // Ratio of declining-volume days to total consolidation days
  const volumeQualityScore = computeVolumeQualityFactor(consolidationResult);

  // --- Factor 3: Consolidation Tightness ---
  // 1 − (actual range_pct / max_range_pct), clamped to [0, 1]
  const tightnessScore = computeConsolidationTightnessFactor(consolidationResult, config);

  // Weighted average
  return w_relative_strength * relativeStrengthScore
    + w_volume_quality * volumeQualityScore
    + w_consolidation_tightness * tightnessScore;
}

/**
 * Compute the relative strength factor.
 * Ticker 20-day return minus SPY 20-day return, mapped from [-10%, +10%] to [0, 1].
 * Returns 0.5 (neutral) if insufficient data.
 */
function computeRelativeStrengthFactor(
  data: HistoricalDataPoint[],
  barIndex: number,
  spyData?: HistoricalDataPoint[]
): number {
  // Need at least 20 bars of ticker data
  if (barIndex < 20 || data.length <= barIndex) {
    return 0.5; // neutral when insufficient data
  }

  const tickerReturn20d = computeReturn(data, barIndex, 20);
  if (tickerReturn20d === undefined) return 0.5;

  let spyReturn20d = 0;
  if (spyData && spyData.length > 20) {
    // Use the same bar index or the last available bar in SPY data
    const spyIndex = Math.min(barIndex, spyData.length - 1);
    if (spyIndex >= 20) {
      spyReturn20d = computeReturn(spyData, spyIndex, 20) ?? 0;
    }
  }

  // Relative strength = ticker return - SPY return (in percentage points)
  const relativeStrength = tickerReturn20d - spyReturn20d;

  // Map from [-10%, +10%] to [0, 1] with clamping
  // -10% → 0, 0% → 0.5, +10% → 1
  const mapped = (relativeStrength + 10) / 20;
  return clamp(mapped, 0, 1);
}

/**
 * Compute the volume quality factor.
 * Ratio of declining-volume days to total consolidation days.
 * If consolidation has 0 days, returns 0.5 (neutral).
 */
function computeVolumeQualityFactor(consolidationResult: ConsolidationResult): number {
  if (consolidationResult.daysInConsolidation <= 0) {
    return 0.5; // neutral when no consolidation data
  }

  // The decliningVolumeFlag is true when ALL days have declining volume
  // For a more granular score, we use the flag as a binary indicator:
  // true = 1.0 (all days declining), false = partial estimate
  // Since ConsolidationResult only provides the flag (not the count),
  // we use: flag=true → 1.0, flag=false → 0.3 (some days had higher volume)
  if (consolidationResult.decliningVolumeFlag) {
    return 1.0;
  }

  // When not all days are declining, use a moderate score
  // This is a simplification since we don't have the exact count of declining days
  return 0.3;
}

/**
 * Compute the consolidation tightness factor.
 * 1 − (actual range_pct / max_range_pct), clamped to [0, 1].
 * Tighter consolidation (smaller range) = higher score.
 */
function computeConsolidationTightnessFactor(
  consolidationResult: ConsolidationResult,
  config: PostEarningsDriftConfiguration
): number {
  if (consolidationResult.consolidationHigh <= 0 || config.max_range_pct <= 0) {
    return 0.5; // neutral when data is unavailable
  }

  // Compute actual range percentage from consolidation high to low
  const actualRangePct = ((consolidationResult.consolidationHigh - consolidationResult.consolidationLow)
    / consolidationResult.consolidationHigh) * 100;

  // Tightness = 1 − (actual_range_pct / max_range_pct)
  const tightness = 1 - (actualRangePct / config.max_range_pct);

  return clamp(tightness, 0, 1);
}

/**
 * Compute the N-day return as a percentage.
 * return = (close[barIndex] - close[barIndex - period]) / close[barIndex - period] * 100
 */
function computeReturn(data: HistoricalDataPoint[], barIndex: number, period: number): number | undefined {
  if (barIndex < period || barIndex >= data.length) return undefined;

  const currentClose = data[barIndex].close;
  const pastClose = data[barIndex - period].close;

  if (pastClose === 0) return undefined;

  return ((currentClose - pastClose) / pastClose) * 100;
}
