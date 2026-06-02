// ============================================================
// Fundamental Scorer — Pure Scoring Functions
// ============================================================
//
// Computes sub-scores for fundamental analysis enrichment:
//   - EPS growth YoY (40% weight)
//   - EPS acceleration (20% weight)
//   - Revenue growth (20% weight)
//   - Earnings beats (20% weight)
//
// Also provides composite score, tier classification,
// direction-aware confidence adjustment, and default data.
//
// Pure functions: no I/O, no side effects, fully testable in isolation.
// Follows the same pattern as candlestick-scorer.ts.
// ============================================================

import type { FundamentalData } from '../types.js';

// ============================================================
// Sub-Score Functions
// ============================================================

/**
 * Compute eps_growth_score from recent and year-ago EPS values.
 *
 * Growth thresholds:
 *   >25% → 100, >15% → 75, >5% → 55, >0% → 35, ≤0% → 15
 *
 * Returns 50 when data is unavailable or yearAgoEps <= 0.
 */
export function computeEpsGrowthScore(recentEps: number | null, yearAgoEps: number | null): number {
  if (recentEps == null || yearAgoEps == null || yearAgoEps <= 0) {
    return 50;
  }

  const growthRate = (recentEps - yearAgoEps) / yearAgoEps;

  if (growthRate > 0.25) return 100;
  if (growthRate > 0.15) return 75;
  if (growthRate > 0.05) return 55;
  if (growthRate > 0) return 35;
  return 15;
}

/**
 * Compute eps_acceleration_score from two consecutive YoY growth rates.
 *
 * Compares recentGrowth vs priorGrowth:
 *   >5pp ahead → 100 (accelerating)
 *   within ±5pp → 50 (flat)
 *   >5pp behind → 20 (decelerating)
 *
 * Returns 50 when insufficient data (either value is null).
 */
export function computeEpsAccelerationScore(recentGrowth: number | null, priorGrowth: number | null): number {
  if (recentGrowth == null || priorGrowth == null) {
    return 50;
  }

  const diff = recentGrowth - priorGrowth;

  if (diff > 5) return 100;
  if (diff >= -5) return 50;
  return 20;
}

/**
 * Compute revenue_growth_score from revenueGrowth percentage.
 *
 * Thresholds (revenueGrowth is a decimal, e.g. 0.15 = 15%):
 *   >15% → 100, >8% → 75, 0–8% → 50, <0% → 20
 *
 * Returns 50 when unavailable (null).
 */
export function computeRevenueGrowthScore(revenueGrowth: number | null): number {
  if (revenueGrowth == null) {
    return 50;
  }

  if (revenueGrowth > 0.15) return 100;
  if (revenueGrowth > 0.08) return 75;
  if (revenueGrowth >= 0) return 50;
  return 20;
}

/**
 * Compute earnings_beats_score from surprise percentages for last 4 quarters.
 *
 * Counts quarters where surprisePercent > 0:
 *   4 → 100, 3 → 75, 2 → 50, 1 → 25, 0 → 0
 *
 * Returns 50 when fewer than 2 quarters of data are available.
 */
export function computeEarningsBeatsScore(surprises: (number | null)[]): number {
  // Filter to non-null entries (available quarters)
  const available = surprises.filter((s): s is number => s != null);

  if (available.length < 2) {
    return 50;
  }

  const beats = available.filter(s => s > 0).length;

  switch (beats) {
    case 4: return 100;
    case 3: return 75;
    case 2: return 50;
    case 1: return 25;
    default: return 0;
  }
}

// ============================================================
// Composite Score & Tier Classification
// ============================================================

/**
 * Compute composite fundamental_score as weighted sum of sub-scores.
 *
 * Weights:
 *   epsGrowth × 0.40 + epsAcceleration × 0.20 +
 *   revenueGrowth × 0.20 + earningsBeats × 0.20
 *
 * Rounds to nearest integer, clamps to [0, 100].
 */
export function computeFundamentalScore(subScores: {
  epsGrowth: number;
  epsAcceleration: number;
  revenueGrowth: number;
  earningsBeats: number;
}): number {
  const raw =
    subScores.epsGrowth * 0.40 +
    subScores.epsAcceleration * 0.20 +
    subScores.revenueGrowth * 0.20 +
    subScores.earningsBeats * 0.20;

  const rounded = Math.round(raw);
  return Math.max(0, Math.min(100, rounded));
}

/**
 * Classify fundamental_score into a tier label.
 *
 *   ≥ 75 → "strong"
 *   50–74 → "mixed"
 *   < 50 → "weak"
 */
export function classifyTier(score: number): 'strong' | 'mixed' | 'weak' {
  if (score >= 75) return 'strong';
  if (score >= 50) return 'mixed';
  return 'weak';
}

/**
 * Returns a default FundamentalData object for use when data is unavailable.
 * Score defaults to 50 (neutral), tier to "mixed", all metrics null.
 */
export function defaultFundamentalData(ticker: string): FundamentalData {
  return {
    ticker,
    fetched_at: new Date().toISOString(),
    fundamental_score: 50,
    fundamental_tier: 'mixed',
    eps_growth_yoy: null,
    eps_accelerating: null,
    revenue_growth_yoy: null,
    earnings_beats: null,
    earnings_quarters: 0,
    profit_margin: null,
  };
}

// ============================================================
// Direction-Aware Confidence Adjustment
// ============================================================

/** BUY-side strategies that receive directional fundamental adjustment. */
const BUY_STRATEGIES: ReadonlySet<string> = new Set([
  'consolidation_breakout',
  'trend_pullback',
  'keltner_mean_reversion',
  'post_earnings_drift',
]);

/** SHORT-side strategies that receive inverse fundamental adjustment. */
const SHORT_STRATEGIES: ReadonlySet<string> = new Set([
  'bear_breakdown',
]);

/**
 * Determine the trade side from a strategy name.
 * Returns 'BUY', 'SHORT', or 'UNCLASSIFIED'.
 */
function determineFundamentalSide(strategy: string): 'BUY' | 'SHORT' | 'UNCLASSIFIED' {
  if (BUY_STRATEGIES.has(strategy)) return 'BUY';
  if (SHORT_STRATEGIES.has(strategy)) return 'SHORT';
  return 'UNCLASSIFIED';
}

/** Multiplier lookup tables by tier for each side. */
const BUY_MULTIPLIERS: Record<'strong' | 'mixed' | 'weak', number> = {
  strong: 1.05,
  mixed: 1.00,
  weak: 0.90,
};

const SHORT_MULTIPLIERS: Record<'strong' | 'mixed' | 'weak', number> = {
  strong: 0.92,
  mixed: 1.00,
  weak: 1.05,
};

/**
 * Apply direction-aware confidence multiplier based on fundamental tier and strategy.
 *
 * BUY strategies: strong → 1.05, mixed → 1.00, weak → 0.90
 * SHORT strategies: strong → 0.92, mixed → 1.00, weak → 1.05
 * Unclassified strategies: multiplier = 1.00 (no adjustment)
 *
 * Result is clamped to [0, 1].
 */
export function applyFundamentalAdjustment(
  confidence: number,
  tier: 'strong' | 'mixed' | 'weak',
  strategy: string
): number {
  const side = determineFundamentalSide(strategy);

  let multiplier: number;
  if (side === 'BUY') {
    multiplier = BUY_MULTIPLIERS[tier];
  } else if (side === 'SHORT') {
    multiplier = SHORT_MULTIPLIERS[tier];
  } else {
    multiplier = 1.00;
  }

  const adjusted = confidence * multiplier;
  return Math.max(0, Math.min(1, adjusted));
}
