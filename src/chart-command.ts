// ============================================================
// Chart Command — On-demand backtest visualization handler
// ============================================================
// Loads a cached or freshly-tuned profile and generates an
// HTML backtest chart.
// Accepts --ticker (required), --strategy (required),
// --source (optional, default "cache", values: "cache" | "fresh").
// ============================================================

import { successResult, errorResult } from './command-router.js';
import type { CommandHandler } from './command-router.js';
import type { CachingDataProvider } from './caching-data-provider.js';
import type { StrategyRegistry } from './strategy-registry.js';
import { loadStrategyProfile } from './profile-store.js';
import { tuneParams, runBacktest, renderChart } from './pipeline-functions.js';
import type { TuneResult } from './pipeline-functions.js';

// ============================================================
// Dependencies
// ============================================================

export interface ChartCommandDeps {
  cachingProvider: CachingDataProvider;
  registry: StrategyRegistry;
  dataDir: string;
}

// ============================================================
// createChartHandler
// ============================================================

export function createChartHandler(deps: ChartCommandDeps): CommandHandler {
  const { cachingProvider, registry, dataDir } = deps;

  return async (opts: Record<string, string>) => {
    const ticker = opts['ticker'];
    const strategyName = opts['strategy'];
    const source = opts['source'] ?? 'cache';

    // Validate required params
    if (!ticker) {
      return errorResult('chart', 'MISSING_PARAM', 'Missing required parameter: --ticker');
    }

    if (!strategyName) {
      return errorResult('chart', 'MISSING_PARAM', 'Missing required parameter: --strategy');
    }

    // Validate --source value
    if (source !== 'cache' && source !== 'fresh') {
      return errorResult('chart', 'INVALID_PARAM_RANGE',
        `Invalid value for --source: '${source}'. Must be 'cache' or 'fresh'.`);
    }

    // Resolve strategy from registry
    const strategy = registry.resolve(strategyName);
    if (!strategy) {
      return errorResult('chart', 'INVALID_PARAM_RANGE',
        `Unknown strategy '${strategyName}'. Available: ${registry.list().join(', ')}`);
    }

    const upperTicker = ticker.toUpperCase();
    let params: Record<string, number>;
    const warnings: string[] = [];

    // Resolve params based on source mode
    if (source === 'cache') {
      // Load profile from Profile_Store
      const profileResult = loadStrategyProfile(upperTicker, strategyName, {
        allowStale: true,
        baseDir: dataDir,
      });

      if (!profileResult.success) {
        if (profileResult.error.code === 'PROFILE_NOT_FOUND') {
          return errorResult('chart', 'PROFILE_NOT_FOUND',
            `No cached profile for ${upperTicker}/${strategyName}. Run: npm run tune -- --tickers ${upperTicker} --strategy ${strategyName} --save`);
        }

        // PROFILE_CORRUPT
        return errorResult('chart', profileResult.error.code, profileResult.error.message);
      }

      // Warn if expired but proceed
      const now = new Date();
      const validUntil = new Date(profileResult.data.valid_until);
      if (now > validUntil) {
        warnings.push(
          `Profile for ${upperTicker}/${strategyName} expired at ${profileResult.data.valid_until}. Using stale profile for chart generation.`
        );
      }

      params = profileResult.data.params;
    } else {
      // source === 'fresh': run inline tuneParams without saving
      const dataResult = await cachingProvider.getHistoricalData(upperTicker, '5y');
      if (!dataResult.success) {
        return errorResult('chart', 'DATA_PROVIDER_ERROR',
          `Failed to fetch historical data for ${upperTicker}: ${dataResult.error}`);
      }

      const paramSpace = strategy.paramSpace();
      const tuneResult = tuneParams(dataResult.data.dataPoints, strategyName, paramSpace);

      if ('error' in tuneResult) {
        return errorResult('chart', 'TUNE_FAILED',
          `Fresh tune failed for ${upperTicker}: ${tuneResult.error}`);
      }

      params = (tuneResult as TuneResult).bestParams;
    }

    // Fetch historical data for backtest
    try {
      const dataResult = await cachingProvider.getHistoricalData(upperTicker, '5y');
      if (!dataResult.success) {
        return errorResult('chart', 'DATA_PROVIDER_ERROR',
          `Failed to fetch historical data for ${upperTicker}: ${dataResult.error}`);
      }

      const dataPoints = dataResult.data.dataPoints;

      // Run backtest
      const backtestResult = runBacktest(dataPoints, strategyName, params);

      // Render chart
      const chartFilePath = renderChart(backtestResult, dataPoints, dataDir, upperTicker);
      const chartUrl = `file://${chartFilePath}`;

      return successResult('chart', {
        ticker: upperTicker,
        strategy: strategyName,
        source,
        chartFilePath,
        chartUrl,
        warnings,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return errorResult('chart', 'INTERNAL_ERROR',
        `Chart generation failed for ${upperTicker}: ${message}`);
    }
  };
}
