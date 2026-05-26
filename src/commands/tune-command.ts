// ============================================================
// Tune Command — Weekly parameter optimization handler
// ============================================================
// Orchestrates batch tuning with profile persistence.
// Accepts --tickers (required), --strategy (required),
// --save (optional), --no-cache (optional).
// ============================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import type { HistoricalDataCache } from '../data/historical-data-cache.js';
import type { StrategyRegistry } from '../strategies/strategy-registry.js';
import { tuneParams, tuneV3 } from '../pipeline/pipeline-functions.js';
import type { TuneResult, V3TuneResult } from '../pipeline/pipeline-functions.js';
import { saveStrategyProfile, computeExpiry } from '../data/profile-store.js';
import type { StrategyProfile, WalkForwardMetrics } from '../data/profile-store.js';
import type { TuningPerformanceMetrics } from '../pipeline/tuning-engine.js';
import type { CapTier } from '../strategies/parameter-grid.js';
import { resolveUniverse } from '../utils/universe.js';

// ============================================================
// Cap-Tier Validation
// ============================================================

export const VALID_CAP_TIERS: CapTier[] = ['large_cap', 'mid_cap', 'small_cap'];

export function parseCapTier(value: string | undefined): CapTier | { error: string } {
  if (value === undefined || value === '') {
    return 'large_cap';
  }
  if (VALID_CAP_TIERS.includes(value as CapTier)) {
    return value as CapTier;
  }
  return { error: `Invalid --cap-tier value '${value}'. Valid options: ${VALID_CAP_TIERS.join(', ')}` };
}

// ============================================================
// Dependencies
// ============================================================

export interface TuneCommandDeps {
  cachingProvider: HistoricalDataCache;
  registry: StrategyRegistry;
  dataDir: string;
}

// ============================================================
// Tune Summary Types
// ============================================================

export interface TuneSummary {
  ticker: string;
  strategy: string;
  status: 'success' | 'insufficient_data' | 'no_viable_configs' | 'error';
  in_sample?: TuningPerformanceMetrics;
  out_of_sample?: TuningPerformanceMetrics;
  configurations_evaluated?: number;
  profile_saved: boolean;
  error_message?: string;
  cap_tier?: CapTier;
}

export interface TuneBatchResult {
  summaries: TuneSummary[];
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
}


// ============================================================
// Ticker Resolution — loads from universe-resolved watchlist or explicit list
// ============================================================

function resolveTickerList(
  tickersArg: string | undefined,
  dataDir: string,
  watchlistFile: string = 'watchlist.json',
): string[] | { error: string } {
  // When --tickers is not provided, 'watchlist', or 'top100', load from universe-resolved watchlist
  if (
    tickersArg === undefined ||
    tickersArg === '' ||
    tickersArg.toLowerCase() === 'watchlist' ||
    tickersArg.toLowerCase() === 'top100'
  ) {
    try {
      const watchlistPath = join(dataDir, 'data', watchlistFile);
      const content = readFileSync(watchlistPath, 'utf-8');
      const parsed = JSON.parse(content) as { tickers?: string[] };
      if (!Array.isArray(parsed.tickers) || parsed.tickers.length === 0) {
        return { error: `Watchlist file '${watchlistFile}' at ${watchlistPath} is missing or has empty 'tickers' array` };
      }
      return parsed.tickers.map((t: string) => t.toUpperCase());
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { error: `Failed to load watchlist file '${watchlistFile}': ${message}` };
    }
  }

  // Explicit ticker list provided — use as-is (capTier still inherited from universe)
  return tickersArg.split(',').map(t => t.trim().toUpperCase()).filter(t => t.length > 0);
}

// ============================================================
// Metrics Conversion
// ============================================================

function toWalkForwardMetrics(m: TuningPerformanceMetrics): WalkForwardMetrics {
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
// createTuneHandler
// ============================================================

export function createTuneHandler(deps: TuneCommandDeps): CommandHandler {
  const { cachingProvider, registry, dataDir } = deps;

  return async (opts: Record<string, string>) => {
    const tickersArg = opts['tickers'];
    const strategyName = opts['strategy'];
    const shouldSave = opts['save'] !== undefined;
    const noCache = opts['no-cache'] !== undefined;
    const isV3 = opts['v3'] !== undefined;

    // Resolve universe (replaces --cap-tier)
    const universeResult = resolveUniverse(opts['universe']);
    if ('error' in universeResult) {
      return errorResult('tune', 'INVALID_PARAM_RANGE', universeResult.error);
    }
    const tier: CapTier = universeResult.capTier;

    // V3 path: tune both strategies in parallel
    if (isV3) {
      return handleV3Tune(tickersArg, shouldSave, noCache, cachingProvider, dataDir, tier, universeResult.watchlistFile);
    }

    // Resolve strategy from registry
    const strategy = registry.resolve(strategyName);
    if (!strategy) {
      return errorResult('tune', 'INVALID_PARAM_RANGE',
        `Unknown strategy '${strategyName}'. Available: ${registry.list().join(', ')}`);
    }

    // Resolve ticker list from universe-resolved watchlist
    const tickers = resolveTickerList(tickersArg, dataDir, universeResult.watchlistFile);
    if ('error' in tickers) {
      return errorResult('tune', 'CONFIG_ERROR', tickers.error);
    }

    if (tickers.length === 0) {
      return errorResult('tune', 'MISSING_PARAM', 'No tickers specified');
    }

    // Get parameter space for the strategy
    const paramSpace = strategy.paramSpace();

    const summaries: TuneSummary[] = [];
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    // Process each ticker sequentially
    for (const ticker of tickers) {
      try {
        // Fetch 5y historical data
        let dataResult;
        dataResult = await cachingProvider.getHistoricalData(ticker, '5y');

        if (!dataResult.success) {
          failed++;
          summaries.push({
            ticker,
            strategy: strategyName,
            status: 'error',
            profile_saved: false,
            error_message: dataResult.error,
          });
          continue;
        }

        const dataPoints = dataResult.data.dataPoints;

        // Run tuneParams
        const tuneResult = tuneParams(dataPoints, strategyName, paramSpace, tier);

        if ('error' in tuneResult) {
          // Classify the error
          const errorMsg = tuneResult.error;
          const isInsufficientData = errorMsg.toLowerCase().includes('insufficient data');
          const isNoViable = errorMsg.toLowerCase().includes('no viable');

          if (isInsufficientData) {
            skipped++;
            summaries.push({
              ticker,
              strategy: strategyName,
              status: 'insufficient_data',
              profile_saved: false,
              error_message: errorMsg,
            });
          } else if (isNoViable) {
            skipped++;
            summaries.push({
              ticker,
              strategy: strategyName,
              status: 'no_viable_configs',
              profile_saved: false,
              error_message: errorMsg,
            });
          } else {
            failed++;
            summaries.push({
              ticker,
              strategy: strategyName,
              status: 'error',
              profile_saved: false,
              error_message: errorMsg,
            });
          }
          continue;
        }

        // Successful tune
        const result = tuneResult as TuneResult;
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
            ...(tier !== 'large_cap' ? { cap_tier: tier } : {}),
          };

          const saveResult = saveStrategyProfile(profile, dataDir);
          profileSaved = saveResult.success;
        }

        succeeded++;
        summaries.push({
          ticker,
          strategy: strategyName,
          status: 'success',
          in_sample: result.isMetrics,
          out_of_sample: result.oosMetrics,
          configurations_evaluated: result.configurationsEvaluated,
          profile_saved: profileSaved,
          cap_tier: tier,
        });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        failed++;
        summaries.push({
          ticker,
          strategy: strategyName,
          status: 'error',
          profile_saved: false,
          error_message: message,
        });
      }
    }

    const batchResult: TuneBatchResult = {
      summaries,
      total: tickers.length,
      succeeded,
      failed,
      skipped,
    };

    return successResult('tune', batchResult);
  };
}

// ============================================================
// V3 Tune Handler — Tunes both strategies in parallel
// ============================================================

async function handleV3Tune(
  tickersArg: string | undefined,
  shouldSave: boolean,
  noCache: boolean,
  cachingProvider: HistoricalDataCache,
  dataDir: string,
  tier: CapTier = 'large_cap',
  watchlistFile: string = 'watchlist.json',
) {
  // Resolve ticker list from universe-resolved watchlist
  const tickers = resolveTickerList(tickersArg, dataDir, watchlistFile);
  if ('error' in tickers) {
    return errorResult('tune', 'CONFIG_ERROR', tickers.error);
  }

  if (tickers.length === 0) {
    return errorResult('tune', 'MISSING_PARAM', 'No tickers specified');
  }

  const summaries: TuneSummary[] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const ticker of tickers) {
    try {
      // Fetch 5y historical data
      let dataResult;
      dataResult = await cachingProvider.getHistoricalData(ticker, '5y');

      if (!dataResult.success) {
        failed += 4;
        summaries.push({
          ticker,
          strategy: 'consolidation_breakout',
          status: 'error',
          profile_saved: false,
          error_message: dataResult.error,
        });
        summaries.push({
          ticker,
          strategy: 'trend_pullback',
          status: 'error',
          profile_saved: false,
          error_message: dataResult.error,
        });
        summaries.push({
          ticker,
          strategy: 'bear_breakdown',
          status: 'error',
          profile_saved: false,
          error_message: dataResult.error,
        });
        summaries.push({
          ticker,
          strategy: 'keltner_mean_reversion',
          status: 'error',
          profile_saved: false,
          error_message: dataResult.error,
        });
        continue;
      }

      const dataPoints = dataResult.data.dataPoints;

      // Run tuneV3 — tunes all strategies on the same data
      const v3Result: V3TuneResult = tuneV3(dataPoints, tier);

      // Process consolidation_breakout result
      const cbSummary = buildV3StrategySummary(
        ticker, 'consolidation_breakout', v3Result.consolidation_breakout, shouldSave, dataDir, tier
      );
      summaries.push(cbSummary);

      // Process trend_pullback result
      const tpSummary = buildV3StrategySummary(
        ticker, 'trend_pullback', v3Result.trend_pullback, shouldSave, dataDir, tier
      );
      summaries.push(tpSummary);

      // Process bear_breakdown result
      const bbSummary = buildV3StrategySummary(
        ticker, 'bear_breakdown', v3Result.bear_breakdown, shouldSave, dataDir, tier
      );
      summaries.push(bbSummary);

      // Process keltner_mean_reversion result
      const kmrSummary = buildV3StrategySummary(
        ticker, 'keltner_mean_reversion', v3Result.keltner_mean_reversion, shouldSave, dataDir, tier
      );
      summaries.push(kmrSummary);

      // Update counters based on individual strategy results
      if (cbSummary.status === 'success') succeeded++;
      else if (cbSummary.status === 'error') failed++;
      else skipped++;

      if (tpSummary.status === 'success') succeeded++;
      else if (tpSummary.status === 'error') failed++;
      else skipped++;

      if (bbSummary.status === 'success') succeeded++;
      else if (bbSummary.status === 'error') failed++;
      else skipped++;

      if (kmrSummary.status === 'success') succeeded++;
      else if (kmrSummary.status === 'error') failed++;
      else skipped++;

    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      failed += 4;
      summaries.push({
        ticker,
        strategy: 'consolidation_breakout',
        status: 'error',
        profile_saved: false,
        error_message: message,
      });
      summaries.push({
        ticker,
        strategy: 'trend_pullback',
        status: 'error',
        profile_saved: false,
        error_message: message,
      });
      summaries.push({
        ticker,
        strategy: 'bear_breakdown',
        status: 'error',
        profile_saved: false,
        error_message: message,
      });
      summaries.push({
        ticker,
        strategy: 'keltner_mean_reversion',
        status: 'error',
        profile_saved: false,
        error_message: message,
      });
    }
  }

  const batchResult: TuneBatchResult = {
    summaries,
    total: tickers.length * 4,
    succeeded,
    failed,
    skipped,
  };

  return successResult('tune', batchResult);
}

// ============================================================
// buildV3StrategySummary — Build a TuneSummary from a single strategy's TuneResult
// ============================================================

function buildV3StrategySummary(
  ticker: string,
  strategyName: string,
  result: TuneResult | { error: string },
  shouldSave: boolean,
  dataDir: string,
  tier: CapTier = 'large_cap',
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

  // Successful tune
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
      ...(tier !== 'large_cap' ? { cap_tier: tier } : {}),
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
    cap_tier: tier,
  };
}
