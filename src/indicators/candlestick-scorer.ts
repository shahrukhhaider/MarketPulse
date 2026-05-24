// ============================================================
// Candlestick Scorer — Pattern Detection & Confidence Adjustment
// ============================================================
//
// Detects standard candlestick patterns on the signal bar (last 1–3 bars)
// and produces a bounded confidence adjustment multiplier in [0.85, 1.15].
//
// Pure function: no side effects, deterministic, order-invariant on patterns.
// Follows the same architectural pattern as confluence-calculator.ts.
//
// Patterns detected:
//   Single-bar: hammer, shooting_star, dragonfly_doji, doji,
//               bullish_marubozu, bearish_marubozu
//   Two-bar:    bullish_engulfing, bearish_engulfing
//   Three-bar:  morning_star
//
// Composite score formula:
//   rawScore = Σ pattern_scores
//   adjustment = 1 + tanh(rawScore) * 0.15
// ============================================================

/** Input bar — matches existing HistoricalDataPoint OHLC fields */
export interface Bar {
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Valid strategy names for the scorer */
export type CandlestickStrategy =
  | 'trend_pullback'
  | 'keltner_mean_reversion'
  | 'consolidation_breakout'
  | 'post_earnings_drift'
  | 'bear_breakdown';

/** Result returned by the scorer */
export interface CandlestickScorerResult {
  adjustment: number;       // [0.85, 1.15]
  rawScore: number;         // sum of pattern contributions before tanh
  patterns: string[];       // detected pattern names (snake_case)
}

/** Pattern names as a const union for type safety */
export type CandlestickPattern =
  | 'hammer'
  | 'bullish_engulfing'
  | 'morning_star'
  | 'dragonfly_doji'
  | 'bullish_marubozu'
  | 'bearish_engulfing'
  | 'shooting_star'
  | 'bearish_marubozu'
  | 'doji';


// ============================================================
// Constants
// ============================================================

const VALID_STRATEGIES: Set<string> = new Set([
  'trend_pullback',
  'keltner_mean_reversion',
  'consolidation_breakout',
  'post_earnings_drift',
  'bear_breakdown',
]);

/**
 * Pattern Score Table
 * Each pattern has a long score (used for all strategies except bear_breakdown)
 * and a bear_breakdown score (direction-inverted for directional patterns).
 */
interface PatternScoreEntry {
  longScore: number;
  bearBreakdownScore: number;
  barsRequired: number;
}

const PATTERN_SCORES: Record<CandlestickPattern, PatternScoreEntry> = {
  hammer:            { longScore: +0.6, bearBreakdownScore: -0.4, barsRequired: 1 },
  bullish_engulfing: { longScore: +0.8, bearBreakdownScore: -0.6, barsRequired: 2 },
  morning_star:      { longScore: +0.9, bearBreakdownScore: -0.7, barsRequired: 3 },
  dragonfly_doji:    { longScore: +0.5, bearBreakdownScore: -0.4, barsRequired: 1 },
  bullish_marubozu:  { longScore: +0.7, bearBreakdownScore: -0.7, barsRequired: 1 },
  bearish_engulfing: { longScore: -0.8, bearBreakdownScore: +0.8, barsRequired: 2 },
  shooting_star:     { longScore: -0.7, bearBreakdownScore: +0.7, barsRequired: 1 },
  bearish_marubozu:  { longScore: -0.7, bearBreakdownScore: +0.7, barsRequired: 1 },
  doji:              { longScore: -0.3, bearBreakdownScore: -0.3, barsRequired: 1 },
};

/**
 * Strategy-Pattern Applicability Matrix
 * Maps each pattern to the set of strategies where it applies.
 */
const PATTERN_APPLICABILITY: Record<CandlestickPattern, Set<string>> = {
  hammer: new Set(['trend_pullback', 'keltner_mean_reversion', 'post_earnings_drift', 'bear_breakdown']),
  bullish_engulfing: new Set(['trend_pullback', 'keltner_mean_reversion', 'consolidation_breakout', 'post_earnings_drift', 'bear_breakdown']),
  morning_star: new Set(['trend_pullback', 'keltner_mean_reversion', 'bear_breakdown']),
  dragonfly_doji: new Set(['trend_pullback', 'keltner_mean_reversion', 'bear_breakdown']),
  bullish_marubozu: new Set(['consolidation_breakout', 'bear_breakdown']),
  bearish_engulfing: new Set(['trend_pullback', 'keltner_mean_reversion', 'consolidation_breakout', 'post_earnings_drift', 'bear_breakdown']),
  shooting_star: new Set(['trend_pullback', 'consolidation_breakout', 'post_earnings_drift', 'bear_breakdown']),
  bearish_marubozu: new Set(['consolidation_breakout', 'bear_breakdown']),
  doji: new Set(['trend_pullback', 'keltner_mean_reversion', 'consolidation_breakout', 'post_earnings_drift', 'bear_breakdown']),
};

// ============================================================
// Neutral result constant
// ============================================================

const NEUTRAL_RESULT: CandlestickScorerResult = {
  adjustment: 1.0,
  rawScore: 0,
  patterns: [],
};


// ============================================================
// Bar Validation Helpers
// ============================================================

/**
 * Check if a bar has valid OHLC data (high >= low, all non-negative).
 */
function isValidBar(bar: Bar): boolean {
  return (
    bar.high >= bar.low &&
    bar.open >= 0 &&
    bar.high >= 0 &&
    bar.low >= 0 &&
    bar.close >= 0
  );
}

/**
 * Check if a bar has a non-zero range (high !== low).
 * Zero-range bars cannot have meaningful single-bar pattern geometry.
 */
function hasNonZeroRange(bar: Bar): boolean {
  return bar.high > bar.low;
}

// ============================================================
// Pattern Detection — Single Bar
// ============================================================

/**
 * Detect single-bar patterns on the signal bar.
 * Only evaluates if the bar is valid and has non-zero range.
 */
function detectSingleBarPatterns(bar: Bar): CandlestickPattern[] {
  if (!isValidBar(bar) || !hasNonZeroRange(bar)) {
    return [];
  }

  const patterns: CandlestickPattern[] = [];
  const range = bar.high - bar.low;
  const body = Math.abs(bar.close - bar.open);
  const bodyTop = Math.max(bar.open, bar.close);
  const bodyBottom = Math.min(bar.open, bar.close);
  const upperWick = bar.high - bodyTop;
  const lowerWick = bodyBottom - bar.low;
  const isBullish = bar.close > bar.open;
  const isBearish = bar.open > bar.close;

  // dragonfly_doji: body < 5% range, lower wick >= 60% range, upper wick <= 10% range
  const isDragonflyDoji =
    body < 0.05 * range &&
    lowerWick >= 0.60 * range &&
    upperWick <= 0.10 * range;

  if (isDragonflyDoji) {
    patterns.push('dragonfly_doji');
  }

  // doji: body < 5% range AND NOT dragonfly_doji
  if (body < 0.05 * range && !isDragonflyDoji) {
    patterns.push('doji');
  }

  // hammer: body in upper 30% of range (bodyBottom >= low + 0.70 * range),
  //         lower wick >= 2× body, upper wick <= 10% range
  if (
    bodyBottom >= bar.low + 0.70 * range &&
    lowerWick >= 2 * body &&
    upperWick <= 0.10 * range
  ) {
    patterns.push('hammer');
  }

  // shooting_star: body in lower 30% of range (bodyTop <= low + 0.30 * range),
  //               upper wick >= 2× body, lower wick <= 10% range
  if (
    bodyTop <= bar.low + 0.30 * range &&
    upperWick >= 2 * body &&
    lowerWick <= 0.10 * range
  ) {
    patterns.push('shooting_star');
  }

  // bullish_marubozu: bullish bar, body >= 85% range
  if (isBullish && body >= 0.85 * range) {
    patterns.push('bullish_marubozu');
  }

  // bearish_marubozu: bearish bar, body >= 85% range
  if (isBearish && body >= 0.85 * range) {
    patterns.push('bearish_marubozu');
  }

  return patterns;
}

// ============================================================
// Pattern Detection — Two Bar
// ============================================================

/**
 * Detect two-bar patterns on the last two bars.
 * Both bars must be valid. The signal bar (bar[-1]) must have non-zero range
 * for patterns that use its range as a divisor.
 */
function detectTwoBarPatterns(prev: Bar, current: Bar): CandlestickPattern[] {
  if (!isValidBar(prev) || !isValidBar(current)) {
    return [];
  }

  const patterns: CandlestickPattern[] = [];
  const prevIsBullish = prev.close > prev.open;
  const prevIsBearish = prev.open > prev.close;
  const currentIsBullish = current.close > current.open;
  const currentIsBearish = current.open > current.close;

  // bullish_engulfing: bar[-2] bearish, bar[-1] bullish,
  //   open[-1] < open[-2], close[-1] > close[-2]
  if (
    prevIsBearish &&
    currentIsBullish &&
    current.open < prev.open &&
    current.close > prev.close
  ) {
    patterns.push('bullish_engulfing');
  }

  // bearish_engulfing: bar[-2] bullish, bar[-1] bearish,
  //   open[-1] >= close[-2], close[-1] <= open[-2]
  if (
    prevIsBullish &&
    currentIsBearish &&
    current.open >= prev.close &&
    current.close <= prev.open
  ) {
    patterns.push('bearish_engulfing');
  }

  return patterns;
}

// ============================================================
// Pattern Detection — Three Bar
// ============================================================

/**
 * Detect three-bar patterns on the last three bars.
 * All bars must be valid.
 */
function detectThreeBarPatterns(bar3: Bar, bar2: Bar, bar1: Bar): CandlestickPattern[] {
  if (!isValidBar(bar3) || !isValidBar(bar2) || !isValidBar(bar1)) {
    return [];
  }

  const patterns: CandlestickPattern[] = [];

  // morning_star:
  //   bar[-3] bearish with body >= 50% range
  //   bar[-2] body <= 20% range with open < close[-3] (gap down)
  //   bar[-1] bullish closing above midpoint of bar[-3] body
  const bar3Range = bar3.high - bar3.low;
  const bar3Body = Math.abs(bar3.close - bar3.open);
  const bar3IsBearish = bar3.open > bar3.close;

  const bar2Range = bar2.high - bar2.low;
  const bar2Body = Math.abs(bar2.close - bar2.open);

  const bar1IsBullish = bar1.close > bar1.open;

  // bar[-3] body >= 50% range (need non-zero range for this check)
  const bar3BodyCondition = bar3Range > 0 && bar3Body >= 0.50 * bar3Range;

  // bar[-2] body <= 20% range (if range is 0, body must also be 0 which satisfies <= 20%)
  const bar2BodyCondition = bar2Range === 0 ? bar2Body === 0 : bar2Body <= 0.20 * bar2Range;

  // bar[-3] midpoint of body: midpoint between open and close of bar[-3]
  const bar3BodyMidpoint = (bar3.open + bar3.close) / 2;

  if (
    bar3IsBearish &&
    bar3BodyCondition &&
    bar2BodyCondition &&
    bar2.open < bar3.close &&  // gap down: bar[-2] open < bar[-3] close
    bar1IsBullish &&
    bar1.close > bar3BodyMidpoint
  ) {
    patterns.push('morning_star');
  }

  return patterns;
}


// ============================================================
// Main Scorer Function
// ============================================================

/**
 * Score candlestick patterns on the provided bars for the given strategy.
 * Pure function — no side effects, deterministic, order-invariant on patterns.
 *
 * @param bars - Array of 1–3 bars (OHLC data), most recent bar last
 * @param strategy - Strategy name to determine pattern applicability and scoring direction
 * @returns CandlestickScorerResult with adjustment in [0.85, 1.15]
 */
export function scoreCandlesticks(
  bars: Bar[],
  strategy: string
): CandlestickScorerResult {
  // Empty bars → neutral result
  if (bars.length === 0) {
    return { ...NEUTRAL_RESULT, patterns: [] };
  }

  // Unrecognized strategy → neutral result
  if (!VALID_STRATEGIES.has(strategy)) {
    return { ...NEUTRAL_RESULT, patterns: [] };
  }

  const isBearBreakdown = strategy === 'bear_breakdown';

  // Detect all patterns based on available bars
  const detectedPatterns: CandlestickPattern[] = [];

  // Single-bar patterns on the signal bar (last bar)
  const signalBar = bars[bars.length - 1];
  const singleBarPatterns = detectSingleBarPatterns(signalBar);
  detectedPatterns.push(...singleBarPatterns);

  // Two-bar patterns (need at least 2 bars)
  if (bars.length >= 2) {
    const prevBar = bars[bars.length - 2];
    const twoBarPatterns = detectTwoBarPatterns(prevBar, signalBar);
    detectedPatterns.push(...twoBarPatterns);
  }

  // Three-bar patterns (need at least 3 bars)
  if (bars.length >= 3) {
    const bar3 = bars[bars.length - 3];
    const bar2 = bars[bars.length - 2];
    const threeBarPatterns = detectThreeBarPatterns(bar3, bar2, signalBar);
    detectedPatterns.push(...threeBarPatterns);
  }

  // Filter by strategy applicability
  const applicablePatterns = detectedPatterns.filter(
    (pattern) => PATTERN_APPLICABILITY[pattern].has(strategy)
  );

  // No applicable patterns → neutral result
  if (applicablePatterns.length === 0) {
    return { ...NEUTRAL_RESULT, patterns: [] };
  }

  // Compute raw score using direction-aware scoring
  let rawScore = 0;
  for (const pattern of applicablePatterns) {
    const entry = PATTERN_SCORES[pattern];
    rawScore += isBearBreakdown ? entry.bearBreakdownScore : entry.longScore;
  }

  // Composite score: adjustment = 1 + tanh(rawScore) * 0.15
  const adjustment = 1 + Math.tanh(rawScore) * 0.15;

  return {
    adjustment,
    rawScore,
    patterns: applicablePatterns,
  };
}
