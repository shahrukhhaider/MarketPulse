import type { SignalOutput } from '../strategies/strategy-registry.js';

// ============================================================
// Confluence Calculator — Group-Based with Conflict Discount
// ============================================================
//
// Computes confluence among LONG strategies only (strategies that
// can meaningfully reinforce each other). Bear_breakdown acts as
// a conflict signal that discounts the long confluence score.
//
// Reinforcing relationships (long strategies):
//   - consolidation_breakout + trend_pullback: both need uptrend
//   - keltner_mean_reversion + trend_pullback: both are dip-buy in uptrend
//   - keltner_mean_reversion + consolidation_breakout: bounce → breakout
//   - post_earnings_drift: catalyst-driven, reinforces any long setup
//
// Conflict:
//   - bear_breakdown active while long strategies fire = dead cat bounce risk
//   - Applied as a discount multiplier to the long confluence score
// ============================================================

/**
 * Long strategies that can meaningfully agree with each other.
 * These all represent bullish setups in different market microstructures.
 */
export const LONG_STRATEGIES: Set<string> = new Set([
  'consolidation_breakout',
  'trend_pullback',
  'post_earnings_drift',
  'keltner_mean_reversion',
  'volume_dry_up',
]);

/**
 * Short strategies that act as conflict signals against long confluence.
 */
export const SHORT_STRATEGIES: Set<string> = new Set([
  'bear_breakdown',
]);

/**
 * Signal states considered "active" (having a directional opinion).
 */
export const ACTIVE_STATES: Set<string> = new Set(['active', 'active_late', 'near', 'pressure']);

/**
 * Priority weight for each active signal state.
 * Higher-conviction states contribute more to the score.
 */
export const SIGNAL_PRIORITY_WEIGHT: Record<string, number> = {
  active: 1.0,
  active_late: 1.0,
  near: 0.7,
  pressure: 0.5,
};

/**
 * Discount applied to long confluence when bear_breakdown is active.
 * Weighted by the bear signal's strength (priority × confidence).
 * A strong bear signal (active, high confidence) discounts more.
 */
const BEAR_DISCOUNT_MAX = 0.5; // Maximum discount: halves the confluence score

export interface ConfluenceResult {
  score: number;           // [0.0, 1.0]
  dominantDirection: 'long' | 'short' | 'neutral';
  agreeingCount: number;   // number of active long signals contributing
  totalActive: number;     // total number of active signals (long + short)
  bearConflict: boolean;   // true if bear_breakdown is active alongside long signals
}

/**
 * Compute the confluence score for a single ticker's signals.
 *
 * Strategy:
 * 1. Compute long confluence among long strategies only (how many agree)
 * 2. If bear_breakdown is also active, apply a discount (dead cat bounce risk)
 *
 * Pure function: no side effects, deterministic, order-invariant.
 *
 * @param signals - Array of SignalOutput for a single ticker
 * @returns ConfluenceResult with score in [0.0, 1.0]
 */
export function computeConfluence(signals: SignalOutput[]): ConfluenceResult {
  // Separate active signals into long and short buckets
  const activeLong: SignalOutput[] = [];
  const activeShort: SignalOutput[] = [];

  for (const sig of signals) {
    if (!ACTIVE_STATES.has(sig.signal)) continue;

    if (LONG_STRATEGIES.has(sig.strategy)) {
      activeLong.push(sig);
    } else if (SHORT_STRATEGIES.has(sig.strategy)) {
      activeShort.push(sig);
    }
    // Unknown strategies are ignored (not forced into either bucket)
  }

  const totalActive = activeLong.length + activeShort.length;

  // No active long signals → no meaningful confluence
  if (activeLong.length === 0) {
    // If only bear_breakdown is active, report it but score is 0
    // (short confluence is trivial with one strategy)
    return {
      score: 0.0,
      dominantDirection: activeShort.length > 0 ? 'short' : 'neutral',
      agreeingCount: 0,
      totalActive,
      bearConflict: false,
    };
  }

  // Compute weighted strength of long signals
  let longStrength = 0;
  for (const sig of activeLong) {
    const weight = SIGNAL_PRIORITY_WEIGHT[sig.signal] ?? 0;
    const confidence = Math.max(0, Math.min(1, sig.confidence));
    longStrength += weight * confidence;
  }

  // Edge case: all long signals have zero weight
  if (longStrength === 0) {
    return {
      score: 0.0,
      dominantDirection: 'neutral',
      agreeingCount: activeLong.length,
      totalActive,
      bearConflict: activeShort.length > 0,
    };
  }

  // Long confluence: scale by agreement count
  // 1 strategy = 0.5 (insufficient for agreement), 2+ = proportional to count
  // Max possible long strategies = 5, so scale = min(count/2, 1.0)
  const agreementScale = Math.min(activeLong.length / 2, 1.0);

  // Normalize strength: average weighted vote (0 to 1 range)
  const avgStrength = longStrength / activeLong.length;

  // Raw long confluence: agreement scale × average signal strength
  let score = agreementScale * avgStrength;

  // Apply bear conflict discount if bear_breakdown is active
  const bearConflict = activeShort.length > 0;
  if (bearConflict) {
    // Compute bear signal strength
    let bearStrength = 0;
    for (const sig of activeShort) {
      const weight = SIGNAL_PRIORITY_WEIGHT[sig.signal] ?? 0;
      const confidence = Math.max(0, Math.min(1, sig.confidence));
      bearStrength += weight * confidence;
    }
    // Discount proportional to bear strength (capped at BEAR_DISCOUNT_MAX)
    const discount = Math.min(bearStrength, 1.0) * BEAR_DISCOUNT_MAX;
    score = score * (1 - discount);
  }

  // Clamp to [0, 1]
  score = Math.max(0, Math.min(1, score));

  return {
    score,
    dominantDirection: 'long',
    agreeingCount: activeLong.length,
    totalActive,
    bearConflict,
  };
}
