import type { FilterCondition } from './filter-evaluator.js';
import type { HistoricalDataPoint, StrategyType } from '../types.js';

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
// Configuration Detection Helpers
// ============================================================

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
