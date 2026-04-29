// ============================================================
// Tune Command — Weekly parameter optimization handler
// ============================================================
// Orchestrates batch tuning with profile persistence.
// Accepts --tickers (required), --strategy (required),
// --save (optional), --no-cache (optional).
// ============================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { successResult, errorResult } from './command-router.js';
import type { CommandHandler } from './command-router.js';
import type { CachingDataProvider } from './caching-data-provider.js';
import type { StrategyRegistry } from './strategy-registry.js';
import { tuneParams } from './pipeline-functions.js';
import type { TuneResult } from './pipeline-functions.js';
import { saveStrategyProfile, computeExpiry } from './profile-store.js';
import type { StrategyProfile, WalkForwardMetrics } from './profile-store.js';
import type { TuningPerformanceMetrics } from './tuning-engine.js';

// ============================================================
// Dependencies
// ============================================================

export interface TuneCommandDeps {
  cachingProvider: CachingDataProvider;
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
// Top-100 Ticker Resolution
// ============================================================

function resolveTickerList(tickersArg: string, dataDir: string): string[] | { error: string } {
  if (tickersArg.toLowerCase() === 'top100') {
    try {
      const top100Path = join(dataDir, 'data', 'top100.json');
      const content = readFileSync(top100Path, 'utf-8');
      const parsed = JSON.parse(content) as { tickers?: string[] };
      if (!Array.isArray(parsed.tickers) || parsed.tickers.length === 0) {
        return { error: `top100.json at ${top100Path} is missing or has empty 'tickers' array` };
      }
      return parsed.tickers.map((t: string) => t.toUpperCase());
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { error: `Failed to load top100.json: ${message}` };
    }
  }

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

    // Resolve strategy from registry
    const strategy = registry.resolve(strategyName);
    if (!strategy) {
      return errorResult('tune', 'INVALID_PARAM_RANGE',
        `Unknown strategy '${strategyName}'. Available: ${registry.list().join(', ')}`);
    }

    // Resolve ticker list
    const tickers = resolveTickerList(tickersArg, dataDir);
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
        if (noCache) {
          dataResult = await cachingProvider.innerProvider.getHistoricalData(ticker, '5y');
        } else {
          dataResult = await cachingProvider.getHistoricalData(ticker, '5y');
        }

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
