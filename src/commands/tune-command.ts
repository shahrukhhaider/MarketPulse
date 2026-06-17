// ============================================================
// Tune Command — Weekly parameter optimization handler
// ============================================================
// Orchestrates batch tuning with profile persistence.
// Accepts --tickers (required), --strategy (required),
// --save (optional), --no-cache (optional).
// ============================================================

import { successResult, errorResult } from '../command-router.js';
import { resolveTickerList } from '../utils/ticker-resolver.js';
import type { CommandHandler } from '../command-router.js';
import type { HistoricalDataCache } from '../data/historical-data-cache.js';
import type { StrategyRegistry } from '../strategies/strategy-registry.js';
import { tuneParams, tuneV3 } from '../pipeline/pipeline-functions.js';
import type { TuneResult, V3TuneResult } from '../pipeline/pipeline-functions.js';
import { saveStrategyProfile, computeExpiry } from '../data/profile-store.js';
import type { StrategyProfile, WalkForwardMetrics } from '../data/profile-store.js';
import type { TuningPerformanceMetrics } from '../pipeline/tuning-engine.js';
import { resolveUniverse } from '../utils/universe.js';
import { buildStrategySummary, toWalkForwardMetrics } from '../pipeline/strategy-summary.js';

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
}

export interface TuneBatchResult {
  summaries: TuneSummary[];
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
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

    // Resolve universe (for watchlist file resolution)
    const universeResult = resolveUniverse(opts['universe']);
    if ('error' in universeResult) {
      return errorResult('tune', 'INVALID_PARAM_RANGE', universeResult.error);
    }

    // V3 path: tune both strategies in parallel
    if (isV3) {
      return handleV3Tune(tickersArg, shouldSave, noCache, cachingProvider, dataDir, universeResult.watchlistFile);
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
        const tuneResult = tuneParams(dataPoints, strategyName, paramSpace);

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
            oos_trades: result.oosMetrics.trades?.map((t) => ({
              entry_date: t.entryDate,
              exit_date: t.exitDate,
              entry_price: t.entryPrice,
              exit_price: t.exitPrice,
              won: t.pnlPct > 0,
            })),
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
      const v3Result: V3TuneResult = tuneV3(dataPoints);

      // Process consolidation_breakout result
      const cbSummary = buildStrategySummary(
        ticker, 'consolidation_breakout', v3Result.consolidation_breakout, shouldSave, dataDir
      );
      summaries.push(cbSummary);

      // Process trend_pullback result
      const tpSummary = buildStrategySummary(
        ticker, 'trend_pullback', v3Result.trend_pullback, shouldSave, dataDir
      );
      summaries.push(tpSummary);

      // Process bear_breakdown result
      const bbSummary = buildStrategySummary(
        ticker, 'bear_breakdown', v3Result.bear_breakdown, shouldSave, dataDir
      );
      summaries.push(bbSummary);

      // Process keltner_mean_reversion result
      const kmrSummary = buildStrategySummary(
        ticker, 'keltner_mean_reversion', v3Result.keltner_mean_reversion, shouldSave, dataDir
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
