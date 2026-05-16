import type { FilterCondition } from './filter-evaluator.js';
import type { HistoricalDataPoint, StrategyType } from '../types.js';
import type { IndicatorCache } from '../indicators/indicator-cache.js';
import type { ConfidenceWeightsConfig } from '../indicators/confidence-score.js';
import type { Result } from '../data/config-store.js';

// ============================================================
// Exit Rule Types
// ============================================================

export type ExitRule =
  | { type: 'hold_days'; days: number }
  | { type: 'rsi_above'; period: number; threshold: number }
  | { type: 'rsi_below'; period: number; threshold: number }
  | { type: 'price_below_sma'; period: number }
  | { type: 'price_above_sma'; period: number };

// ============================================================
// Risk Rule Types
// ============================================================

export type RiskRule =
  | { type: 'atr_multiple'; atrPeriod: number; multiple: number }
  | { type: 'percentage'; percentage: number };

// ============================================================
// Strategy Configuration
// ============================================================

export interface StrategyConfiguration {
  name: string;
  directionFilters: FilterCondition[];
  timingFilters: FilterCondition[];
  confirmationFilters: FilterCondition[];
  exitRules: ExitRule[];
  riskRule?: RiskRule;
  indexTicker?: string;

  // Confidence-score fields (all optional for backward compatibility)
  signalMode?: 'binary' | 'confidence';
  confidenceThreshold?: number;   // (0, 1], default 0.6
  directionWeight?: number;       // >= 0, default 1.0
  timingWeight?: number;          // >= 0, default 1.0
  confirmationWeight?: number;    // >= 0, default 1.0
}

// ============================================================
// Composite Strategy Params
// ============================================================

export interface CompositeStrategyParams {
  config: StrategyConfiguration;
  auxiliaryData?: Record<string, HistoricalDataPoint[]>;
  primaryDataPoints?: HistoricalDataPoint[];
}

// ============================================================
// V2 Phased Strategy Types
// ============================================================

export interface PhaseDefinition {
  conditions: FilterCondition[];
  logic: 'ALL' | 'ANY';
}

export interface PhasedStrategyConfiguration {
  name: string;
  phases: {
    direction: PhaseDefinition;  // ALL-of logic
    setup: PhaseDefinition;      // ANY-of logic
    trigger: PhaseDefinition;    // ALL-of logic
  };
  stopLoss: {
    atr_period: number;          // default 14
    atr_multiple: number;        // default 1.5
    swing_low_lookback: number;  // default 10
    swing_buffer_atr: number;    // default 0.3
  };
  profitTarget: {
    target_r_multiple: number;   // default 2
  };
  trendExit: {
    trend_exit_sma_period: number; // default 50
  };
  maxRisk: {
    max_risk_pct: number;        // default 3
  };
  min_hold_days: number;         // 7 (short_term) or 30 (long_term), NOT tunable
}

export interface PhasedStrategyParams {
  config: PhasedStrategyConfiguration;
  primaryDataPoints?: HistoricalDataPoint[];
}

// ============================================================
// Default Strategy Configurations
// ============================================================

export const MOMENTUM_CONTINUATION_CONFIG: StrategyConfiguration = {
  name: 'momentum_continuation',
  directionFilters: [
    { type: 'return_above', period: 20, threshold: 10 },
    { type: 'price_above_sma', period: 50 },
  ],
  timingFilters: [
    { type: 'return_above', period: 3, threshold: 3 },
  ],
  confirmationFilters: [
    { type: 'outperforms_index', period: 20, indexTicker: 'SPY' },
  ],
  exitRules: [
    { type: 'hold_days', days: 63 },
    { type: 'price_below_sma', period: 10 },
    { type: 'rsi_above', period: 14, threshold: 70 },
  ],
  riskRule: { type: 'atr_multiple', atrPeriod: 14, multiple: 5.0 },
  indexTicker: 'SPY',
};

export const TREND_PULLBACK_CONFIG: StrategyConfiguration = {
  name: 'trend_pullback',
  directionFilters: [
    { type: 'price_above_sma', period: 50 },
    { type: 'sma_above_sma', shortPeriod: 50, longPeriod: 200 },
  ],
  timingFilters: [
    { type: 'rsi_below', period: 14, threshold: 40 },
    { type: 'price_near_sma', period: 50, tolerance: 0.02 },
  ],
  confirmationFilters: [
    { type: 'volume_below_avg', period: 20 },
  ],
  exitRules: [
    { type: 'rsi_above', period: 14, threshold: 60 },
    { type: 'hold_days', days: 63 },
    { type: 'price_below_sma', period: 10 },
  ],
  riskRule: { type: 'atr_multiple', atrPeriod: 14, multiple: 5.0 },
};

export const BREAKOUT_VOLUME_CONFIG: StrategyConfiguration = {
  name: 'breakout_volume',
  directionFilters: [
    { type: 'price_above_sma', period: 50 },
  ],
  timingFilters: [
    { type: 'price_above_highest', period: 20 },
  ],
  confirmationFilters: [
    { type: 'volume_above_avg', period: 20, multiplier: 1.5 },
  ],
  exitRules: [
    { type: 'price_below_sma', period: 10 },
    { type: 'hold_days', days: 63 },
    { type: 'rsi_above', period: 14, threshold: 70 },
  ],
  riskRule: { type: 'atr_multiple', atrPeriod: 14, multiple: 5.0 },
};



// ============================================================
// V3 Consolidation Breakout Strategy Types
// ============================================================

export interface ConsolidationBreakoutConfiguration {
  name: string;
  consolidation: {
    consolidation_window: number;     // 5, 10, 15
    max_range_pct: number;            // 4, 6, 8
    atr_ratio_threshold: number;      // 0.8, 1.0
    sma_proximity_pct?: number;       // 2, 3 (optional)
    max_staleness: number;            // fixed 20
  };
  breakout: {
    volume_multiplier: number;        // 1.2, 1.5
    return_20d_threshold?: number;    // 3, 5, 8 (optional)
  };
  direction: {
    require_sma20_above_sma50: boolean;
    require_sma50_slope_positive: boolean;
  };
  overextension: {
    overextension_pct: number;        // 5, 8, 12
  };
  stopLoss: {
    atr_multiple: number;             // 1.2, 1.6, 2.0
    swing_lookback: number;           // 10, 15, 20
    buffer: number;                   // fixed 0.3
  };
  profitTarget: {
    r_multiple: number;               // 2, 2.5, 3
  };
  maxRisk: {
    max_risk_pct: number;             // 2, 3, 4
  };
  trendExit: {
    trend_exit_sma_period: number;    // fixed 50
  };

  exitMode?: 'fixed' | 'trailing';  // default: 'fixed'

  trailingStop?: {
    trailingMethod: 'sma20' | 'atr';
    atrTrailMultiple?: number;           // required when trailingMethod is 'atr', > 0
    atrTrailReference?: 'close' | 'highest_close'; // required when trailingMethod is 'atr'
    smaTrailBuffer?: number;             // required when trailingMethod is 'sma20', >= 0
    breakevenThreshold: number;          // R-multiples, > 0, default 1.0
    trailActivationThreshold: number;    // R-multiples, >= breakevenThreshold, default 2.0
    removeProfitTarget: boolean;         // default false
  };

  confidenceWeights?: ConfidenceWeightsConfig;
}

export interface ConsolidationBreakoutParams {
  config: ConsolidationBreakoutConfiguration;
  primaryDataPoints?: HistoricalDataPoint[];
  cache?: IndicatorCache;
}

// ============================================================
// V3 Trend Pullback Strategy Types
// ============================================================

export interface TrendPullbackConfiguration {
  name: string;
  direction: {
    require_sma20_above_sma50: boolean;
    require_sma50_slope_positive: boolean;
  };
  pullback: {
    pullback_proximity_pct: number;
    atr_contraction_threshold: number;
    volume_below_avg_multiplier: number;
    swing_lookback: number;
    max_pullback_staleness: number;
  };
  trigger: {
    trigger_volume_multiplier: number;
  };
  overextension: {
    overextension_pct: number;
  };
  stopLoss: {
    stop_atr_multiple: number;
    stop_buffer_atr: number;
  };
  profitTarget: {
    r_multiple: number;
  };
  trendExit: {
    trend_exit_sma_period: number;
  };
  exitMode: 'fixed' | 'trailing';
  trailingStop?: {
    trailingMethod: 'sma20' | 'atr';
    atrTrailMultiple?: number;
    atrTrailReference?: 'close' | 'highest_close';
    smaTrailBuffer?: number;
    breakeven_threshold: number;
    trail_activation_threshold: number;
    remove_profit_target: boolean;
  };

  confidenceWeights?: ConfidenceWeightsConfig;
}

export interface TrendPullbackParams {
  config: TrendPullbackConfiguration;
  primaryDataPoints?: HistoricalDataPoint[];
  cache?: IndicatorCache;
}

// ============================================================
// V3 Bear Breakdown Strategy Types
// ============================================================

export interface BearBreakdownConfiguration {
  name: string;
  consolidation: {
    consolidation_window: number;     // 5, 10, 15
    max_range_pct: number;            // 4, 6, 8
    atr_ratio_threshold: number;      // 0.8, 1.0
    max_staleness: number;            // fixed 20
  };
  breakdown: {
    volume_multiplier: number;        // 1.2, 1.5
  };
  stopLoss: {
    atr_multiple: number;             // 1.2, 1.6, 2.0
    swing_lookback: number;           // 10, 15, 20
    buffer: number;                   // fixed 0.3
  };
  profitTarget: {
    r_multiple: number;               // 2, 2.5, 3
  };
  maxRisk: {
    max_risk_pct: number;             // 3, 5, 8
  };
  exitMode: 'fixed';                  // always fixed, no trailing
}

export interface BearBreakdownParams {
  config: BearBreakdownConfiguration;
  primaryDataPoints?: HistoricalDataPoint[];
  cache?: IndicatorCache;
}

// ============================================================
// V3 Post-Earnings Drift Strategy Types
// ============================================================

export interface PostEarningsDriftConfiguration {
  gap_min_pct: number;                // default 5, range [1, 50]
  gap_volume_multiplier: number;      // default 1.5, range [1.0, 10.0]
  consolidation_min_days: number;     // default 3, range [1, 30]
  consolidation_max_days: number;     // default 10, range [2, 60]
  max_range_pct: number;              // default 5, range [1, 30]
  breakout_volume_multiplier: number; // default 1.2, range [1.0, 10.0]
  stop_buffer_atr: number;            // default 0.3, range [0.1, 3.0]
  r_multiple: number;                 // default 2.5, range [0.5, 10.0]
  max_risk_pct: number;               // default 8, range [1, 25]
  trend_exit_sma_period: number;      // default 50, range [5, 200]
}

export interface PostEarningsDriftParams {
  config: PostEarningsDriftConfiguration;
  earningsDates: string[];  // ISO dates for this ticker
}

export const DEFAULT_PEAD_CONFIG: PostEarningsDriftConfiguration = {
  gap_min_pct: 5,
  gap_volume_multiplier: 1.5,
  consolidation_min_days: 3,
  consolidation_max_days: 10,
  max_range_pct: 5,
  breakout_volume_multiplier: 1.2,
  stop_buffer_atr: 0.3,
  r_multiple: 2.5,
  max_risk_pct: 8,
  trend_exit_sma_period: 50,
};

interface PeadParamRange {
  min: number;
  max: number;
}

const PEAD_PARAM_RANGES: Record<keyof PostEarningsDriftConfiguration, PeadParamRange> = {
  gap_min_pct: { min: 1, max: 50 },
  gap_volume_multiplier: { min: 1.0, max: 10.0 },
  consolidation_min_days: { min: 1, max: 30 },
  consolidation_max_days: { min: 2, max: 60 },
  max_range_pct: { min: 1, max: 30 },
  breakout_volume_multiplier: { min: 1.0, max: 10.0 },
  stop_buffer_atr: { min: 0.1, max: 3.0 },
  r_multiple: { min: 0.5, max: 10.0 },
  max_risk_pct: { min: 1, max: 25 },
  trend_exit_sma_period: { min: 5, max: 200 },
};

export function validatePeadConfig(config: PostEarningsDriftConfiguration): Result<PostEarningsDriftConfiguration> {
  for (const [key, range] of Object.entries(PEAD_PARAM_RANGES)) {
    const value = config[key as keyof PostEarningsDriftConfiguration];
    if (value < range.min || value > range.max) {
      return { success: false, error: `Parameter '${key}' value ${value} is outside valid range [${range.min}, ${range.max}]` };
    }
  }

  if (config.consolidation_min_days >= config.consolidation_max_days) {
    return { success: false, error: `consolidation_min_days (${config.consolidation_min_days}) must be less than consolidation_max_days (${config.consolidation_max_days})` };
  }

  return { success: true, data: config };
}

export function mergePeadConfig(partial?: Partial<PostEarningsDriftConfiguration>): PostEarningsDriftConfiguration {
  if (!partial) {
    return { ...DEFAULT_PEAD_CONFIG };
  }
  return { ...DEFAULT_PEAD_CONFIG, ...partial };
}

// ============================================================
// V3 Keltner Mean Reversion Strategy Types
// ============================================================

export interface KeltnerMeanReversionConfiguration {
  ema_period: number;           // EMA period for midline (default: 20)
  atr_period: number;           // ATR period for band width (default: 14)
  band_multiplier: number;      // Band width multiplier (default: 2.0)
  trend_filter_period: number;  // SMA period for uptrend filter (default: 50)
  reclaim_lookback: number;     // Bars to look back for dip detection (default: 5)
  stop_atr_multiple: number;    // ATR multiple for stop-loss (default: 1.5)
  r_multiple: number;           // Risk-reward multiple for profit target (default: 2.0)
  max_risk_pct: number;         // Maximum acceptable risk percentage (default: 5.0)
  band_proximity_pct: number;   // Distance threshold for "forming" state (default: 3.0)
}

export interface KeltnerMeanReversionParams {
  config: KeltnerMeanReversionConfiguration;
  primaryDataPoints?: HistoricalDataPoint[];
  cache?: IndicatorCache;
}

export const DEFAULT_KMR_CONFIG: KeltnerMeanReversionConfiguration = {
  ema_period: 20,
  atr_period: 14,
  band_multiplier: 2.0,
  trend_filter_period: 50,
  reclaim_lookback: 5,
  stop_atr_multiple: 1.5,
  r_multiple: 2.0,
  max_risk_pct: 5.0,
  band_proximity_pct: 3.0,
};

// ============================================================
// Configuration Detection Helpers
// ============================================================

export function isConsolidationBreakoutConfig(config: any): config is ConsolidationBreakoutConfiguration {
  return config && typeof config.consolidation === 'object';
}

export function isTrendPullbackConfig(config: any): config is TrendPullbackConfiguration {
  return config && typeof config.pullback === 'object' && typeof config.trigger === 'object';
}

export function isV2Config(config: any): config is PhasedStrategyConfiguration {
  return config && typeof config.phases === 'object';
}

export function isV1Config(config: any): config is StrategyConfiguration {
  return config && Array.isArray(config.directionFilters);
}

// ============================================================
// Config Lookup
// ============================================================

const configMap: Record<string, StrategyConfiguration> = {
  momentum_continuation: MOMENTUM_CONTINUATION_CONFIG,
  trend_pullback: TREND_PULLBACK_CONFIG,
  breakout_volume: BREAKOUT_VOLUME_CONFIG,
};

export function getDefaultCompositeConfig(strategyType: StrategyType): StrategyConfiguration {
  const config = configMap[strategyType];
  if (!config) {
    throw new Error(`No default composite config for strategy type: ${strategyType}`);
  }
  return config;
}
