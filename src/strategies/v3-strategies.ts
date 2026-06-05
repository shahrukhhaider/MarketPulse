/**
 * Canonical V3 strategy list — single source of truth.
 *
 * All code paths that expand 'v3' into individual strategy names
 * MUST reference this constant to prevent divergence.
 */
export const V3_STRATEGIES = [
  'consolidation_breakout',
  'trend_pullback',
  'bear_breakdown',
  'post_earnings_drift',
  'keltner_mean_reversion',
  'volume_dry_up',
] as const;

/** Union type of valid V3 strategy names. */
export type V3StrategyName = (typeof V3_STRATEGIES)[number];

/**
 * Resolve a strategy name into the list of strategies to evaluate.
 * - 'v3' expands to all V3_STRATEGIES (6 strategies).
 * - Any other name returns a single-element array containing that name.
 */
export function resolveStrategies(strategyName: string): string[] {
  if (strategyName === 'v3') {
    return [...V3_STRATEGIES];
  }
  return [strategyName];
}
