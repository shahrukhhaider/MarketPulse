// ============================================================
// combine-profiles — Aggregate per-strategy profiles into combined metrics
// ============================================================
// Used by generate-manifest.ts and backtest-routes.ts to compute
// combined walk-forward metrics from a set of saved strategy profiles
// without re-running the backtest engine.
// ============================================================

import type { StrategyProfile } from '../data/profile-store.js';

// ============================================================
// Output Type
// ============================================================

export interface CombinedProfileMetrics {
  /** Equal-weight average of per-strategy cumulative returns */
  return: number;
  /** Trade-count-weighted win rate across all strategies */
  win_rate: number;
  /** Sum of trades across all strategies */
  trades: number;
  /** Max of per-strategy max_drawdowns (conservative proxy) */
  max_drawdown: number;
  /** Trade-count-weighted Sharpe ratio across all strategies */
  sharpe: number;
  /** Number of strategies included in the combined metrics */
  strategy_count: number;
}

// ============================================================
// computeCombinedFromProfiles
// ============================================================

/**
 * Aggregate walk_forward_metrics from a list of passing strategy profiles.
 *
 * Input profiles should already be filtered (trades > 0, return >= 0).
 * Returns zero metrics if the profiles array is empty.
 *
 * Methodology mirrors computeCombinedMetrics() in pipeline-functions.ts:
 * - return:       equal-weight average of cumulative per-strategy returns
 *                 i.e. avg((1 + r_i/100)) - 1) * 100
 * - win_rate:     trade-count-weighted average
 * - trades:       simple sum
 * - max_drawdown: max across strategies (conservative — no time-ordering available)
 * - sharpe:       trade-count-weighted average
 */
export function computeCombinedFromProfiles(profiles: StrategyProfile[]): CombinedProfileMetrics {
  if (profiles.length === 0) {
    return { return: 0, win_rate: 0, trades: 0, max_drawdown: 0, sharpe: 0, strategy_count: 0 };
  }

  const totalTrades = profiles.reduce((sum, p) => sum + p.walk_forward_metrics.trades, 0);

  // Equal-weight cumulative return: average of (1 + r_i/100), convert back to %
  const avgCumulative =
    profiles.reduce((sum, p) => sum + (1 + p.walk_forward_metrics.return / 100), 0) /
    profiles.length;
  const combinedReturn = (avgCumulative - 1) * 100;

  // Trade-count-weighted win rate
  const combinedWinRate =
    totalTrades > 0
      ? profiles.reduce(
          (sum, p) => sum + p.walk_forward_metrics.win_rate * p.walk_forward_metrics.trades,
          0
        ) / totalTrades
      : 0;

  // Max of per-strategy max drawdowns
  const combinedMaxDrawdown = Math.max(
    ...profiles.map((p) => p.walk_forward_metrics.max_drawdown)
  );

  // Trade-count-weighted Sharpe
  const combinedSharpe =
    totalTrades > 0
      ? profiles.reduce(
          (sum, p) => sum + p.walk_forward_metrics.sharpe * p.walk_forward_metrics.trades,
          0
        ) / totalTrades
      : 0;

  return {
    return: combinedReturn,
    win_rate: combinedWinRate,
    trades: totalTrades,
    max_drawdown: combinedMaxDrawdown,
    sharpe: combinedSharpe,
    strategy_count: profiles.length,
  };
}
