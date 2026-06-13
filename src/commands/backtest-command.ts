// ============================================================
// Backtest Command — Run strategy backtests with multiple engine paths
// ============================================================

import * as path from 'node:path';
import * as nodePath from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import type { AppDependencies } from '../di/container.js';
import { ErrorCodes } from '../types.js';
import type { StrategyType, StrategyParams, HistoricalPeriod } from '../types.js';
import type { CompositeStrategyParams, PhasedStrategyParams, ConsolidationBreakoutParams, TrendPullbackParams } from '../strategies/strategy-configs.js';
import { isV2Config, isConsolidationBreakoutConfig, isTrendPullbackConfig } from '../strategies/strategy-configs.js';
import { getStrategyInstance, getDefaultParams } from '../strategies/strategy-factory.js';
import { executeBacktest } from '../pipeline/backtest-executor.js';
import type { StrategyAdapter } from '../pipeline/backtest-executor.js';
import { BacktestEngine, convertHistoricalData } from '../pipeline/backtest-engine.js';
import { PhasedStrategyEngine } from '../strategies/phased-engine.js';
import { ConsolidationBreakoutEngine } from '../strategies/consolidation-breakout-engine.js';
import { TrendPullbackEngine } from '../strategies/trend-pullback-engine.js';
import { backtestV3 } from '../pipeline/pipeline-functions.js';
import type { V3BacktestResult } from '../pipeline/pipeline-functions.js';
import { loadStrategyProfile } from '../data/profile-store.js';
import { generateChartHtml, generateCombinedChartHtml, getChartFilePath } from '../formatters/chart-generator.js';
import { resolveUniverse, VALID_UNIVERSES } from '../utils/universe.js';

// ============================================================
// Constants
// ============================================================

const VALID_STRATEGY_TYPES: StrategyType[] = [
  'moving_average_crossover',
  'rsi_threshold',
  'price_breakout',
  'momentum_continuation',
  'trend_pullback',
  'breakout_volume',
  'consolidation_breakout',
  'post_earnings_drift',
  'keltner_mean_reversion',
  'volume_dry_up',
];

// ============================================================
// Strategy Adapters
// ============================================================

/**
 * Adapter for V2 phased strategy backtest (momentum_continuation, breakout_volume).
 */
function createV2Adapter(strategyType: StrategyType): StrategyAdapter<PhasedStrategyParams> {
  return {
    validate(params: PhasedStrategyParams): string | undefined {
      const engine = new PhasedStrategyEngine(strategyType);
      const validation = engine.validateParams(params);
      if (!validation.valid) {
        return `${ErrorCodes.INVALID_PARAM_RANGE}: ${validation.error}`;
      }
      return undefined;
    },
    createEngine(params: PhasedStrategyParams, dataPoints) {
      params.primaryDataPoints = dataPoints;
      const engine = new PhasedStrategyEngine(strategyType);
      engine.reset();
      return engine;
    },
  };
}

/**
 * Adapter for consolidation-breakout strategy backtest.
 */
function createConsolidationBreakoutAdapter(): StrategyAdapter<ConsolidationBreakoutParams> {
  return {
    validate(params: ConsolidationBreakoutParams): string | undefined {
      const engine = new ConsolidationBreakoutEngine();
      const validation = engine.validateParams(params);
      if (!validation.valid) {
        return `${ErrorCodes.INVALID_PARAM_RANGE}: ${validation.error}`;
      }
      return undefined;
    },
    createEngine(params: ConsolidationBreakoutParams, dataPoints) {
      params.primaryDataPoints = dataPoints;
      return new ConsolidationBreakoutEngine();
    },
  };
}

/**
 * Adapter for trend-pullback strategy backtest.
 */
function createTrendPullbackAdapter(): StrategyAdapter<TrendPullbackParams> {
  return {
    validate(params: TrendPullbackParams): string | undefined {
      const engine = new TrendPullbackEngine();
      const validation = engine.validateParams(params);
      if (!validation.valid) {
        return `${ErrorCodes.INVALID_PARAM_RANGE}: ${validation.error}`;
      }
      return undefined;
    },
    createEngine(params: TrendPullbackParams, dataPoints) {
      params.primaryDataPoints = dataPoints;
      const engine = new TrendPullbackEngine();
      engine.reset();
      return engine;
    },
  };
}

// ============================================================
// V3 Combined Backtest Helper
// ============================================================

/**
 * Run v3 combined multi-strategy backtest for a single ticker.
 * Returns the V3BacktestResult with ticker annotations.
 */
function runV3ForTicker(
  ticker: string,
  dataPoints: import('../types.js').HistoricalDataPoint[],
  dataDir: string,
): V3BacktestResult {
  const cbProfile = loadStrategyProfile(ticker, 'consolidation_breakout', { allowStale: true, baseDir: dataDir });
  const tpProfile = loadStrategyProfile(ticker, 'trend_pullback', { allowStale: true, baseDir: dataDir });
  const kmrProfile = loadStrategyProfile(ticker, 'keltner_mean_reversion', { allowStale: true, baseDir: dataDir });
  const bbProfile = loadStrategyProfile(ticker, 'bear_breakdown', { allowStale: true, baseDir: dataDir });
  const vduProfile = loadStrategyProfile(ticker, 'volume_dry_up', { allowStale: true, baseDir: dataDir });

  const cbParams: Record<string, number> = cbProfile.success ? cbProfile.data.params : {};
  const tpParams: Record<string, number> = tpProfile.success ? tpProfile.data.params : {};
  const kmrParams: Record<string, number> = kmrProfile.success ? kmrProfile.data.params : {};
  const bbParams: Record<string, number> = bbProfile.success ? bbProfile.data.params : {};
  const vduParams: Record<string, number> = vduProfile.success ? vduProfile.data.params : {};

  const v3Result: V3BacktestResult = backtestV3(dataPoints, cbParams, tpParams, kmrParams, bbParams, vduParams);
  v3Result.consolidation_breakout.ticker = ticker;
  v3Result.trend_pullback.ticker = ticker;
  if (v3Result.keltner_mean_reversion) v3Result.keltner_mean_reversion.ticker = ticker;
  if (v3Result.bear_breakdown) v3Result.bear_breakdown.ticker = ticker;
  if (v3Result.volume_dry_up) v3Result.volume_dry_up.ticker = ticker;

  return v3Result;
}

// ============================================================
// Universe Backtest Helpers
// ============================================================

/**
 * Run v3 backtest for all tickers in a universe.
 */
async function backtestUniverse(
  tier: string,
  tickers: string[],
  period: HistoricalPeriod,
  dataDir: string,
  cachingProvider: AppDependencies['cachingProvider'],
): Promise<{ results: Record<string, unknown>[]; warnings: string[] }> {
  const results: Record<string, unknown>[] = [];
  const warnings: string[] = [];

  for (const t of tickers) {
    try {
      const dataResult = await cachingProvider.getHistoricalData(t, period);
      if (!dataResult.success) {
        warnings.push(`[${tier}] ${t}: ${dataResult.error}`);
        continue;
      }
      const dataPoints = dataResult.data.dataPoints;
      const v3Result = runV3ForTicker(t, dataPoints, dataDir);

      results.push({
        universe: tier,
        label: `[${tier}] ${t}`,
        ticker: t,
        ...v3Result,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`[${tier}] ${t}: ${message}`);
    }
  }

  return { results, warnings };
}

/**
 * Run v3 backtest for tickers in a single universe (no "all" prefix in warnings).
 */
async function backtestSingleUniverse(
  tickers: string[],
  period: HistoricalPeriod,
  dataDir: string,
  cachingProvider: AppDependencies['cachingProvider'],
): Promise<{ results: Record<string, unknown>[]; warnings: string[] }> {
  const results: Record<string, unknown>[] = [];
  const warnings: string[] = [];

  for (const t of tickers) {
    try {
      const dataResult = await cachingProvider.getHistoricalData(t, period);
      if (!dataResult.success) {
        warnings.push(`${t}: ${dataResult.error}`);
        continue;
      }
      const dataPoints = dataResult.data.dataPoints;
      const v3Result = runV3ForTicker(t, dataPoints, dataDir);
      results.push({ ticker: t, ...v3Result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`${t}: ${message}`);
    }
  }

  return { results, warnings };
}

// ============================================================
// createBacktestHandler
// ============================================================

export function createBacktestHandler(deps: AppDependencies): CommandHandler {
  const { cachingProvider, priceFeedClient, dataDir } = deps;

  return async (opts: Record<string, string>) => {
    const strategyType = opts['strategy'] as StrategyType;

    // Validate strategy type
    if (!VALID_STRATEGY_TYPES.includes(strategyType)) {
      return errorResult('backtest', ErrorCodes.INVALID_PARAM_RANGE,
        `Invalid strategy type '${opts['strategy']}'. Valid types: ${VALID_STRATEGY_TYPES.join(', ')}`);
    }

    // ---- Universe resolution ----
    const universeArg = opts['universe'];

    // Validate --universe flag value (including 'all')
    if (universeArg !== undefined && universeArg !== 'all') {
      const validWithAll = [...VALID_UNIVERSES, 'all'];
      if (!validWithAll.includes(universeArg as any)) {
        return errorResult('backtest', 'INVALID_PARAM_RANGE',
          `Invalid --universe value '${universeArg}'. Valid options: ${VALID_UNIVERSES.join(', ')}, all`);
      }
    }

    // Handle --universe all: iterate over defined tiers, backtest each independently
    if (universeArg === 'all') {
      const universesToBacktest = ['large_cap', 'mid_cap'] as const;
      const allResults: Record<string, unknown>[] = [];
      const allWarnings: string[] = [];

      for (const tier of universesToBacktest) {
        const resolution = resolveUniverse(tier);
        if ('error' in resolution) {
          allWarnings.push(`[${tier}] Skipping: ${resolution.error}`);
          continue;
        }

        // Load tickers from the resolved watchlist for this universe
        const watchlistPath = path.join(dataDir, 'data', resolution.watchlistFile);
        let tickers: string[];
        try {
          const content = readFileSync(watchlistPath, 'utf-8');
          const parsed = JSON.parse(content) as { tickers?: string[] };
          if (!Array.isArray(parsed.tickers) || parsed.tickers.length === 0) {
            allWarnings.push(`[${tier}] Skipping: watchlist at ${watchlistPath} is missing or has empty 'tickers' array`);
            continue;
          }
          tickers = parsed.tickers.map((t: string) => t.toUpperCase());
        } catch {
          allWarnings.push(`[${tier}] Skipping: could not load watchlist at ${watchlistPath}`);
          continue;
        }

        // If --ticker is also provided, use only that ticker within this universe
        if (opts['ticker']) {
          tickers = [opts['ticker'].toUpperCase()];
        }

        // Run v3 backtest for each ticker in this universe
        const period = (opts['period'] as HistoricalPeriod) || '5y';
        const { results, warnings } = await backtestUniverse(tier, tickers, period, dataDir, cachingProvider);
        allResults.push(...results);
        allWarnings.push(...warnings);
      }

      return successResult('backtest', {
        universeMode: 'all',
        results: allResults,
        warnings: allWarnings.length > 0 ? allWarnings : undefined,
        v3: true,
      });
    }

    // Single universe resolution (or default to large_cap)
    const universeResult = resolveUniverse(universeArg);
    if ('error' in universeResult) {
      return errorResult('backtest', 'INVALID_PARAM_RANGE', universeResult.error);
    }

    // When --universe provided without --ticker, load ticker list from resolved watchlist
    if (!opts['ticker'] && universeArg !== undefined) {
      const watchlistPath = path.join(dataDir, 'data', universeResult.watchlistFile);
      let tickers: string[];
      try {
        const content = readFileSync(watchlistPath, 'utf-8');
        const parsed = JSON.parse(content) as { tickers?: string[] };
        if (!Array.isArray(parsed.tickers) || parsed.tickers.length === 0) {
          return errorResult('backtest', 'CONFIG_ERROR',
            `Watchlist at ${watchlistPath} is missing or has empty 'tickers' array`);
        }
        tickers = parsed.tickers.map((t: string) => t.toUpperCase());
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return errorResult('backtest', 'CONFIG_ERROR', `Failed to load watchlist: ${message}`);
      }

      // Run v3 backtest for each ticker in the universe
      const period = (opts['period'] as HistoricalPeriod) || '5y';
      const { results, warnings } = await backtestSingleUniverse(tickers, period, dataDir, cachingProvider);

      return successResult('backtest', {
        universe: universeArg ?? 'large_cap',
        results,
        warnings: warnings.length > 0 ? warnings : undefined,
        v3: true,
      });
    }

    // Require --ticker when --universe is not provided (backward compatibility)
    if (!opts['ticker']) {
      return errorResult('backtest', ErrorCodes.MISSING_PARAM,
        `Missing required parameter(s): --ticker`);
    }

    const ticker = opts['ticker'].toUpperCase();

    // --v3 path: run both consolidation_breakout and trend_pullback in parallel
    const isV3Backtest = opts['v3'] !== undefined;
    if (isV3Backtest) {
      const period = (opts['period'] as HistoricalPeriod) || '5y';

      try {
        const dataResult = await cachingProvider.getHistoricalData(ticker, period);

        if (!dataResult.success) {
          const code = dataResult.error.includes(ErrorCodes.INVALID_TICKER)
            ? ErrorCodes.INVALID_TICKER
            : ErrorCodes.PRICE_FEED_UNAVAILABLE;
          return errorResult('backtest', code, dataResult.error);
        }

        const dataPoints = dataResult.data.dataPoints;
        const v3Result = runV3ForTicker(ticker, dataPoints, dataDir);

        if (opts['chart'] !== undefined) {
          const chartFilePath = getChartFilePath(dataDir, ticker);
          const html = generateCombinedChartHtml({
            cbResult: v3Result.consolidation_breakout,
            tpResult: v3Result.trend_pullback,
            kmrResult: v3Result.keltner_mean_reversion,
            bbResult: v3Result.bear_breakdown,
            dataPoints,
            combinedMetrics: v3Result.combined,
          });
          writeFileSync(chartFilePath, html, 'utf-8');
          return successResult('backtest', {
            ...v3Result,
            chartFilePath,
            chartUrl: `file://${nodePath.resolve(chartFilePath)}`,
            v3: true,
          });
        }

        return successResult('backtest', { ...v3Result, v3: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult('backtest', ErrorCodes.PRICE_FEED_UNAVAILABLE, message);
      }
    }

    // Resolve strategy instance
    const strategyInstance = getStrategyInstance(strategyType);

    // Parse and validate optional --params
    let params: StrategyParams;
    if (opts['params']) {
      try {
        params = JSON.parse(opts['params']) as StrategyParams;
      } catch {
        return errorResult('backtest', ErrorCodes.INVALID_PARAM_RANGE,
          `Invalid JSON for --params: ${opts['params']}`);
      }

      // V2 path: detect phased strategy configuration
      if (isV2Config((params as any).config ?? params)) {
        const parsed = (params as any).config ?? params;
        const v2Params: PhasedStrategyParams = { config: parsed };

        const adapter = createV2Adapter(strategyType);
        const period = (opts['period'] as HistoricalPeriod) || '1y';

        const result = await executeBacktest(
          { ticker, period, params: v2Params, generateChart: opts['chart'] !== undefined, dataDir },
          adapter,
          cachingProvider,
        );

        if (!result.success) {
          return errorResult('backtest', result.code, result.message);
        }

        if (result.chartFilePath) {
          return successResult('backtest', { ...result.result, chartFilePath: result.chartFilePath, chartUrl: result.chartUrl });
        }
        return successResult('backtest', result.result);
      }

      // Consolidation-breakout path
      if (isConsolidationBreakoutConfig((params as any).config ?? params)) {
        const parsed = (params as any).config ?? params;
        const cbParams: ConsolidationBreakoutParams = { config: parsed };

        const adapter = createConsolidationBreakoutAdapter();
        const period = (opts['period'] as HistoricalPeriod) || '1y';

        const result = await executeBacktest(
          { ticker, period, params: cbParams, generateChart: opts['chart'] !== undefined, dataDir },
          adapter,
          cachingProvider,
        );

        if (!result.success) {
          return errorResult('backtest', result.code, result.message);
        }

        if (result.chartFilePath) {
          return successResult('backtest', { ...result.result, chartFilePath: result.chartFilePath, chartUrl: result.chartUrl });
        }
        return successResult('backtest', result.result);
      }

      // V1 path: validate with existing strategy instance
      if (!strategyInstance) {
        // Check if this is a trend_pullback config for standalone backtest
        if (isTrendPullbackConfig((params as any).config ?? params)) {
          const parsed = (params as any).config ?? params;
          const tpParams: TrendPullbackParams = { config: parsed };

          const adapter = createTrendPullbackAdapter();
          const period = (opts['period'] as HistoricalPeriod) || '1y';

          const result = await executeBacktest(
            { ticker, period, params: tpParams, generateChart: opts['chart'] !== undefined, dataDir },
            adapter,
            cachingProvider,
          );

          if (!result.success) {
            return errorResult('backtest', result.code, result.message);
          }

          if (result.chartFilePath) {
            return successResult('backtest', { ...result.result, chartFilePath: result.chartFilePath, chartUrl: result.chartUrl });
          }
          return successResult('backtest', result.result);
        }

        return errorResult('backtest', ErrorCodes.INVALID_PARAM_RANGE,
          `Strategy type '${strategyType}' does not support V1 backtest path`);
      }
      const validation = strategyInstance.validateParams(params);
      if (!validation.valid) {
        return errorResult('backtest', ErrorCodes.INVALID_PARAM_RANGE,
          `${ErrorCodes.INVALID_PARAM_RANGE}: ${validation.error}`);
      }
    } else {
      params = getDefaultParams(strategyType);
    }

    // Use optional --period, defaulting to "1y"
    const period = (opts['period'] as HistoricalPeriod) || '1y';

    // Fetch historical data (V1 path)
    try {
      const histResult = await cachingProvider.getHistoricalData(ticker, period);

      if (!histResult.success) {
        const code = histResult.error.includes(ErrorCodes.INVALID_TICKER)
          ? ErrorCodes.INVALID_TICKER
          : histResult.error.includes(ErrorCodes.INVALID_PARAM_RANGE)
            ? ErrorCodes.INVALID_PARAM_RANGE
            : ErrorCodes.PRICE_FEED_UNAVAILABLE;
        return errorResult('backtest', code, histResult.error);
      }

      // Convert historical data to PricePoint[]
      const pricePoints = convertHistoricalData(histResult.data.dataPoints, ticker);

      // For composite strategies: fetch auxiliary data if needed and reset engine state
      if ('config' in params) {
        const compositeParams = params as unknown as CompositeStrategyParams;
        // Inject primary ticker's OHLCV data for volume/ATR calculations
        compositeParams.primaryDataPoints = histResult.data.dataPoints;
        const indexTicker = compositeParams.config.indexTicker;
        if (indexTicker) {
          try {
            const auxResult = await priceFeedClient.fetchHistoricalData(indexTicker, period);
            if (auxResult.success) {
              compositeParams.auxiliaryData = {
                [indexTicker]: auxResult.data.dataPoints,
              };
            }
          } catch {
            // Auxiliary data fetch failure is non-fatal; outperforms_index will just fail
          }
        }
        // Reset composite engine state before backtest
        (strategyInstance as any).reset?.();
      }

      // Run backtest
      const engine = new BacktestEngine();
      const backtestResult = engine.run(pricePoints, strategyInstance!, params, period);

      // If --chart flag is present and backtest succeeded, generate HTML visualization
      if (opts['chart'] !== undefined) {
        const chartFilePath = getChartFilePath(dataDir, ticker);
        const html = generateChartHtml({
          backtestResult,
          dataPoints: histResult.data.dataPoints,
          strategyParams: params,
        });
        writeFileSync(chartFilePath, html, 'utf-8');
        return successResult('backtest', { ...backtestResult, chartFilePath, chartUrl: `file://${nodePath.resolve(chartFilePath)}` });
      }

      return successResult('backtest', backtestResult);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult('backtest', ErrorCodes.PRICE_FEED_UNAVAILABLE, message);
    }
  };
}
