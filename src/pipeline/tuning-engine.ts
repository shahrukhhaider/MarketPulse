import type { HistoricalDataCache } from '../data/historical-data-cache.js';
import { generateGrid } from '../strategies/parameter-grid.js';
import { walkForwardValidate } from './walk-forward-validator.js';
import type { WalkForwardResult } from './walk-forward-validator.js';
import { TuningResultCache } from './tuning-cache.js';

// ============================================================
// Type Aliases
// ============================================================

export type TimeHorizon = 'short_term' | 'long_term';
export type RiskProfile = 'low' | 'medium' | 'high';
export type TunableStrategy = 'trend_pullback' | 'breakout_volume' | 'momentum_continuation';

// ============================================================
// Input Interfaces
// ============================================================

export interface TuningInput {
  ticker: string;
  strategy: TunableStrategy;
  time_horizon?: TimeHorizon;
  risk_profile?: RiskProfile;
  noCache?: boolean;
}

export interface ValidatedTuningInput {
  ticker: string;
  strategy: TunableStrategy;
  time_horizon: TimeHorizon;
  risk_profile: RiskProfile;
  profile: string;
  noCache: boolean;
}

// ============================================================
// Performance Metrics
// ============================================================

export interface TuningPerformanceMetrics {
  totalReturnPercent: number;
  sharpeRatio: number;
  maxDrawdownPercent: number;
  winRate: number;
  tradeCount: number;
  profitFactor: number;
  /** Raw trades from the backtest. Populated for OOS evaluations to persist in profile. */
  trades?: Array<{ entryDate: string; exitDate: string; entryPrice: number; exitPrice: number; pnlPct: number }>;
}

// ============================================================
// Tuning Result
// ============================================================

export interface ParameterRange {
  min: number;
  max: number;
}

export interface BestRegion {
  [paramName: string]: ParameterRange;
}

export interface TuningResult {
  ticker: string;
  strategy: TunableStrategy;
  profile: string;
  best_region: BestRegion;
  summary_metrics: TuningPerformanceMetrics;
  configurations_evaluated: number;
  configurations_passed_filter: number;
  computed_at: string;
}

// ============================================================
// Error and Outcome
// ============================================================

export interface TuningError {
  code: string;
  message: string;
}

export type TuningOutcome =
  | { success: true; data: TuningResult }
  | { success: false; error: TuningError };

// ============================================================
// TuningEngine (stub — see tasks 5.2 and 5.3)
// ============================================================

export class TuningEngine {
  constructor(
    private readonly dataProvider: HistoricalDataCache,
    private readonly cacheDir: string
  ) {}

  validateInput(input: TuningInput): ValidatedTuningInput | TuningError {
    // 1. Validate ticker: non-empty uppercase string
    if (!input.ticker || !/^[A-Z]+$/.test(input.ticker)) {
      return {
        code: 'INVALID_PARAM_RANGE',
        message: 'Invalid ticker: must be a non-empty uppercase string',
      };
    }

    // 2. Apply defaults
    const time_horizon: TimeHorizon = input.time_horizon ?? 'long_term';
    const risk_profile: RiskProfile = input.risk_profile ?? 'low';

    // 3. Validate time_horizon (if provided but invalid)
    const validHorizons: TimeHorizon[] = ['short_term', 'long_term'];
    if (!validHorizons.includes(time_horizon as TimeHorizon)) {
      return {
        code: 'INVALID_PARAM_RANGE',
        message: "Invalid time_horizon: must be 'short_term' or 'long_term'",
      };
    }

    // 4. Validate risk_profile (if provided but invalid)
    const validProfiles: RiskProfile[] = ['low', 'medium', 'high'];
    if (!validProfiles.includes(risk_profile as RiskProfile)) {
      return {
        code: 'INVALID_PARAM_RANGE',
        message: "Invalid risk_profile: must be 'low', 'medium', or 'high'",
      };
    }

    // 5. Validate strategy
    const validStrategies: string[] = ['trend_pullback', 'breakout_volume', 'momentum_continuation', 'mean_reversion'];
    if (!validStrategies.includes(input.strategy)) {
      return {
        code: 'INVALID_PARAM_RANGE',
        message: "Invalid strategy: must be 'trend_pullback', 'breakout_volume', 'momentum_continuation', or 'mean_reversion'",
      };
    }

    // 6. Compute profile
    const profile = `${time_horizon}_${risk_profile}`;

    return {
      ticker: input.ticker,
      strategy: input.strategy,
      time_horizon,
      risk_profile,
      profile,
      noCache: input.noCache ?? false,
    };
  }

  async run(input: TuningInput): Promise<TuningOutcome> {
    // Step 1: Validate input
    const validated = this.validateInput(input);
    if ('code' in validated) {
      return { success: false, error: validated };
    }

    // Step 2: Check cache (unless noCache)
    const cache = new TuningResultCache(this.cacheDir);
    if (!validated.noCache) {
      const cached = cache.read(validated.ticker, validated.strategy, validated.profile);
      if (cached) {
        return { success: true, data: cached };
      }
    }

    // Step 3: Fetch historical data
    const period = validated.time_horizon === 'short_term' ? '2y' : '5y';
    const dataResult = await this.dataProvider.getHistoricalData(validated.ticker, period);
    if (!dataResult.success) {
      return { success: false, error: { code: 'DATA_PROVIDER_ERROR', message: dataResult.error } };
    }

    // Step 4: Generate grid
    const grid = generateGrid(validated.strategy, validated.time_horizon);

    // Step 5: Walk-forward validate
    const wfResults = walkForwardValidate(grid, dataResult.data.dataPoints, validated.strategy);
    if ('error' in wfResults) {
      return { success: false, error: { code: 'INSUFFICIENT_DATA', message: wfResults.error } };
    }

    // Step 6: Filter
    const filtered = wfResults.filter(r =>
      r.outOfSample.maxDrawdownPercent <= 25 &&
      r.outOfSample.profitFactor >= 1.2 &&
      r.outOfSample.totalReturnPercent > 0
    );

    if (filtered.length === 0) {
      return {
        success: false,
        error: {
          code: 'NO_VIABLE_CONFIGS',
          message: `No viable configurations found for ${validated.ticker} / ${validated.strategy} / ${validated.profile}`,
        },
      };
    }

    // Step 7: Rank by OOS Sharpe ratio descending
    filtered.sort((a, b) => b.outOfSample.sharpeRatio - a.outOfSample.sharpeRatio);
    const topCount = Math.max(1, Math.ceil(filtered.length * 0.2));
    const topConfigs = filtered.slice(0, topCount);

    // Step 8: Compute best region (min/max of each param across top configs)
    const bestRegion: BestRegion = {};
    const paramNames = Object.keys(topConfigs[0].params);
    for (const name of paramNames) {
      const values = topConfigs.map(c => c.params[name]);
      bestRegion[name] = { min: Math.min(...values), max: Math.max(...values) };
    }

    // Step 9: Compute summary metrics (arithmetic mean)
    const summaryMetrics = computeSummaryMetrics(topConfigs);

    // Step 10: Build result
    const result: TuningResult = {
      ticker: validated.ticker,
      strategy: validated.strategy,
      profile: validated.profile,
      best_region: bestRegion,
      summary_metrics: summaryMetrics,
      configurations_evaluated: grid.length,
      configurations_passed_filter: filtered.length,
      computed_at: new Date().toISOString(),
    };

    // Step 11: Cache result (non-fatal on failure)
    cache.write(result);

    return { success: true, data: result };
  }
}

/**
 * Compute summary metrics as the arithmetic mean of each metric field
 * across the given configurations.
 */
function computeSummaryMetrics(configs: WalkForwardResult[]): TuningPerformanceMetrics {
  const n = configs.length;
  const sum = (fn: (c: WalkForwardResult) => number) =>
    configs.reduce((acc, c) => acc + fn(c), 0) / n;

  return {
    totalReturnPercent: sum(c => c.outOfSample.totalReturnPercent),
    sharpeRatio: sum(c => c.outOfSample.sharpeRatio),
    maxDrawdownPercent: sum(c => c.outOfSample.maxDrawdownPercent),
    winRate: sum(c => c.outOfSample.winRate),
    tradeCount: sum(c => c.outOfSample.tradeCount),
    profitFactor: sum(c => c.outOfSample.profitFactor),
  };
}
