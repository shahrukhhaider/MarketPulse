import type { StrategyConfiguration, PhasedStrategyConfiguration, ConsolidationBreakoutConfiguration, TrendPullbackConfiguration, BearBreakdownConfiguration, PostEarningsDriftConfiguration, KeltnerMeanReversionConfiguration } from './strategy-configs.js';
import { mergePeadConfig, validatePeadConfig } from './strategy-configs.js';
import type { TimeHorizon, TunableStrategy } from '../pipeline/tuning-engine.js';
import { resolveWeightPreset } from '../indicators/confidence-score.js';

export type { TimeHorizon, TunableStrategy } from '../pipeline/tuning-engine.js';

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

export interface TrendPullbackGridEntry {
  params: Record<string, number>;
  config: TrendPullbackConfiguration;
}

export interface BearBreakdownGridEntry {
  params: Record<string, number>;
  config: BearBreakdownConfiguration;
}

export interface PostEarningsDriftGridEntry {
  params: Record<string, number>;
  config: PostEarningsDriftConfiguration;
}

export interface KeltnerMeanReversionGridEntry {
  params: Record<string, number>;
  config: KeltnerMeanReversionConfiguration;
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
 * Uses a generator to avoid materializing all combinations in memory at once.
 */
function* cartesianProductGen(arrays: number[][]): Generator<number[]> {
  if (arrays.length === 0) {
    yield [];
    return;
  }

  const lengths = arrays.map(a => a.length);
  const totalCombinations = lengths.reduce((acc, len) => acc * len, 1);
  const indices = new Array(arrays.length).fill(0);

  for (let i = 0; i < totalCombinations; i++) {
    // Build current combination from indices
    const combination = indices.map((idx, dim) => arrays[dim][idx]);
    yield combination;

    // Increment indices (odometer-style)
    for (let dim = arrays.length - 1; dim >= 0; dim--) {
      indices[dim]++;
      if (indices[dim] < lengths[dim]) break;
      indices[dim] = 0;
    }
  }
}

/**
 * Materialize the Cartesian product into an array.
 * Use only for small grids (V1/V2) where the full array fits in memory.
 */
function cartesianProduct(arrays: number[][]): number[][] {
  return [...cartesianProductGen(arrays)];
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
 * Return the consolidation-breakout parameter space with 17 tunable parameters.
 * Original 9 + 8 trailing exit parameters.
 */
/**
 * Resolve an exit preset index to a full trailing exit configuration.
 * Collapses 8 trailing params (864 combos) into 8 curated presets.
 *
 * Active presets (included in grid):
 *   0 — fixed: no trailing, baseline behavior
 *   5 — trailing ATR×2.5 off highest_close, breakeven@0.75R, trail@1.5R, no profit cap
 *
 * Available for future expansion (add index to exit_preset array in getConsolidationBreakoutParameterSpace):
 *   1 — trailing SMA20 (buffer 0.3), breakeven@1.0R, trail@2.0R, keeps profit target
 *   2 — trailing SMA20 (buffer 0.3), breakeven@1.0R, trail@2.0R, removes profit target
 *   3 — trailing ATR×2.5 off close, breakeven@1.0R, trail@2.0R, keeps profit target
 *   4 — trailing ATR×2.5 off close, breakeven@1.0R, trail@2.0R, removes profit target
 *   6 — trailing ATR×3.0 off highest_close, breakeven@1.5R, trail@2.5R, removes profit target (conservative)
 *   7 — trailing SMA20 (buffer 0.5), breakeven@0.75R, trail@1.5R, removes profit target (aggressive)
 */
export function resolveExitPreset(preset: number): {
  exitMode: 'fixed' | 'trailing';
  trailingStop?: ConsolidationBreakoutConfiguration['trailingStop'];
} {
  switch (preset) {
    case 0:
      return { exitMode: 'fixed' };
    case 1:
      return { exitMode: 'trailing', trailingStop: { trailingMethod: 'sma20', smaTrailBuffer: 0.3, breakevenThreshold: 1.0, trailActivationThreshold: 2.0, removeProfitTarget: false } };
    case 2:
      return { exitMode: 'trailing', trailingStop: { trailingMethod: 'sma20', smaTrailBuffer: 0.3, breakevenThreshold: 1.0, trailActivationThreshold: 2.0, removeProfitTarget: true } };
    case 3:
      return { exitMode: 'trailing', trailingStop: { trailingMethod: 'atr', atrTrailMultiple: 2.5, atrTrailReference: 'close', breakevenThreshold: 1.0, trailActivationThreshold: 2.0, removeProfitTarget: false } };
    case 4:
      return { exitMode: 'trailing', trailingStop: { trailingMethod: 'atr', atrTrailMultiple: 2.5, atrTrailReference: 'close', breakevenThreshold: 1.0, trailActivationThreshold: 2.0, removeProfitTarget: true } };
    case 5:
      return { exitMode: 'trailing', trailingStop: { trailingMethod: 'atr', atrTrailMultiple: 2.5, atrTrailReference: 'highest_close', breakevenThreshold: 0.75, trailActivationThreshold: 1.5, removeProfitTarget: true } };
    case 6:
      return { exitMode: 'trailing', trailingStop: { trailingMethod: 'atr', atrTrailMultiple: 3.0, atrTrailReference: 'highest_close', breakevenThreshold: 1.5, trailActivationThreshold: 2.5, removeProfitTarget: true } };
    case 7:
      return { exitMode: 'trailing', trailingStop: { trailingMethod: 'sma20', smaTrailBuffer: 0.5, breakevenThreshold: 0.75, trailActivationThreshold: 1.5, removeProfitTarget: true } };
    default:
      return { exitMode: 'fixed' };
  }
}

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
    // Active presets: 0=fixed baseline, 5=trailing ATR highest_close aggressive
    exit_preset: [0, 5],
    // Weight preset for confidence score (0=equal, 1=rsi_heavy, 2=trend_heavy, 3=momentum_heavy)
    weight_preset: [0, 1, 2, 3],
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
  const preset = resolveExitPreset(params.exit_preset ?? 0);

  return {
    name: `cb_w${params.consolidation_window}_r${params.max_range_pct}_atr${params.atr_ratio_threshold}_vol${params.volume_multiplier}_oe${params.overextension_pct}_am${params.atr_multiple}_sl${params.swing_lookback}_mr${params.max_risk_pct}_rm${params.r_multiple}_ep${params.exit_preset ?? 0}`,
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
    exitMode: preset.exitMode,
    trailingStop: preset.trailingStop,
    confidenceWeights: resolveWeightPreset(params.weight_preset ?? 0),
  };
}

/**
 * Generate the full consolidation-breakout parameter grid using Cartesian product.
 * Uses exit presets and weight presets to keep the grid manageable.
 *
 * Returns a generator to avoid materializing all entries in memory at once.
 * Consumers iterate with for...of and only keep what they need.
 */
export function* generateConsolidationBreakoutGrid(): Generator<ConsolidationBreakoutGridEntry> {
  const space = getConsolidationBreakoutParameterSpace();
  const paramNames = Object.keys(space);
  const paramArrays = paramNames.map(name => space[name]);

  for (const values of cartesianProductGen(paramArrays)) {
    const params: Record<string, number> = {};
    paramNames.forEach((name, i) => {
      params[name] = values[i];
    });

    const config = buildConsolidationBreakoutConfig(params);
    yield { params, config };
  }
}

/**
 * Return the trend-pullback parameter space with 10 tunable parameters.
 */
export function getTrendPullbackParameterSpace(): ParameterSpace {
  return {
    pullback_proximity_pct: [2, 3, 5],
    atr_contraction_threshold: [0.7, 0.8, 1.0],
    volume_below_avg_multiplier: [0.8, 1.0],
    trigger_volume_multiplier: [1.0, 1.2, 1.5],
    overextension_pct: [5, 8, 12],
    stop_atr_multiple: [1.5, 2.0, 2.5],
    r_multiple: [2, 2.5, 3],
    swing_lookback: [5, 10, 15],
    // Active presets: 0=fixed baseline, 5=trailing ATR highest_close aggressive
    exit_preset: [0, 5],
    // Weight preset for confidence score (0=equal, 1=rsi_heavy, 2=trend_heavy, 3=momentum_heavy)
    weight_preset: [0, 1, 2, 3],
  };
}

/**
 * Resolve a trend-pullback exit preset index to a full trailing exit configuration.
 *
 * Active presets (included in grid):
 *   0 — fixed: no trailing, baseline stop/target/trend failsafe
 *   5 — trailing ATR×2.5 off highest_close, breakeven@0.75R, trail@1.5R, no profit cap
 */
export function resolveTrendPullbackExitPreset(preset: number): {
  exitMode: 'fixed' | 'trailing';
  trailingStop?: TrendPullbackConfiguration['trailingStop'];
} {
  switch (preset) {
    case 0:
      return { exitMode: 'fixed' };
    case 5:
      return {
        exitMode: 'trailing',
        trailingStop: {
          trailingMethod: 'atr',
          atrTrailMultiple: 2.5,
          atrTrailReference: 'highest_close',
          breakeven_threshold: 0.75,
          trail_activation_threshold: 1.5,
          remove_profit_target: true,
        },
      };
    default:
      return { exitMode: 'fixed' };
  }
}

/**
 * Map a flat parameter combination to a TrendPullbackConfiguration.
 * Fixed values: require_sma20_above_sma50=false, require_sma50_slope_positive=false,
 * max_pullback_staleness=10, stop_buffer_atr=0.3, trend_exit_sma_period=50.
 */
export function buildTrendPullbackGridConfig(
  params: Record<string, number>
): TrendPullbackConfiguration {
  const preset = resolveTrendPullbackExitPreset(params.exit_preset ?? 0);

  return {
    name: `tp_pp${params.pullback_proximity_pct}_ac${params.atr_contraction_threshold}_vb${params.volume_below_avg_multiplier}_tv${params.trigger_volume_multiplier}_oe${params.overextension_pct}_sa${params.stop_atr_multiple}_rm${params.r_multiple}_sl${params.swing_lookback}_ep${params.exit_preset ?? 0}`,
    direction: {
      require_sma20_above_sma50: false,
      require_sma50_slope_positive: false,
    },
    pullback: {
      pullback_proximity_pct: params.pullback_proximity_pct,
      atr_contraction_threshold: params.atr_contraction_threshold,
      volume_below_avg_multiplier: params.volume_below_avg_multiplier,
      swing_lookback: params.swing_lookback,
      max_pullback_staleness: 10,
    },
    trigger: {
      trigger_volume_multiplier: params.trigger_volume_multiplier,
    },
    overextension: {
      overextension_pct: params.overextension_pct,
    },
    stopLoss: {
      stop_atr_multiple: params.stop_atr_multiple,
      stop_buffer_atr: 0.3,
    },
    profitTarget: {
      r_multiple: params.r_multiple,
    },
    trendExit: {
      trend_exit_sma_period: 50,
    },
    exitMode: preset.exitMode,
    trailingStop: preset.trailingStop,
    confidenceWeights: resolveWeightPreset(params.weight_preset ?? 0),
  };
}

/**
 * Generate the full trend-pullback parameter grid using Cartesian product.
 *
 * Returns a generator to avoid materializing all entries in memory at once.
 */
export function* generateTrendPullbackGrid(): Generator<TrendPullbackGridEntry> {
  const space = getTrendPullbackParameterSpace();
  const paramNames = Object.keys(space);
  const paramArrays = paramNames.map(name => space[name]);

  for (const values of cartesianProductGen(paramArrays)) {
    const params: Record<string, number> = {};
    paramNames.forEach((name, i) => {
      params[name] = values[i];
    });

    const config = buildTrendPullbackGridConfig(params);
    yield { params, config };
  }
}


/**
 * Return the bear-breakdown parameter space with 8 tunable parameters.
 * Total combinations: 3 × 3 × 2 × 2 × 3 × 3 × 3 × 3 = 2916
 */
export function getBearBreakdownParameterSpace(): ParameterSpace {
  return {
    consolidation_window: [5, 10, 15],
    max_range_pct: [4, 6, 8],
    atr_ratio_threshold: [0.8, 1.0],
    volume_multiplier: [1.2, 1.5],
    atr_multiple: [1.2, 1.6, 2.0],
    swing_lookback: [10, 15, 20],
    max_risk_pct: [3, 5, 8],
    r_multiple: [2, 2.5, 3],
  };
}

/**
 * Map a flat parameter combination to a BearBreakdownConfiguration.
 * Fixed values: max_staleness=20, buffer=0.3, exitMode='fixed'.
 */
export function buildBearBreakdownConfig(
  params: Record<string, number>
): BearBreakdownConfiguration {
  return {
    name: `bb_w${params.consolidation_window}_r${params.max_range_pct}_atr${params.atr_ratio_threshold}_vol${params.volume_multiplier}_am${params.atr_multiple}_sl${params.swing_lookback}_mr${params.max_risk_pct}_rm${params.r_multiple}`,
    consolidation: {
      consolidation_window: params.consolidation_window,
      max_range_pct: params.max_range_pct,
      atr_ratio_threshold: params.atr_ratio_threshold,
      max_staleness: 20,
    },
    breakdown: {
      volume_multiplier: params.volume_multiplier,
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
    exitMode: 'fixed',
  };
}

/**
 * Generate the full bear-breakdown parameter grid using Cartesian product.
 *
 * Returns a generator to avoid materializing all entries in memory at once.
 */
export function* generateBearBreakdownGrid(): Generator<BearBreakdownGridEntry> {
  const space = getBearBreakdownParameterSpace();
  const paramNames = Object.keys(space);
  const paramArrays = paramNames.map(name => space[name]);

  for (const values of cartesianProductGen(paramArrays)) {
    const params: Record<string, number> = {};
    paramNames.forEach((name, i) => {
      params[name] = values[i];
    });

    const config = buildBearBreakdownConfig(params);
    yield { params, config };
  }
}

/**
 * Return the post-earnings-drift parameter space with 11 tunable parameters.
 * Total combinations: 3 × 3 × 3 × 3 × 3 × 3 × 3 × 3 × 3 × 2 × 4 = 78,732
 */
export function getPostEarningsDriftParameterSpace(): ParameterSpace {
  return {
    gap_min_pct: [3, 5, 8],
    gap_volume_multiplier: [1.2, 1.5, 2.0],
    consolidation_min_days: [2, 3, 5],
    consolidation_max_days: [7, 10, 14],
    max_range_pct: [4, 5, 7],
    breakout_volume_multiplier: [1.0, 1.2, 1.5],
    stop_buffer_atr: [0.2, 0.3, 0.5],
    r_multiple: [2.0, 2.5, 3.0],
    max_risk_pct: [5, 8, 12],
    trend_exit_sma_period: [30, 50],
    // Weight preset for confidence score (0=equal, 1=rsi_heavy, 2=trend_heavy, 3=momentum_heavy)
    weight_preset: [0, 1, 2, 3],
  };
}

/**
 * Map a flat parameter combination to a validated PostEarningsDriftConfiguration.
 * Uses mergePeadConfig to construct the config from flat params, then validates.
 * Throws if the resulting configuration is invalid (e.g., consolidation_min_days >= consolidation_max_days).
 */
export function buildPostEarningsDriftConfig(
  params: Record<string, number>
): PostEarningsDriftConfiguration {
  const config = mergePeadConfig({
    gap_min_pct: params.gap_min_pct,
    gap_volume_multiplier: params.gap_volume_multiplier,
    consolidation_min_days: params.consolidation_min_days,
    consolidation_max_days: params.consolidation_max_days,
    max_range_pct: params.max_range_pct,
    breakout_volume_multiplier: params.breakout_volume_multiplier,
    stop_buffer_atr: params.stop_buffer_atr,
    r_multiple: params.r_multiple,
    max_risk_pct: params.max_risk_pct,
    trend_exit_sma_period: params.trend_exit_sma_period,
  });

  const result = validatePeadConfig(config);
  if (!result.success) {
    throw new Error(result.error);
  }

  return result.data;
}

/**
 * Generate the full post-earnings-drift parameter grid using Cartesian product.
 *
 * Returns a generator to avoid materializing all entries in memory at once.
 */
export function* generatePostEarningsDriftGrid(): Generator<PostEarningsDriftGridEntry> {
  const space = getPostEarningsDriftParameterSpace();
  const paramNames = Object.keys(space);
  const paramArrays = paramNames.map(name => space[name]);

  for (const values of cartesianProductGen(paramArrays)) {
    const params: Record<string, number> = {};
    paramNames.forEach((name, i) => {
      params[name] = values[i];
    });

    const config = buildPostEarningsDriftConfig(params);
    yield { params, config };
  }
}

/**
 * Return the keltner-mean-reversion parameter space with 9 tunable parameters.
 * Total combinations: 4 × 4 × 4 × 3 × 3 × 4 × 4 × 3 × 4 = 110,592
 */
export function getKeltnerMeanReversionParameterSpace(): ParameterSpace {
  return {
    ema_period: [10, 20, 30, 50],
    atr_period: [5, 10, 14, 20],
    band_multiplier: [1.5, 2.0, 2.5, 3.0],
    trend_filter_period: [20, 50, 100],
    reclaim_lookback: [2, 5, 10],
    stop_atr_multiple: [1.0, 1.5, 2.0, 3.0],
    r_multiple: [1.5, 2.0, 2.5, 3.0],
    max_risk_pct: [3, 5, 8],
    band_proximity_pct: [2, 3, 5, 8],
  };
}

/**
 * Map a flat parameter combination to a KeltnerMeanReversionConfiguration.
 * All fields map directly from the flat params record (no nesting).
 */
export function buildKeltnerMeanReversionConfig(
  params: Record<string, number>
): KeltnerMeanReversionConfiguration {
  return {
    ema_period: params.ema_period,
    atr_period: params.atr_period,
    band_multiplier: params.band_multiplier,
    trend_filter_period: params.trend_filter_period,
    reclaim_lookback: params.reclaim_lookback,
    stop_atr_multiple: params.stop_atr_multiple,
    r_multiple: params.r_multiple,
    max_risk_pct: params.max_risk_pct,
    band_proximity_pct: params.band_proximity_pct,
  };
}

/**
 * Generate the full keltner-mean-reversion parameter grid using Cartesian product.
 *
 * Returns a generator to avoid materializing all entries in memory at once.
 */
export function* generateKeltnerMeanReversionGrid(): Generator<KeltnerMeanReversionGridEntry> {
  const space = getKeltnerMeanReversionParameterSpace();
  const paramNames = Object.keys(space);
  const paramArrays = paramNames.map(name => space[name]);

  for (const values of cartesianProductGen(paramArrays)) {
    const params: Record<string, number> = {};
    paramNames.forEach((name, i) => {
      params[name] = values[i];
    });

    const config = buildKeltnerMeanReversionConfig(params);
    yield { params, config };
  }
}
