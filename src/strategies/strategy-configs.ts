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
    { type: 'hold_days', days: 5 },
  ],
  riskRule: { type: 'atr_multiple', atrPeriod: 14, multiple: 2.0 },
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
    { type: 'hold_days', days: 7 },
  ],
  riskRule: { type: 'atr_multiple', atrPeriod: 14, multiple: 2.0 },
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
    { type: 'hold_days', days: 5 },
  ],
  riskRule: { type: 'atr_multiple', atrPeriod: 14, multiple: 2.0 },
};

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
