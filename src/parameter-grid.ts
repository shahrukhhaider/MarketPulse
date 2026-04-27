import type { StrategyConfiguration } from './strategies/strategy-configs.js';
import type { TimeHorizon, TunableStrategy } from './tuning-engine.js';

export type { TimeHorizon, TunableStrategy } from './tuning-engine.js';

export type ParameterSpace = Record<string, number[]>;

export interface GridEntry {
  params: Record<string, number>;
  config: StrategyConfiguration;
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
      hold_days: [5, 10, 15],
    };
  }
  return {
    sma_fast: [50, 100],
    sma_slow: [200, 300],
    rsi_threshold: [40, 50],
    atr_stop_multiple: [2.0, 3.0],
    hold_days: [60, 120, 250],
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
      hold_days: [5, 10, 15],
    };
  }
  return {
    sma_trend_period: [50, 100],
    breakout_period: [20, 50],
    volume_avg_period: [20, 50],
    volume_multiplier: [1.5, 2.0],
    atr_stop_multiple: [2.0, 3.0],
    hold_days: [60, 120, 250],
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
      hold_days: [5, 10, 15],
    };
  }
  return {
    return_period: [20, 60],
    return_threshold: [10, 20],
    sma_period: [50, 100],
    short_return_period: [5, 10],
    short_return_threshold: [3, 5],
    atr_stop_multiple: [2.0, 3.0],
    hold_days: [60, 120, 250],
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
function buildConfig(
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
      { type: 'rsi_above', period: 14, threshold: 60 },
      { type: 'hold_days', days: params.hold_days },
    ],
    riskRule: { type: 'atr_multiple', atrPeriod: 14, multiple: params.atr_stop_multiple },
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
      { type: 'price_below_sma', period: params.sma_trend_period },
      { type: 'hold_days', days: params.hold_days },
    ],
    riskRule: { type: 'atr_multiple', atrPeriod: 14, multiple: params.atr_stop_multiple },
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
    ],
    riskRule: { type: 'atr_multiple', atrPeriod: 14, multiple: params.atr_stop_multiple },
    indexTicker: 'SPY',
  };
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
