import type { StrategyConfiguration, PhasedStrategyConfiguration, ConsolidationBreakoutConfiguration } from './strategies/strategy-configs.js';
import type { TimeHorizon, TunableStrategy } from './tuning-engine.js';

export type { TimeHorizon, TunableStrategy } from './tuning-engine.js';

export type ParameterSpace = Record<string, number[]>;

export interface GridEntry {
  params: Record<string, number>;
  config: StrategyConfiguration;
}

export interface V2GridEntry {
  params: Record<string, number>;
  config: PhasedStrategyConfiguration;
}

export interface ConsolidationBreakoutGridEntry {
  params: Record<string, number>;
  config: ConsolidationBreakoutConfiguration;
}

/**
 * Return the parameter space for a given strategy and time horizon.
 */
export function getParameterSpace(
  strategy: TunableStrategy,
  horizon: TimeHorizon
): ParameterSpace {
  switch (strategy) {
    case 'trend_pullback':
      return getTrendPullbackSpace(horizon);
    case 'breakout_volume':
      return getBreakoutVolumeSpace(horizon);
    case 'momentum_continuation':
      return getMomentumContinuationSpace(horizon);
  }
}

function getTrendPullbackSpace(horizon: TimeHorizon): ParameterSpace {
  if (horizon === 'short_term') {
    return {
      sma_fast: [20, 30, 50],
      sma_slow: [100, 150, 200],
      rsi_threshold: [35, 40, 45],
      atr_stop_multiple: [1.5, 2.0, 2.5],
      hold_days: [7],
      exit_sma_period: [5, 10, 20],
      exit_rsi_threshold: [65, 70, 75, 80],
      confidence_threshold: [0.5, 0.6, 0.7],
      direction_weight: [0.5, 1.0],
      timing_weight: [0.5, 1.0],
      confirmation_weight: [0.5, 1.0],
    };
  }
  return {
    sma_fast: [50, 100],
    sma_slow: [200, 300],
    rsi_threshold: [40, 50],
    atr_stop_multiple: [2.0, 3.0],
    hold_days: [15],
    exit_sma_period: [10, 20, 50],
    exit_rsi_threshold: [65, 70, 75, 80],
    confidence_threshold: [0.5, 0.6, 0.7],
    direction_weight: [0.5, 1.0],
    timing_weight: [0.5, 1.0],
    confirmation_weight: [0.5, 1.0],
  };
}

function getBreakoutVolumeSpace(horizon: TimeHorizon): ParameterSpace {
  if (horizon === 'short_term') {
    return {
      sma_trend_period: [20, 50],
      breakout_period: [10, 20, 30],
      volume_avg_period: [10, 20],
      volume_multiplier: [1.5, 2.0, 2.5],
      atr_stop_multiple: [1.5, 2.0, 2.5],
      hold_days: [7],
      exit_sma_period: [5, 10, 20],
      exit_rsi_threshold: [65, 70, 75, 80],
      confidence_threshold: [0.5, 0.6, 0.7],
      direction_weight: [0.5, 1.0],
      timing_weight: [0.5, 1.0],
      confirmation_weight: [0.5, 1.0],
    };
  }
  return {
    sma_trend_period: [50, 100],
    breakout_period: [20, 50],
    volume_avg_period: [20, 50],
    volume_multiplier: [1.5, 2.0],
    atr_stop_multiple: [2.0, 3.0],
    hold_days: [15],
    exit_sma_period: [10, 20, 50],
    exit_rsi_threshold: [65, 70, 75, 80],
    confidence_threshold: [0.5, 0.6, 0.7],
    direction_weight: [0.5, 1.0],
    timing_weight: [0.5, 1.0],
    confirmation_weight: [0.5, 1.0],
  };
}

function getMomentumContinuationSpace(horizon: TimeHorizon): ParameterSpace {
  if (horizon === 'short_term') {
    return {
      return_period: [10, 20, 30],
      return_threshold: [5, 10, 15],
      sma_period: [20, 50],
      short_return_period: [3, 5],
      short_return_threshold: [2, 3, 5],
      atr_stop_multiple: [1.5, 2.0, 2.5],
      hold_days: [7],
      exit_sma_period: [5, 10, 20],
      exit_rsi_threshold: [65, 70, 75, 80],
      confidence_threshold: [0.5, 0.6, 0.7],
      direction_weight: [0.5, 1.0],
      timing_weight: [0.5, 1.0],
      confirmation_weight: [0.5, 1.0],
    };
  }
  return {
    return_period: [20, 60],
    return_threshold: [10, 20],
    sma_period: [50, 100],
    short_return_period: [5, 10],
    short_return_threshold: [3, 5],
    atr_stop_multiple: [2.0, 3.0],
    hold_days: [15],
    exit_sma_period: [10, 20, 50],
    exit_rsi_threshold: [65, 70, 75, 80],
    confidence_threshold: [0.5, 0.6, 0.7],
    direction_weight: [0.5, 1.0],
    timing_weight: [0.5, 1.0],
    confirmation_weight: [0.5, 1.0],
  };
}

/**
 * Compute the Cartesian product of all parameter value arrays,
 * mapping each combination to a valid StrategyConfiguration.
 */
export function generateGrid(
  strategy: TunableStrategy,
  horizon: TimeHorizon
): GridEntry[] {
  const space = getParameterSpace(strategy, horizon);
  const paramNames = Object.keys(space);
  const paramArrays = paramNames.map(name => space[name]);

  const combinations = cartesianProduct(paramArrays);

  return combinations.map(values => {
    const params: Record<string, number> = {};
    paramNames.forEach((name, i) => {
      params[name] = values[i];
    });
    const config = buildConfig(strategy, params);
    return { params, config };
  });
}

/**
 * Compute the Cartesian product of an array of number arrays.
 */
function cartesianProduct(arrays: number[][]): number[][] {
  if (arrays.length === 0) return [[]];

  return arrays.reduce<number[][]>(
    (acc, arr) => {
      const result: number[][] = [];
      for (const existing of acc) {
        for (const value of arr) {
          result.push([...existing, value]);
        }
      }
      return result;
    },
    [[]]
  );
}

/**
 * Map a parameter combination to a StrategyConfiguration for the given strategy.
 */
export function buildConfig(
  strategy: TunableStrategy,
  params: Record<string, number>
): StrategyConfiguration {
  switch (strategy) {
    case 'trend_pullback':
      return buildTrendPullbackConfig(params);
    case 'breakout_volume':
      return buildBreakoutVolumeConfig(params);
    case 'momentum_continuation':
      return buildMomentumContinuationConfig(params);
  }
}

function buildTrendPullbackConfig(params: Record<string, number>): StrategyConfiguration {
  return {
    name: 'trend_pullback',
    directionFilters: [
      { type: 'price_above_sma', period: params.sma_fast },
      { type: 'sma_above_sma', shortPeriod: params.sma_fast, longPeriod: params.sma_slow },
    ],
    timingFilters: [
      { type: 'rsi_below', period: 14, threshold: params.rsi_threshold },
      { type: 'price_near_sma', period: params.sma_fast, tolerance: 0.02 },
    ],
    confirmationFilters: [
      { type: 'volume_below_avg', period: 20 },
    ],
    exitRules: [
      { type: 'rsi_above', period: 14, threshold: params.exit_rsi_threshold },
      { type: 'hold_days', days: params.hold_days },
      { type: 'price_below_sma', period: params.exit_sma_period },
    ],
    riskRule: { type: 'atr_multiple', atrPeriod: 14, multiple: params.atr_stop_multiple },
    signalMode: 'confidence',
    confidenceThreshold: params.confidence_threshold,
    directionWeight: params.direction_weight,
    timingWeight: params.timing_weight,
    confirmationWeight: params.confirmation_weight,
  };
}

function buildBreakoutVolumeConfig(params: Record<string, number>): StrategyConfiguration {
  return {
    name: 'breakout_volume',
    directionFilters: [
      { type: 'price_above_sma', period: params.sma_trend_period },
    ],
    timingFilters: [
      { type: 'price_above_highest', period: params.breakout_period },
    ],
    confirmationFilters: [
      { type: 'volume_above_avg', period: params.volume_avg_period, multiplier: params.volume_multiplier },
    ],
    exitRules: [
      { type: 'price_below_sma', period: params.exit_sma_period },
      { type: 'hold_days', days: params.hold_days },
      { type: 'rsi_above', period: 14, threshold: params.exit_rsi_threshold },
    ],
    riskRule: { type: 'atr_multiple', atrPeriod: 14, multiple: params.atr_stop_multiple },
    signalMode: 'confidence',
    confidenceThreshold: params.confidence_threshold,
    directionWeight: params.direction_weight,
    timingWeight: params.timing_weight,
    confirmationWeight: params.confirmation_weight,
  };
}

function buildMomentumContinuationConfig(params: Record<string, number>): StrategyConfiguration {
  return {
    name: 'momentum_continuation',
    directionFilters: [
      { type: 'return_above', period: params.return_period, threshold: params.return_threshold },
      { type: 'price_above_sma', period: params.sma_period },
    ],
    timingFilters: [
      { type: 'return_above', period: params.short_return_period, threshold: params.short_return_threshold },
    ],
    confirmationFilters: [
      { type: 'outperforms_index', period: params.return_period, indexTicker: 'SPY' },
    ],
    exitRules: [
      { type: 'hold_days', days: params.hold_days },
      { type: 'price_below_sma', period: params.exit_sma_period },
      { type: 'rsi_above', period: 14, threshold: params.exit_rsi_threshold },
    ],
    riskRule: { type: 'atr_multiple', atrPeriod: 14, multiple: params.atr_stop_multiple },
    indexTicker: 'SPY',
    signalMode: 'confidence',
    confidenceThreshold: params.confidence_threshold,
    directionWeight: params.direction_weight,
    timingWeight: params.timing_weight,
    confirmationWeight: params.confirmation_weight,
  };
}

/**
 * Return the V2 parameter space with 6 tunable parameters.
 * Total combinations: 3 × 3 × 3 × 3 × 2 × 3 = 486
 */
export function getV2ParameterSpace(): ParameterSpace {
  return {
    rsi_threshold: [40, 45, 50],
    return_20d: [3, 4, 6],
    distance_to_sma50: [3, 5, 8],
    atr_multiple: [1.2, 1.5, 2.0],
    target_r_multiple: [2, 3],
    swing_low_lookback: [5, 10, 20],
  };
}

/**
 * Map a V2 parameter combination to a PhasedStrategyConfiguration.
 */
export function buildV2Config(
  params: Record<string, number>,
  minHoldDays: number
): PhasedStrategyConfiguration {
  return {
    name: 'phased_momentum',
    phases: {
      direction: {
        conditions: [
          { type: 'price_above_sma', period: 50 },
          { type: 'sma_above_sma', shortPeriod: 50, longPeriod: 200 },
        ],
        logic: 'ALL',
      },
      setup: {
        conditions: [
          { type: 'price_below_sma', period: 20 },
          { type: 'rsi_below', period: 14, threshold: params.rsi_threshold },
        ],
        logic: 'ANY',
      },
      trigger: {
        conditions: [
          { type: 'return_above', period: 20, threshold: params.return_20d },
          { type: 'price_near_sma', period: 50, tolerance: params.distance_to_sma50 / 100 },
        ],
        logic: 'ALL',
      },
    },
    stopLoss: {
      atr_period: 14,
      atr_multiple: params.atr_multiple,
      swing_low_lookback: Math.round(params.swing_low_lookback),
      swing_buffer_atr: 0.3,
    },
    profitTarget: {
      target_r_multiple: params.target_r_multiple,
    },
    trendExit: {
      trend_exit_sma_period: 50,
    },
    maxRisk: {
      max_risk_pct: 3,
    },
    min_hold_days: minHoldDays,
  };
}

/**
 * Generate the full V2 parameter grid using Cartesian product.
 * Sets min_hold_days to 7 for short_term, 30 for long_term.
 */
export function generateV2Grid(horizon: TimeHorizon): V2GridEntry[] {
  const space = getV2ParameterSpace();
  const paramNames = Object.keys(space);
  const paramArrays = paramNames.map(name => space[name]);
  const minHoldDays = horizon === 'short_term' ? 7 : 30;

  const combinations = cartesianProduct(paramArrays);

  return combinations.map(values => {
    const params: Record<string, number> = {};
    paramNames.forEach((name, i) => {
      params[name] = values[i];
    });
    const config = buildV2Config(params, minHoldDays);
    return { params, config };
  });
}

/**
 * Serialize a GridEntry to a JSON string.
 */
export function serializeGridEntry(entry: GridEntry): string {
  return JSON.stringify(entry);
}

/**
 * Deserialize a JSON string back to a GridEntry.
 */
export function deserializeGridEntry(json: string): GridEntry {
  return JSON.parse(json) as GridEntry;
}

/**
 * Return the consolidation-breakout parameter space with 9 tunable parameters.
 * Total combinations: 3×3×2×2×3×3×3×3×3 = 4,374
 */
export function getConsolidationBreakoutParameterSpace(): ParameterSpace {
  return {
    consolidation_window: [5, 10, 15],
    max_range_pct: [4, 6, 8],
    atr_ratio_threshold: [0.8, 1.0],
    volume_multiplier: [1.2, 1.5],
    overextension_pct: [5, 8, 12],
    atr_multiple: [1.2, 1.6, 2.0],
    swing_lookback: [10, 15, 20],
    max_risk_pct: [3, 5, 8],
    r_multiple: [2, 2.5, 3],
  };
}

/**
 * Map a flat parameter combination to a ConsolidationBreakoutConfiguration.
 * Fixed values: max_staleness=20, buffer=0.3, trend_exit_sma_period=50,
 * direction flags=false, optional fields=undefined.
 */
export function buildConsolidationBreakoutConfig(
  params: Record<string, number>
): ConsolidationBreakoutConfiguration {
  return {
    name: `cb_w${params.consolidation_window}_r${params.max_range_pct}_atr${params.atr_ratio_threshold}_vol${params.volume_multiplier}_oe${params.overextension_pct}_am${params.atr_multiple}_sl${params.swing_lookback}_mr${params.max_risk_pct}_rm${params.r_multiple}`,
    consolidation: {
      consolidation_window: params.consolidation_window,
      max_range_pct: params.max_range_pct,
      atr_ratio_threshold: params.atr_ratio_threshold,
      sma_proximity_pct: undefined,
      max_staleness: 20,
    },
    breakout: {
      volume_multiplier: params.volume_multiplier,
      return_20d_threshold: undefined,
    },
    direction: {
      require_sma20_above_sma50: false,
      require_sma50_slope_positive: false,
    },
    overextension: {
      overextension_pct: params.overextension_pct,
    },
    stopLoss: {
      atr_multiple: params.atr_multiple,
      swing_lookback: params.swing_lookback,
      buffer: 0.3,
    },
    profitTarget: {
      r_multiple: params.r_multiple,
    },
    maxRisk: {
      max_risk_pct: params.max_risk_pct,
    },
    trendExit: {
      trend_exit_sma_period: 50,
    },
  };
}

/**
 * Generate the full consolidation-breakout parameter grid using Cartesian product.
 * Produces 4,374 entries.
 */
export function generateConsolidationBreakoutGrid(): ConsolidationBreakoutGridEntry[] {
  const space = getConsolidationBreakoutParameterSpace();
  const paramNames = Object.keys(space);
  const paramArrays = paramNames.map(name => space[name]);

  const combinations = cartesianProduct(paramArrays);

  return combinations.map(values => {
    const params: Record<string, number> = {};
    paramNames.forEach((name, i) => {
      params[name] = values[i];
    });
    const config = buildConsolidationBreakoutConfig(params);
    return { params, config };
  });
}
