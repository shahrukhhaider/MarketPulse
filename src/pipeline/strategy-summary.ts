// ============================================================
// Strategy Summary — Shared module for building TuneSummary
// ============================================================
// Extracts the duplicated buildStrategySummary / buildV3StrategySummary
// logic from parallel-tune.ts and tune-command.ts into a single
// shared function. Also exports toWalkForwardMetrics helper.
//
// Consumers: parallel-tune.ts, tune-command.ts
// ============================================================

import { saveStrategyProfile, computeExpiry } from '../data/profile-store.js';
import type { StrategyProfile, WalkForwardMetrics } from '../data/profile-store.js';
import type { TuningPerformanceMetrics } from './tuning-engine.js';
import type { TuneResult } from './pipeline-functions.js';
import type { TuneSummary } from '../commands/tune-command.js';

// ============================================================
// toWalkForwardMetrics
// ============================================================

/**
 * Convert TuningPerformanceMetrics to WalkForwardMetrics for profile storage.
 */
export function toWalkForwardMetrics(m: TuningPerformanceMetrics): WalkForwardMetrics {
  return {
    return: m.totalReturnPercent,
    benchmark: 0,
    win_rate: m.winRate,
    trades: m.tradeCount,
    max_drawdown: m.maxDrawdownPercent,
    sharpe: m.sharpeRatio,
  };
}

// ============================================================
// buildStrategySummary
// ============================================================

/**
 * Build a TuneSummary from a single strategy's TuneResult.
 *
 * Error classification:
 * - 'insufficient data' → status `insufficient_data`
 * - 'no viable' → status `no_viable_configs`
 * - other → status `error`
 *
 * On success with shouldSave=true:
 * - Computes expiry via computeExpiry
 * - Saves profile via saveStrategyProfile
 * - Reports profile_saved status
 *
 * Success return includes: in_sample, out_of_sample,
 * configurations_evaluated, profile_saved.
 */
export function buildStrategySummary(
  ticker: string,
  strategyName: string,
  result: TuneResult | { error: string },
  shouldSave: boolean,
  dataDir: string,
): TuneSummary {
  if ('error' in result) {
    const errorMsg = result.error;
    const isInsufficientData = errorMsg.toLowerCase().includes('insufficient data');
    const isNoViable = errorMsg.toLowerCase().includes('no viable');

    if (isInsufficientData) {
      return {
        ticker,
        strategy: strategyName,
        status: 'insufficient_data',
        profile_saved: false,
        error_message: errorMsg,
      };
    } else if (isNoViable) {
      return {
        ticker,
        strategy: strategyName,
        status: 'no_viable_configs',
        profile_saved: false,
        error_message: errorMsg,
      };
    } else {
      return {
        ticker,
        strategy: strategyName,
        status: 'error',
        profile_saved: false,
        error_message: errorMsg,
      };
    }
  }

  // Successful tune — save profile if requested
  let profileSaved = false;

  if (shouldSave) {
    const lastTunedAt = new Date().toISOString();
    const validUntil = computeExpiry(lastTunedAt);

    const profile: StrategyProfile = {
      ticker,
      strategy: strategyName,
      params: result.bestParams,
      walk_forward_metrics: toWalkForwardMetrics(result.oosMetrics),
      last_tuned_at: lastTunedAt,
      valid_until: validUntil,
      oos_trades: result.oosMetrics.trades?.map((t) => ({
        entry_date: t.entryDate,
        exit_date: t.exitDate,
        entry_price: t.entryPrice,
        exit_price: t.exitPrice,
        won: t.pnlPct > 0,
      })),
    };

    const saveResult = saveStrategyProfile(profile, dataDir);
    profileSaved = saveResult.success;
  }

  return {
    ticker,
    strategy: strategyName,
    status: 'success',
    in_sample: result.isMetrics,
    out_of_sample: result.oosMetrics,
    configurations_evaluated: result.configurationsEvaluated,
    profile_saved: profileSaved,
  };
}
