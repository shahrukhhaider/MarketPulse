import type { IndicatorCache } from './indicator-cache.js';

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
