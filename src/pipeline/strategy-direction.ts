// ============================================================
// Strategy Direction & Signal Priority Maps
// ============================================================
// Single shared location for direction and priority constants.
// Imported by the signal pipeline and any module needing these maps.
// ============================================================

/**
 * Maps each strategy to its directional bias.
 * Used during conflict resolution to determine which direction wins
 * when a ticker has both long and short actionable signals.
 */
export const STRATEGY_DIRECTION: Record<string, 'long' | 'short'> = {
  consolidation_breakout: 'long',
  trend_pullback: 'long',
  post_earnings_drift: 'long',
  keltner_mean_reversion: 'long',
  bear_breakdown: 'short',
};

/**
 * Maps each signal state to a numeric priority (lower = higher priority).
 * Used for conflict resolution tie-breaking and tier grouping.
 */
export const SIGNAL_PRIORITY: Record<string, number> = {
  active: 0,
  active_late: 1,
  extended: 2,
  pressure: 3,
  near: 4,
  forming: 5,
  none: 6,
};
