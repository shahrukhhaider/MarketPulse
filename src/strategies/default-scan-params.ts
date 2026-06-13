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
