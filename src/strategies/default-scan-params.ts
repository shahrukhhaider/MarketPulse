/**
 * Default scan parameters for each V3 strategy.
 *
 * These are conservative mid-point values from the large_cap (medium bucket)
 * parameter grids in parameter-grid.ts. They serve as fallback params when
 * no tuned profile exists for a ticker, enabling on-demand signal detection
 * without requiring a prior tuning run.
 *
 * Each entry is a flat Record<string, number> matching the shape expected by
 * detectSignal() and the build*Config() functions in parameter-grid.ts.
 */

import type { VolatilityBucket } from '../strategies/parameter-grid.js';

export const DEFAULT_SCAN_PARAMS: Record<string, Record<string, number>> = {
  trend_pullback: {
    pullback_proximity_pct: 5,
    atr_contraction_threshold: 0.8,
    volume_below_avg_multiplier: 1.0,
    trigger_volume_multiplier: 1.2,
    overextension_pct: 8,
    stop_atr_multiple: 2.5,
    r_multiple: 2.5,
    swing_lookback: 10,
    exit_preset: 0,
    weight_preset: 0,
  },

  consolidation_breakout: {
    consolidation_window: 10,
    max_range_pct: 8,
    atr_ratio_threshold: 0.9,
    volume_multiplier: 1.5,
    overextension_pct: 8,
    atr_multiple: 2.0,
    swing_lookback: 15,
    max_risk_pct: 5,
    r_multiple: 2.5,
    exit_preset: 0,
    weight_preset: 0,
  },

  keltner_mean_reversion: {
    ema_period: 20,
    atr_period: 14,
    band_multiplier: 2.0,
    trend_filter_period: 50,
    reclaim_lookback: 5,
    stop_atr_multiple: 1.5,
    r_multiple: 2.0,
    max_risk_pct: 5,
    band_proximity_pct: 5,
  },

  volume_dry_up: {
    consolidation_window: 15,
    max_range_pct: 8,
    atr_ratio_threshold: 1.0,
    volume_threshold_active: 0.65,
    volume_threshold_near: 0.70,
    volume_threshold_forming: 0.85,
    min_declining_days: 3,
    r_multiple: 2.0,
  },

  bear_breakdown: {
    consolidation_window: 10,
    max_range_pct: 8,
    atr_ratio_threshold: 0.9,
    volume_multiplier: 1.5,
    atr_multiple: 2.0,
    swing_lookback: 15,
    max_risk_pct: 5,
    r_multiple: 2.5,
  },
};

/**
 * Per-bucket default scan parameters for each V3 strategy.
 *
 * Structure: BUCKET_SCAN_PARAMS[bucket][strategy] → Record<string, number>
 *
 * - `medium` entries are identical to DEFAULT_SCAN_PARAMS (backward compatible)
 * - `low` entries use tighter thresholds for narrow-range instruments (ATR% < 1.5)
 * - `high` entries use wider thresholds for wide-range instruments (ATR% > 3.0)
 */
export const BUCKET_SCAN_PARAMS: Record<VolatilityBucket, Record<string, Record<string, number>>> = {
  low: {
    trend_pullback: {
      pullback_proximity_pct: 3,
      atr_contraction_threshold: 0.7,
      volume_below_avg_multiplier: 0.8,
      trigger_volume_multiplier: 1.0,
      overextension_pct: 5,
      stop_atr_multiple: 1.5,
      r_multiple: 2.5,
      swing_lookback: 10,
      exit_preset: 0,
      weight_preset: 0,
    },

    consolidation_breakout: {
      consolidation_window: 10,
      max_range_pct: 5,
      atr_ratio_threshold: 0.9,
      volume_multiplier: 1.2,
      overextension_pct: 5,
      atr_multiple: 1.5,
      swing_lookback: 15,
      max_risk_pct: 5,
      r_multiple: 2.5,
      exit_preset: 0,
      weight_preset: 0,
    },

    keltner_mean_reversion: {
      ema_period: 20,
      atr_period: 14,
      band_multiplier: 1.5,
      trend_filter_period: 50,
      reclaim_lookback: 5,
      stop_atr_multiple: 1.2,
      r_multiple: 2.0,
      max_risk_pct: 5,
      band_proximity_pct: 3,
    },

    volume_dry_up: {
      consolidation_window: 15,
      max_range_pct: 5,
      atr_ratio_threshold: 0.9,
      volume_threshold_active: 0.55,
      volume_threshold_near: 0.60,
      volume_threshold_forming: 0.75,
      min_declining_days: 3,
      r_multiple: 2.0,
    },

    bear_breakdown: {
      consolidation_window: 10,
      max_range_pct: 5,
      atr_ratio_threshold: 0.9,
      volume_multiplier: 1.2,
      atr_multiple: 1.5,
      swing_lookback: 15,
      max_risk_pct: 5,
      r_multiple: 2.5,
    },
  },

  medium: {
    trend_pullback: {
      pullback_proximity_pct: 5,
      atr_contraction_threshold: 0.8,
      volume_below_avg_multiplier: 1.0,
      trigger_volume_multiplier: 1.2,
      overextension_pct: 8,
      stop_atr_multiple: 2.5,
      r_multiple: 2.5,
      swing_lookback: 10,
      exit_preset: 0,
      weight_preset: 0,
    },

    consolidation_breakout: {
      consolidation_window: 10,
      max_range_pct: 8,
      atr_ratio_threshold: 0.9,
      volume_multiplier: 1.5,
      overextension_pct: 8,
      atr_multiple: 2.0,
      swing_lookback: 15,
      max_risk_pct: 5,
      r_multiple: 2.5,
      exit_preset: 0,
      weight_preset: 0,
    },

    keltner_mean_reversion: {
      ema_period: 20,
      atr_period: 14,
      band_multiplier: 2.0,
      trend_filter_period: 50,
      reclaim_lookback: 5,
      stop_atr_multiple: 1.5,
      r_multiple: 2.0,
      max_risk_pct: 5,
      band_proximity_pct: 5,
    },

    volume_dry_up: {
      consolidation_window: 15,
      max_range_pct: 8,
      atr_ratio_threshold: 1.0,
      volume_threshold_active: 0.65,
      volume_threshold_near: 0.70,
      volume_threshold_forming: 0.85,
      min_declining_days: 3,
      r_multiple: 2.0,
    },

    bear_breakdown: {
      consolidation_window: 10,
      max_range_pct: 8,
      atr_ratio_threshold: 0.9,
      volume_multiplier: 1.5,
      atr_multiple: 2.0,
      swing_lookback: 15,
      max_risk_pct: 5,
      r_multiple: 2.5,
    },
  },

  high: {
    trend_pullback: {
      pullback_proximity_pct: 8,
      atr_contraction_threshold: 1.0,
      volume_below_avg_multiplier: 1.2,
      trigger_volume_multiplier: 1.5,
      overextension_pct: 12,
      stop_atr_multiple: 3.0,
      r_multiple: 2.5,
      swing_lookback: 10,
      exit_preset: 0,
      weight_preset: 0,
    },

    consolidation_breakout: {
      consolidation_window: 10,
      max_range_pct: 12,
      atr_ratio_threshold: 0.9,
      volume_multiplier: 1.5,
      overextension_pct: 12,
      atr_multiple: 2.5,
      swing_lookback: 15,
      max_risk_pct: 5,
      r_multiple: 2.5,
      exit_preset: 0,
      weight_preset: 0,
    },

    keltner_mean_reversion: {
      ema_period: 20,
      atr_period: 14,
      band_multiplier: 2.5,
      trend_filter_period: 50,
      reclaim_lookback: 5,
      stop_atr_multiple: 2.0,
      r_multiple: 2.0,
      max_risk_pct: 5,
      band_proximity_pct: 8,
    },

    volume_dry_up: {
      consolidation_window: 15,
      max_range_pct: 12,
      atr_ratio_threshold: 1.0,
      volume_threshold_active: 0.70,
      volume_threshold_near: 0.75,
      volume_threshold_forming: 0.90,
      min_declining_days: 3,
      r_multiple: 2.0,
    },

    bear_breakdown: {
      consolidation_window: 10,
      max_range_pct: 12,
      atr_ratio_threshold: 0.9,
      volume_multiplier: 1.5,
      atr_multiple: 2.5,
      swing_lookback: 15,
      max_risk_pct: 5,
      r_multiple: 2.5,
    },
  },
};

/**
 * Retrieve default scan parameters for a given strategy and volatility bucket.
 *
 * Falls back to medium bucket if the requested bucket or strategy is not found.
 * This ensures backward-compatible behavior — medium-bucket params are always
 * available as the safe default.
 *
 * @param strategy - The strategy name (e.g., 'consolidation_breakout')
 * @param bucket - The volatility bucket ('low', 'medium', 'high')
 * @returns The parameter record for the given strategy/bucket combination
 */
export function getDefaultScanParams(strategy: string, bucket: VolatilityBucket): Record<string, number> {
  const bucketParams = BUCKET_SCAN_PARAMS[bucket];
  if (bucketParams && bucketParams[strategy]) {
    return bucketParams[strategy];
  }
  // Fall back to medium bucket if bucket or strategy not found
  const mediumParams = BUCKET_SCAN_PARAMS['medium'];
  if (mediumParams && mediumParams[strategy]) {
    return mediumParams[strategy];
  }
  // Ultimate fallback: return from the flat DEFAULT_SCAN_PARAMS
  return DEFAULT_SCAN_PARAMS[strategy] ?? {};
}
