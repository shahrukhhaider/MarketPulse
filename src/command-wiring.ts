import * as path from 'node:path';
import { CommandRouter, successResult, errorResult } from './command-router.js';
import { load as loadConfig, save as saveConfig, getDefault } from './data/config-store.js';
import { PriceDataStore } from './data/price-data-store.js';
import { PriceFeedClient } from './data/price-feed-client.js';
import type { YahooFinanceClient } from './data/price-feed-client.js';
import { WatchlistManager } from './utils/watchlist-manager.js';
import { StrategyManager } from './strategies/strategy-manager.js';
import { ProcessManager } from './monitoring/process-manager.js';
import { SignalStore } from './monitoring/signal-store.js';
import { ErrorCodes } from './types.js';
import type { StrategyType, StrategyParams, HistoricalPeriod, HistoricalInterval } from './types.js';
import { DataProviderRegistry } from './data/data-provider.js';
import { YahooFinanceAdapter } from './data/yahoo-finance-adapter.js';
import { BacktestEngine, convertHistoricalData } from './pipeline/backtest-engine.js';
import { MovingAverageCrossoverStrategy } from './strategies/moving-average.js';
import { RSIThresholdStrategy } from './strategies/rsi-threshold.js';
import { PriceBreakoutStrategy } from './strategies/price-breakout.js';
import { CompositeStrategyEngine } from './strategies/composite-engine.js';
import { getDefaultCompositeConfig, isV2Config, isConsolidationBreakoutConfig, isTrendPullbackConfig, type CompositeStrategyParams, type PhasedStrategyParams, type ConsolidationBreakoutParams, type TrendPullbackParams, DEFAULT_PEAD_CONFIG, DEFAULT_KMR_CONFIG } from './strategies/strategy-configs.js';
import { PhasedStrategyEngine } from './strategies/phased-engine.js';
import { ConsolidationBreakoutEngine } from './strategies/consolidation-breakout-engine.js';
import { TrendPullbackEngine } from './strategies/trend-pullback-engine.js';
import { tuneV3, backtestV3 } from './pipeline/pipeline-functions.js';
import type { V3BacktestResult, V3TuneResult } from './pipeline/pipeline-functions.js';
import { loadStrategyProfile, saveStrategyProfile, computeExpiry } from './data/profile-store.js';
import type { StrategyProfile } from './data/profile-store.js';
import { HistoricalDataCache } from './data/historical-data-cache.js';
import { TuningEngine } from './pipeline/tuning-engine.js';
import type { TuningInput, TunableStrategy, TimeHorizon, RiskProfile, BestRegion } from './pipeline/tuning-engine.js';

import { generateChartHtml, generateCombinedChartHtml, getChartFilePath } from './formatters/chart-generator.js';
import { writeFileSync, readFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { buildConfig, buildV2Config, generateV2Grid, generateConsolidationBreakoutGrid, buildConsolidationBreakoutConfig } from './strategies/parameter-grid.js';
import type { CapTier, ConsolidationBreakoutGridEntry } from './strategies/parameter-grid.js';
import { evaluateV3Configuration, splitData } from './pipeline/walk-forward-validator.js';
import { StrategyRegistry } from './strategies/strategy-registry.js';
import { ConsolidationBreakoutStrategy } from './strategies/consolidation-breakout-strategy.js';
import { BearBreakdownStrategy } from './strategies/bear-breakdown-strategy.js';
import { PostEarningsDriftStrategy } from './strategies/post-earnings-drift-strategy.js';
import { KeltnerMeanReversionStrategy } from './strategies/keltner-mean-reversion-strategy.js';
import { VduEngine } from './strategies/vdu-engine.js';
import { createTuneHandler, parseCapTier } from './commands/tune-command.js';
import { createScanHandler } from './commands/scan-command.js';
import { createChartHandler } from './commands/chart-command.js';
import { createScanChartHandler } from './commands/scan-chart-command.js';
import { parallelTune } from './pipeline/parallel-tune.js';
import { createJournalStatusHandler, createJournalRecordHandler, createJournalUpdateHandler } from './commands/journal-command.js';
import { createRegimeHandler } from './commands/regime-command.js';
import { createSignalHistoryHandler } from './signal-history/signal-history-command.js';
import { RegimeDetector } from './indicators/regime-detector.js';

export interface WiringOptions {
  dataDir?: string;
  configPath?: string;
  priceDataPath?: string;
  yahooFinanceClient?: YahooFinanceClient;
  providerName?: string;
  noCache?: boolean;
}

// ============================================================
// Concurrency Flag Parsing
// ============================================================

/**
 * Parse and validate the --concurrency CLI flag.
 * Returns the parsed integer value, or undefined if not specified.
 * Emits a warning to stderr if the value is out of range.
 *
 * Valid range: 1–64 (integers only).
 * - Values < 1 are rejected → returns default (8)
 * - Values > 64 are rejected → returns 64
 * - Non-integer or non-numeric values → returns default (8)
 */
export function parseConcurrency(opts: Record<string, string>): number {
  const DEFAULT_CONCURRENCY = 8;
  const MAX_CONCURRENCY = 64;
  const MIN_CONCURRENCY = 1;

  const raw = opts['concurrency'];
  if (raw === undefined) {
    return DEFAULT_CONCURRENCY;
  }

  const parsed = Number(raw);

  // Non-numeric or NaN
  if (!Number.isFinite(parsed)) {
    process.stderr.write(
      `Warning: Invalid --concurrency value '${raw}'. Using default (${DEFAULT_CONCURRENCY}).\n`,
    );
    return DEFAULT_CONCURRENCY;
  }

  // Non-integer
  if (!Number.isInteger(parsed)) {
    process.stderr.write(
      `Warning: --concurrency must be an integer. Got '${raw}', using default (${DEFAULT_CONCURRENCY}).\n`,
    );
    return DEFAULT_CONCURRENCY;
  }

  // Below minimum
  if (parsed < MIN_CONCURRENCY) {
    process.stderr.write(
      `Warning: --concurrency must be at least ${MIN_CONCURRENCY}. Got ${parsed}, using default (${DEFAULT_CONCURRENCY}).\n`,
    );
    return DEFAULT_CONCURRENCY;
  }

  // Above maximum
  if (parsed > MAX_CONCURRENCY) {
    process.stderr.write(
      `Warning: --concurrency cannot exceed ${MAX_CONCURRENCY}. Got ${parsed}, capping at ${MAX_CONCURRENCY}.\n`,
    );
    return MAX_CONCURRENCY;
  }

  return parsed;
}

export interface WiredRouter {
  router: CommandRouter;
  config: ReturnType<typeof getDefault>;
  priceDataStore: PriceDataStore;
  priceFeedClient: PriceFeedClient;
  watchlistManager: WatchlistManager;
  strategyManager: StrategyManager;
  processManager: ProcessManager;
  registry: DataProviderRegistry;
  cachingProvider: HistoricalDataCache;
  strategyRegistry: StrategyRegistry;
}

/**
 * Create a fully wired CommandRouter with real handlers connected to domain components.
 * Loads config and price data on initialization.
 */
export function createWiredRouter(options: WiringOptions = {}): WiredRouter {
  const dataDir = options.dataDir ?? '.stock-tracker';
  const configPath = options.configPath ?? path.join(dataDir, 'config.json');
  const priceDataPath = options.priceDataPath ?? path.join(dataDir, 'price-data.json');

  // Load config (or use defaults if file doesn't exist / is invalid)
  const configResult = loadConfig(configPath);
  const config = configResult.success ? configResult.data : getDefault();

  // Load price data
  const priceDataStore = new PriceDataStore();
  priceDataStore.load(priceDataPath);

  // Create registry and register the Yahoo Finance adapter
  const registry = new DataProviderRegistry();
  const yahooAdapter = new YahooFinanceAdapter(options.yahooFinanceClient);
  registry.register(yahooAdapter);

  // Resolve active provider: use requested provider or fall back to yahoo
  const activeProvider = (options.providerName ? registry.get(options.providerName) : undefined) ?? registry.get('yahoo')!;

  // Wrap the active provider in HistoricalDataCache
  const cachingProvider = new HistoricalDataCache(activeProvider, {
    cacheDir: path.join(dataDir, 'history-cache'),
    noCache: options.noCache,
  });

  // Create domain components
  const priceFeedClient = new PriceFeedClient(cachingProvider);
  const watchlistManager = new WatchlistManager(config, configPath);
  const strategyManager = new StrategyManager(config, configPath);
  const processManager = new ProcessManager(dataDir);

  // Create router and wire handlers
  const router = new CommandRouter();

  // --- add-stock ---
  router.register('add-stock', ['ticker'], async (opts) => {
    const ticker = opts['ticker'].toUpperCase();

    // Validate ticker via PriceFeedClient
    const validation = await priceFeedClient.validateTicker(ticker);
    if (!validation.success) {
      return errorResult('add-stock', ErrorCodes.INVALID_TICKER,
        `Ticker symbol '${ticker}' not found in price feed`);
    }

    // Add via WatchlistManager
    const result = watchlistManager.addStock(ticker);
    if (!result.success) {
      const code = result.error.includes(ErrorCodes.DUPLICATE_STOCK)
        ? ErrorCodes.DUPLICATE_STOCK : 'ADD_FAILED';
      return errorResult('add-stock', code, result.error);
    }

    return successResult('add-stock', {
      ticker: result.data.ticker,
      addedAt: result.data.addedAt,
      message: `Stock '${ticker}' added to watchlist`,
    });
  });

  // --- remove-stock ---
  router.register('remove-stock', ['ticker'], (opts) => {
    const ticker = opts['ticker'].toUpperCase();

    const result = watchlistManager.removeStock(ticker);
    if (!result.success) {
      const code = result.error.includes(ErrorCodes.STOCK_NOT_FOUND)
        ? ErrorCodes.STOCK_NOT_FOUND : 'REMOVE_FAILED';
      return errorResult('remove-stock', code, result.error);
    }

    return successResult('remove-stock', {
      ticker,
      message: `Stock '${ticker}' removed from watchlist`,
    });
  });

  // --- list-watchlist ---
  router.register('list-watchlist', [], (_opts) => {
    const stocks = watchlistManager.listStocks();

    const enriched = stocks.map((entry) => {
      const history = priceDataStore.getPriceHistory(entry.ticker);
      const lastPrice = history.length > 0 ? history[history.length - 1] : null;

      return {
        ticker: entry.ticker,
        addedAt: entry.addedAt,
        strategies: entry.strategies.length,
        lastPrice: lastPrice ? lastPrice.price : null,
        lastPriceTimestamp: lastPrice ? lastPrice.timestamp : null,
      };
    });

    return successResult('list-watchlist', { stocks: enriched, count: enriched.length });
  });

  // --- start-monitor ---
  router.register('start-monitor', [], (opts) => {
    const interval = opts['interval'] ? parseInt(opts['interval'], 10) : 60;

    const result = processManager.spawn({
      configPath,
      pollingInterval: interval,
      dataDir,
    });

    if (!result.success) {
      return errorResult('start-monitor', result.error.code, result.error.message);
    }

    return successResult('start-monitor', {
      pid: result.data.pid,
      signalFilePath: result.data.signalFilePath,
      sessionStartTime: result.data.sessionStartTime,
      pollingInterval: result.data.pollingInterval,
      message: 'Monitoring started',
    });
  });

  // --- stop-monitor ---
  router.register('stop-monitor', [], (_opts) => {
    const result = processManager.terminate();

    if (!result.success) {
      return errorResult('stop-monitor', result.error.code, result.error.message);
    }

    return successResult('stop-monitor', { message: 'Monitoring stopped' });
  });

  // --- get-status ---
  router.register('get-status', [], (_opts) => {
    const status = processManager.getStatus();
    return successResult('get-status', status);
  });

  // --- configure-strategy ---
  router.register('configure-strategy', ['ticker', 'strategy'], (opts) => {
    const ticker = opts['ticker'].toUpperCase();
    const strategyType = opts['strategy'] as StrategyType;

    // Handle --enabled toggle (without params means just toggle)
    if (opts['enabled'] !== undefined && !opts['params']) {
      const enabled = opts['enabled'].toLowerCase() === 'true';
      const toggleResult = enabled
        ? strategyManager.enableStrategy(ticker, strategyType)
        : strategyManager.disableStrategy(ticker, strategyType);

      if (!toggleResult.success) {
        const code = toggleResult.error.includes(ErrorCodes.STOCK_NOT_FOUND)
          ? ErrorCodes.STOCK_NOT_FOUND : ErrorCodes.INVALID_PARAM_RANGE;
        return errorResult('configure-strategy', code, toggleResult.error);
      }

      return successResult('configure-strategy', {
        ticker,
        strategy: strategyType,
        enabled,
        message: `Strategy '${strategyType}' ${enabled ? 'enabled' : 'disabled'} for '${ticker}'`,
      });
    }

    // Parse params JSON (default to empty object if not provided)
    let params: StrategyParams;
    if (opts['params']) {
      params = JSON.parse(opts['params']) as StrategyParams;
    } else {
      // Use default params based on strategy type
      params = getDefaultParams(strategyType);
    }

    // Configure strategy via StrategyManager
    const result = strategyManager.configureStrategy(ticker, strategyType, params);
    if (!result.success) {
      const code = result.error.includes(ErrorCodes.STOCK_NOT_FOUND)
        ? ErrorCodes.STOCK_NOT_FOUND
        : result.error.includes(ErrorCodes.INVALID_PARAM_RANGE)
          ? ErrorCodes.INVALID_PARAM_RANGE
          : 'CONFIGURE_FAILED';
      return errorResult('configure-strategy', code, result.error);
    }

    // Handle --enabled toggle after configuration
    if (opts['enabled'] !== undefined) {
      const enabled = opts['enabled'].toLowerCase() === 'true';
      if (!enabled) {
        strategyManager.disableStrategy(ticker, strategyType);
      }
    }

    return successResult('configure-strategy', {
      ticker,
      strategy: strategyType,
      params,
      message: `Strategy '${strategyType}' configured for '${ticker}'`,
    });
  });

  // --- show-signals ---
  router.register('show-signals', [], (opts) => {
    const limit = opts['limit'] ? parseInt(opts['limit'], 10) : undefined;

    // Get signal file path from the active session
    const signalFilePath = processManager.getSignalFilePath();
    if (!signalFilePath) {
      return successResult('show-signals', {
        signals: [],
        count: 0,
        message: 'No active monitoring session. No signals to display.',
      });
    }

    const signalStore = new SignalStore(signalFilePath);
    const signals = signalStore.getSignalHistory(limit);

    return successResult('show-signals', {
      signals,
      count: signals.length,
    });
  });

  // --- history ---
  router.register('history', ['ticker'], async (opts) => {
    const ticker = opts['ticker'];
    const period = (opts['period'] as HistoricalPeriod) || undefined;
    const interval = (opts['interval'] as HistoricalInterval) || undefined;

    let result;
    result = await priceFeedClient.fetchHistoricalData(ticker, period, interval);

    if (!result.success) {
      const code = result.error.includes(ErrorCodes.INVALID_TICKER)
        ? ErrorCodes.INVALID_TICKER
        : result.error.includes(ErrorCodes.INVALID_PARAM_RANGE)
          ? ErrorCodes.INVALID_PARAM_RANGE
          : ErrorCodes.PRICE_FEED_UNAVAILABLE;
      return errorResult('history', code, result.error);
    }

    return successResult('history', {
      ticker: result.data.ticker,
      period: period || '1y',
      interval: result.data.interval,
      dataPoints: result.data.dataPoints,
      count: result.data.dataPoints.length,
    });
  });

  // --- backtest ---
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

  router.register('backtest', ['ticker', 'strategy'], async (opts) => {
    const ticker = opts['ticker'].toUpperCase();
    const strategyType = opts['strategy'] as StrategyType;

    // Validate strategy type
    if (!VALID_STRATEGY_TYPES.includes(strategyType)) {
      return errorResult('backtest', ErrorCodes.INVALID_PARAM_RANGE,
        `Invalid strategy type '${opts['strategy']}'. Valid types: ${VALID_STRATEGY_TYPES.join(', ')}`);
    }

    // --v3 path: run both consolidation_breakout and trend_pullback in parallel
    const isV3Backtest = opts['v3'] !== undefined;
    if (isV3Backtest) {
      const period = (opts['period'] as HistoricalPeriod) || '5y';
      const noCache = opts['no-cache'] !== undefined;

      try {
        let dataResult;
        dataResult = await cachingProvider.getHistoricalData(ticker, period);

        if (!dataResult.success) {
          const code = dataResult.error.includes(ErrorCodes.INVALID_TICKER)
            ? ErrorCodes.INVALID_TICKER
            : ErrorCodes.PRICE_FEED_UNAVAILABLE;
          return errorResult('backtest', code, dataResult.error);
        }

        const dataPoints = dataResult.data.dataPoints;

        // Load profiles for both strategies to get params
        const cbProfile = loadStrategyProfile(ticker, 'consolidation_breakout', { allowStale: true, baseDir: dataDir });
        const tpProfile = loadStrategyProfile(ticker, 'trend_pullback', { allowStale: true, baseDir: dataDir });
        const kmrProfile = loadStrategyProfile(ticker, 'keltner_mean_reversion', { allowStale: true, baseDir: dataDir });
        const bbProfile = loadStrategyProfile(ticker, 'bear_breakdown', { allowStale: true, baseDir: dataDir });
        const vduProfile = loadStrategyProfile(ticker, 'volume_dry_up', { allowStale: true, baseDir: dataDir });

        // Use profile params if available, otherwise use empty params (will use defaults from grid)
        const cbParams: Record<string, number> = cbProfile.success ? cbProfile.data.params : {};
        const tpParams: Record<string, number> = tpProfile.success ? tpProfile.data.params : {};
        const kmrParams: Record<string, number> = kmrProfile.success ? kmrProfile.data.params : {};
        const bbParams: Record<string, number> = bbProfile.success ? bbProfile.data.params : {};
        const vduParams: Record<string, number> = vduProfile.success ? vduProfile.data.params : {};

        const v3Result: V3BacktestResult = backtestV3(dataPoints, cbParams, tpParams, kmrParams, bbParams, vduParams);
        v3Result.consolidation_breakout.ticker = ticker;
        v3Result.trend_pullback.ticker = ticker;
        if (v3Result.keltner_mean_reversion) {
          v3Result.keltner_mean_reversion.ticker = ticker;
        }
        if (v3Result.bear_breakdown) {
          v3Result.bear_breakdown.ticker = ticker;
        }
        if (v3Result.volume_dry_up) {
          v3Result.volume_dry_up.ticker = ticker;
        }

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
        const v2Engine = new PhasedStrategyEngine(strategyType);
        const v2Params: PhasedStrategyParams = { config: parsed };
        const validation = v2Engine.validateParams(v2Params);
        if (!validation.valid) {
          return errorResult('backtest', ErrorCodes.INVALID_PARAM_RANGE,
            `${ErrorCodes.INVALID_PARAM_RANGE}: ${validation.error}`);
        }

        const period = (opts['period'] as HistoricalPeriod) || '1y';
        const noCache = opts['no-cache'] !== undefined;

        try {
          let histResult;
          histResult = await cachingProvider.getHistoricalData(ticker, period);

          if (!histResult.success) {
            const code = histResult.error.includes(ErrorCodes.INVALID_TICKER)
              ? ErrorCodes.INVALID_TICKER
              : histResult.error.includes(ErrorCodes.INVALID_PARAM_RANGE)
                ? ErrorCodes.INVALID_PARAM_RANGE
                : ErrorCodes.PRICE_FEED_UNAVAILABLE;
            return errorResult('backtest', code, histResult.error);
          }

          v2Params.primaryDataPoints = histResult.data.dataPoints;
          v2Engine.reset();
          const engine = new BacktestEngine();
          const backtestResult = engine.runV2(histResult.data.dataPoints, v2Engine, v2Params, period);

          if (opts['chart'] !== undefined) {
            const chartFilePath = getChartFilePath(dataDir, ticker);
            const html = generateChartHtml({
              backtestResult,
              dataPoints: histResult.data.dataPoints,
              strategyParams: v2Params,
            });
            writeFileSync(chartFilePath, html, 'utf-8');
            return successResult('backtest', { ...backtestResult, chartFilePath, chartUrl: `file://${nodePath.resolve(chartFilePath)}` });
          }

          return successResult('backtest', backtestResult);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult('backtest', ErrorCodes.PRICE_FEED_UNAVAILABLE, message);
        }
      }

      // V3 path: detect consolidation-breakout configuration
      if (isConsolidationBreakoutConfig((params as any).config ?? params)) {
        const parsed = (params as any).config ?? params;
        const v3Engine = new ConsolidationBreakoutEngine();
        const v3Params: ConsolidationBreakoutParams = { config: parsed };
        const validation = v3Engine.validateParams(v3Params);
        if (!validation.valid) {
          return errorResult('backtest', ErrorCodes.INVALID_PARAM_RANGE,
            `${ErrorCodes.INVALID_PARAM_RANGE}: ${validation.error}`);
        }

        const period = (opts['period'] as HistoricalPeriod) || '1y';
        const noCache = opts['no-cache'] !== undefined;

        try {
          let histResult;
          histResult = await cachingProvider.getHistoricalData(ticker, period);

          if (!histResult.success) {
            const code = histResult.error.includes(ErrorCodes.INVALID_TICKER)
              ? ErrorCodes.INVALID_TICKER
              : histResult.error.includes(ErrorCodes.INVALID_PARAM_RANGE)
                ? ErrorCodes.INVALID_PARAM_RANGE
                : ErrorCodes.PRICE_FEED_UNAVAILABLE;
            return errorResult('backtest', code, histResult.error);
          }

          v3Params.primaryDataPoints = histResult.data.dataPoints;
          const engine = new BacktestEngine();
          const backtestResult = engine.runV2(histResult.data.dataPoints, v3Engine, v3Params, period);

          if (opts['chart'] !== undefined) {
            const chartFilePath = getChartFilePath(dataDir, ticker);
            const html = generateChartHtml({
              backtestResult,
              dataPoints: histResult.data.dataPoints,
              strategyParams: v3Params,
            });
            writeFileSync(chartFilePath, html, 'utf-8');
            return successResult('backtest', { ...backtestResult, chartFilePath, chartUrl: `file://${nodePath.resolve(chartFilePath)}` });
          }

          return successResult('backtest', backtestResult);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult('backtest', ErrorCodes.PRICE_FEED_UNAVAILABLE, message);
        }
      }

      // V1 path: validate with existing strategy instance
      if (!strategyInstance) {
        // Check if this is a trend_pullback config for standalone backtest (Requirement 9.8)
        if (isTrendPullbackConfig((params as any).config ?? params)) {
          const parsed = (params as any).config ?? params;
          const tpEngine = new TrendPullbackEngine();
          const tpParams: TrendPullbackParams = { config: parsed };
          const validation = tpEngine.validateParams(tpParams);
          if (!validation.valid) {
            return errorResult('backtest', ErrorCodes.INVALID_PARAM_RANGE,
              `${ErrorCodes.INVALID_PARAM_RANGE}: ${validation.error}`);
          }

          const period = (opts['period'] as HistoricalPeriod) || '1y';
          const noCache = opts['no-cache'] !== undefined;

          try {
            let histResult;
            histResult = await cachingProvider.getHistoricalData(ticker, period);

            if (!histResult.success) {
              const code = histResult.error.includes(ErrorCodes.INVALID_TICKER)
                ? ErrorCodes.INVALID_TICKER
                : histResult.error.includes(ErrorCodes.INVALID_PARAM_RANGE)
                  ? ErrorCodes.INVALID_PARAM_RANGE
                  : ErrorCodes.PRICE_FEED_UNAVAILABLE;
              return errorResult('backtest', code, histResult.error);
            }

            tpParams.primaryDataPoints = histResult.data.dataPoints;
            tpEngine.reset();
            const engine = new BacktestEngine();
            const backtestResult = engine.runV2(histResult.data.dataPoints, tpEngine, tpParams, period);

            if (opts['chart'] !== undefined) {
              const chartFilePath = getChartFilePath(dataDir, ticker);
              const html = generateChartHtml({
                backtestResult,
                dataPoints: histResult.data.dataPoints,
                strategyParams: tpParams,
              });
              writeFileSync(chartFilePath, html, 'utf-8');
              return successResult('backtest', { ...backtestResult, chartFilePath, chartUrl: `file://${nodePath.resolve(chartFilePath)}` });
            }

            return successResult('backtest', backtestResult);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return errorResult('backtest', ErrorCodes.PRICE_FEED_UNAVAILABLE, message);
          }
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
    const noCache = opts['no-cache'] !== undefined;

    // Fetch historical data (V1 path)
    try {
      let histResult;
      histResult = await cachingProvider.getHistoricalData(ticker, period);

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
  });

  // --- clear-cache ---
  router.register('clear-cache', [], (opts) => {
    const ticker = opts['ticker'] ? opts['ticker'].toUpperCase() : undefined;
    const result = cachingProvider.clearCache(ticker);
    return successResult('clear-cache', {
      removed: result.removed,
      message: ticker
        ? `Cleared ${result.removed} cache entries for '${ticker}'`
        : `Cleared ${result.removed} cache entries`,
    });
  });

  // --- tune ---
  router.register('tune', ['ticker', 'strategy'], async (opts) => {
    const ticker = opts['ticker'].toUpperCase();
    const strategy = opts['strategy'] as TunableStrategy;
    const isV3 = opts['v3'] !== undefined;
    const isV2 = opts['v2'] !== undefined;

    if (isV3) {
      // V3 tuning path: use generateConsolidationBreakoutGrid + BacktestEngine.runV2
      const period = '5y';
      const noCache = opts['no-cache'] !== undefined;

      try {
        let dataResult;
        dataResult = await cachingProvider.getHistoricalData(ticker, period);

        if (!dataResult.success) {
          return errorResult('tune', 'DATA_PROVIDER_ERROR', dataResult.error);
        }

        const dataPoints = dataResult.data.dataPoints;

        // Split data into IS (70%) and OOS (30%) — replaces inline < 100 check
        const splitResult = splitData(dataPoints);
        if ('error' in splitResult) {
          return errorResult('tune', 'INSUFFICIENT_DATA', splitResult.error);
        }
        const { inSample: isData, outOfSample: oosData } = splitResult;

        const grid = generateConsolidationBreakoutGrid();

        // Evaluate each grid entry on IS data only, filtering inline to save memory
        type GridMetricsEntry = {
          entry: ConsolidationBreakoutGridEntry;
          isMetrics: { totalReturnPercent: number; sharpeRatio: number; maxDrawdownPercent: number; winRate: number; tradeCount: number; profitFactor: number };
        };
        const filtered: GridMetricsEntry[] = [];
        const fallback: GridMetricsEntry[] = [];
        let configurationsEvaluated = 0;

        for (const entry of grid) {
          configurationsEvaluated++;
          const metrics = evaluateV3Configuration(entry, isData);

          if (
            metrics.maxDrawdownPercent <= 25 &&
            metrics.profitFactor >= 1.0 &&
            metrics.totalReturnPercent > 0 &&
            metrics.tradeCount >= 3
          ) {
            filtered.push({ entry, isMetrics: metrics });
          } else if (metrics.tradeCount > 0) {
            fallback.push({ entry, isMetrics: metrics });
          }
        }

        // Use strict filter results, or fallback to any config with trades
        const candidates = filtered.length > 0 ? filtered : fallback;

        if (candidates.length === 0) {
          return errorResult('tune', 'NO_VIABLE_CONFIGS',
            `No viable V3 configurations found for ${ticker} / ${strategy}`);
        }

        // Rank by IS total return descending
        candidates.sort((a, b) => b.isMetrics.totalReturnPercent - a.isMetrics.totalReturnPercent);
        const topCount = Math.max(1, Math.ceil(candidates.length * 0.2));
        const topConfigs = candidates.slice(0, topCount);

        // Compute best region
        const bestRegion: Record<string, { min: number; max: number }> = {};
        const paramNames = Object.keys(topConfigs[0].entry.params);
        for (const name of paramNames) {
          const values = topConfigs.map(c => c.entry.params[name]);
          bestRegion[name] = { min: Math.min(...values), max: Math.max(...values) };
        }

        // Summary metrics (mean of top IS configs)
        const n = topConfigs.length;
        const summaryMetrics = {
          totalReturnPercent: topConfigs.reduce((s, c) => s + c.isMetrics.totalReturnPercent, 0) / n,
          sharpeRatio: topConfigs.reduce((s, c) => s + c.isMetrics.sharpeRatio, 0) / n,
          maxDrawdownPercent: topConfigs.reduce((s, c) => s + c.isMetrics.maxDrawdownPercent, 0) / n,
          winRate: topConfigs.reduce((s, c) => s + c.isMetrics.winRate, 0) / n,
          tradeCount: topConfigs.reduce((s, c) => s + c.isMetrics.tradeCount, 0) / n,
          profitFactor: topConfigs.reduce((s, c) => s + c.isMetrics.profitFactor, 0) / n,
        };

        // Best config: IS metrics from grid search, OOS metrics from validation
        const bestEntry = candidates[0].entry;
        const bestIsMetrics = candidates[0].isMetrics;
        const bestOosMetrics = evaluateV3Configuration(bestEntry, oosData);

        const riskProfile = (opts['risk'] as RiskProfile) ?? 'low';
        const horizon = (opts['horizon'] as TimeHorizon) ?? 'long_term';
        const profile = `${horizon}_${riskProfile}`;

        return successResult('tune', {
          ticker,
          strategy,
          profile,
          best_region: bestRegion,
          summary_metrics: summaryMetrics,
          inSample: bestIsMetrics,
          outOfSample: bestOosMetrics,
          configurations_evaluated: configurationsEvaluated,
          configurations_passed_filter: candidates.length,
          computed_at: new Date().toISOString(),
          v3: true,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult('tune', 'TUNING_ERROR', message);
      }
    }

    if (isV2) {
      // V2 tuning path: use generateV2Grid + BacktestEngine.runV2
      const horizon = (opts['horizon'] as TimeHorizon) ?? 'long_term';
      const period = horizon === 'short_term' ? '2y' : '5y';
      const noCache = opts['no-cache'] !== undefined;

      try {
        let dataResult;
        dataResult = await cachingProvider.getHistoricalData(ticker, period);

        if (!dataResult.success) {
          return errorResult('tune', 'DATA_PROVIDER_ERROR', dataResult.error);
        }

        const dataPoints = dataResult.data.dataPoints;
        if (dataPoints.length < 100) {
          return errorResult('tune', 'INSUFFICIENT_DATA',
            `Insufficient data: need at least 100 data points, got ${dataPoints.length}`);
        }

        // V2 engine requires ~200 data points minimum (SMA 200 in direction phase).
        // Use full dataset for evaluation — walk-forward split is impractical
        // with short_term (2y / ~500 points) given the high minimum data requirement.
        const grid = generateV2Grid(horizon);
        const v2Results: Array<{
          params: Record<string, number>;
          inSample: { totalReturnPercent: number; sharpeRatio: number; maxDrawdownPercent: number; winRate: number; tradeCount: number; profitFactor: number };
          outOfSample: { totalReturnPercent: number; sharpeRatio: number; maxDrawdownPercent: number; winRate: number; tradeCount: number; profitFactor: number };
        }> = [];

        for (const entry of grid) {
          const v2Params: PhasedStrategyParams = { config: entry.config };

          // Full-data backtest
          const engine = new PhasedStrategyEngine(strategy);
          engine.reset();
          const bt = new BacktestEngine();
          const result = bt.runV2(dataPoints, engine, v2Params, period);
          const trades = result.performanceSummary.trades;
          let profitFactor = 0;
          if (trades.length > 0) {
            let grossProfits = 0, grossLosses = 0;
            for (const t of trades) {
              if (t.profitLossPercent > 0) grossProfits += t.profitLossPercent;
              else if (t.profitLossPercent < 0) grossLosses += Math.abs(t.profitLossPercent);
            }
            profitFactor = grossLosses === 0 ? Infinity : grossProfits / grossLosses;
          }

          const metrics = {
            totalReturnPercent: result.performanceSummary.totalReturnPercent,
            sharpeRatio: result.performanceSummary.sharpeRatio,
            maxDrawdownPercent: result.performanceSummary.maxDrawdownPercent,
            winRate: result.performanceSummary.winRate,
            tradeCount: result.performanceSummary.numberOfTrades,
            profitFactor,
          };

          v2Results.push({
            params: entry.params,
            inSample: metrics,
            outOfSample: metrics,
          });
        }

        // Filter: OOS drawdown <= 25%, profit factor >= 1.2, positive return
        const filtered = v2Results.filter(r =>
          r.outOfSample.maxDrawdownPercent <= 25 &&
          r.outOfSample.profitFactor >= 1.0 &&
          r.outOfSample.totalReturnPercent > 0
        );

        // Fallback: if strict filter yields nothing, relax to any config with trades
        const candidates = filtered.length > 0
          ? filtered
          : v2Results.filter(r => r.outOfSample.tradeCount > 0);

        if (candidates.length === 0) {
          return errorResult('tune', 'NO_VIABLE_CONFIGS',
            `No viable V2 configurations found for ${ticker} / ${strategy}`);
        }

        // Rank by OOS Sharpe ratio descending
        candidates.sort((a, b) => b.outOfSample.sharpeRatio - a.outOfSample.sharpeRatio);
        const topCount = Math.max(1, Math.ceil(candidates.length * 0.2));
        const topConfigs = candidates.slice(0, topCount);

        // Compute best region
        const bestRegion: Record<string, { min: number; max: number }> = {};
        const paramNames = Object.keys(topConfigs[0].params);
        for (const name of paramNames) {
          const values = topConfigs.map(c => c.params[name]);
          bestRegion[name] = { min: Math.min(...values), max: Math.max(...values) };
        }

        // Summary metrics (mean of top configs)
        const n = topConfigs.length;
        const summaryMetrics = {
          totalReturnPercent: topConfigs.reduce((s, c) => s + c.outOfSample.totalReturnPercent, 0) / n,
          sharpeRatio: topConfigs.reduce((s, c) => s + c.outOfSample.sharpeRatio, 0) / n,
          maxDrawdownPercent: topConfigs.reduce((s, c) => s + c.outOfSample.maxDrawdownPercent, 0) / n,
          winRate: topConfigs.reduce((s, c) => s + c.outOfSample.winRate, 0) / n,
          tradeCount: topConfigs.reduce((s, c) => s + c.outOfSample.tradeCount, 0) / n,
          profitFactor: topConfigs.reduce((s, c) => s + c.outOfSample.profitFactor, 0) / n,
        };

        const riskProfile = (opts['risk'] as RiskProfile) ?? 'low';
        const profile = `${horizon}_${riskProfile}`;

        return successResult('tune', {
          ticker,
          strategy,
          profile,
          best_region: bestRegion,
          summary_metrics: summaryMetrics,
          configurations_evaluated: grid.length,
          configurations_passed_filter: candidates.length,
          computed_at: new Date().toISOString(),
          v2: true,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult('tune', 'TUNING_ERROR', message);
      }
    }

    // V1 tuning path (unchanged)
    const input: TuningInput = {
      ticker,
      strategy,
      time_horizon: opts['horizon'] as TimeHorizon | undefined,
      risk_profile: opts['risk'] as RiskProfile | undefined,
      noCache: opts['no-cache'] !== undefined,
    };

    const tuningEngine = new TuningEngine(cachingProvider, dataDir);
    const outcome = await tuningEngine.run(input);

    if (!outcome.success) {
      return errorResult('tune', outcome.error.code, outcome.error.message);
    }

    return successResult('tune', outcome.data);
  });

  // --- tune-and-chart ---
  router.register('tune-and-chart', ['ticker', 'strategy'], async (opts) => {
    const ticker = opts['ticker'].toUpperCase();
    const strategy = opts['strategy'] as TunableStrategy;
    const horizon = (opts['horizon'] as TimeHorizon) ?? 'long_term';
    const noCache = opts['no-cache'] !== undefined;
    const isV3 = opts['v3'] !== undefined;
    const isV2 = opts['v2'] !== undefined;

    if (isV3) {
      // V3 tune-and-chart path: tune both strategies, backtest both, generate combined chart
      const period = '5y';
      const forceTune = opts['force'] !== undefined;

      // Validate --cap-tier flag
      const tierResult = parseCapTier(opts['cap-tier']);
      if (typeof tierResult === 'object' && 'error' in tierResult) {
        return errorResult('tune-and-chart', 'INVALID_PARAM_RANGE', tierResult.error);
      }
      const tier: CapTier = tierResult;

      try {
        // Step 1: Fetch data
        let dataResult;
        dataResult = await cachingProvider.getHistoricalData(ticker, period);

        if (!dataResult.success) {
          return errorResult('tune-and-chart', 'DATA_PROVIDER_ERROR', dataResult.error);
        }

        const dataPoints = dataResult.data.dataPoints;

        // Step 2: Check for fresh profiles — skip tuning if both exist and are valid
        let cbBestParams: Record<string, number> = {};
        let tpBestParams: Record<string, number> = {};
        let bbBestParams: Record<string, number> = {};
        let kmrBestParams: Record<string, number> = {};
        let vduBestParams: Record<string, number> = {};
        let cbTuneResult: V3TuneResult['consolidation_breakout'] = { error: 'skipped' };
        let tpTuneResult: V3TuneResult['trend_pullback'] = { error: 'skipped' };
        let bbTuneResult: V3TuneResult['bear_breakdown'] = { error: 'skipped' };
        let kmrTuneResult: V3TuneResult['keltner_mean_reversion'] = { error: 'skipped' };
        let vduTuneResult: V3TuneResult['volume_dry_up'] = { error: 'skipped' };
        let tuningSkipped = false;

        if (!forceTune) {
          const cbProfile = loadStrategyProfile(ticker, 'consolidation_breakout', { baseDir: dataDir });
          const tpProfile = loadStrategyProfile(ticker, 'trend_pullback', { baseDir: dataDir });
          const bbProfile = loadStrategyProfile(ticker, 'bear_breakdown', { baseDir: dataDir });
          const kmrProfile = loadStrategyProfile(ticker, 'keltner_mean_reversion', { baseDir: dataDir });
          const vduProfile = loadStrategyProfile(ticker, 'volume_dry_up', { baseDir: dataDir });

          if (cbProfile.success && tpProfile.success) {
            // Both core profiles are fresh — skip tuning
            cbBestParams = cbProfile.data.params;
            tpBestParams = tpProfile.data.params;
            if (bbProfile.success) {
              bbBestParams = bbProfile.data.params;
            }
            if (kmrProfile.success) {
              kmrBestParams = kmrProfile.data.params;
            }
            if (vduProfile.success) {
              vduBestParams = vduProfile.data.params;
            }
            tuningSkipped = true;
          }
        }

        if (!tuningSkipped) {
          // Run full tuning
          const v3TuneResult = tuneV3(dataPoints, tier);

          cbTuneResult = v3TuneResult.consolidation_breakout;
          tpTuneResult = v3TuneResult.trend_pullback;
          bbTuneResult = v3TuneResult.bear_breakdown;
          kmrTuneResult = v3TuneResult.keltner_mean_reversion;
          vduTuneResult = v3TuneResult.volume_dry_up;

          cbBestParams = !('error' in cbTuneResult) ? cbTuneResult.bestParams : {};
          tpBestParams = !('error' in tpTuneResult) ? tpTuneResult.bestParams : {};
          bbBestParams = !('error' in bbTuneResult) ? bbTuneResult.bestParams : {};
          kmrBestParams = !('error' in kmrTuneResult) ? kmrTuneResult.bestParams : {};
          vduBestParams = !('error' in vduTuneResult) ? vduTuneResult.bestParams : {};
        }

        // Step 3: Backtest both strategies with their best params
        const v3BacktestResult: V3BacktestResult = backtestV3(dataPoints, cbBestParams, tpBestParams, kmrBestParams, bbBestParams, vduBestParams);
        v3BacktestResult.consolidation_breakout.ticker = ticker;
        v3BacktestResult.trend_pullback.ticker = ticker;
        if (v3BacktestResult.keltner_mean_reversion) {
          v3BacktestResult.keltner_mean_reversion.ticker = ticker;
        }
        if (v3BacktestResult.bear_breakdown) {
          v3BacktestResult.bear_breakdown.ticker = ticker;
        }
        if (v3BacktestResult.volume_dry_up) {
          v3BacktestResult.volume_dry_up.ticker = ticker;
        }

        // Step 4: Build tuning summary data
        const riskProfile = (opts['risk'] as RiskProfile) ?? 'low';
        const profile = `${horizon}_${riskProfile}`;

        const tuningData = {
          ticker,
          strategy,
          profile,
          tuning_skipped: tuningSkipped,
          consolidation_breakout: tuningSkipped ? 'used_cached_profile' : cbTuneResult,
          trend_pullback: tuningSkipped ? 'used_cached_profile' : tpTuneResult,
          bear_breakdown: tuningSkipped ? 'used_cached_profile' : bbTuneResult,
          keltner_mean_reversion: tuningSkipped ? 'used_cached_profile' : kmrTuneResult,
          volume_dry_up: tuningSkipped ? 'used_cached_profile' : vduTuneResult,
          computed_at: new Date().toISOString(),
          v3: true,
        };

        // Step 5: Generate combined chart
        const chartFilePath = getChartFilePath(dataDir, ticker);
        const html = generateCombinedChartHtml({
          cbResult: v3BacktestResult.consolidation_breakout,
          tpResult: v3BacktestResult.trend_pullback,
          kmrResult: v3BacktestResult.keltner_mean_reversion,
          bbResult: v3BacktestResult.bear_breakdown,
          dataPoints,
          combinedMetrics: v3BacktestResult.combined,
        });
        writeFileSync(chartFilePath, html, 'utf-8');

        // Step 6: Save profiles if --save is specified and tuning was actually performed
        let profileSaved = false;
        if (opts['save'] !== undefined && !tuningSkipped) {
          const lastTunedAt = new Date().toISOString();
          const validUntil = computeExpiry(lastTunedAt);

          if (Object.keys(cbBestParams).length > 0) {
            const cbOos = !('error' in cbTuneResult) ? cbTuneResult.oosMetrics : null;
            const cbProfile: StrategyProfile = {
              ticker,
              strategy: 'consolidation_breakout',
              params: cbBestParams,
              walk_forward_metrics: {
                return: cbOos ? cbOos.totalReturnPercent : 0,
                benchmark: 0,
                win_rate: cbOos ? cbOos.winRate : 0,
                trades: cbOos ? cbOos.tradeCount : 0,
                max_drawdown: cbOos ? cbOos.maxDrawdownPercent : 0,
                sharpe: cbOos ? cbOos.sharpeRatio : 0,
              },
              last_tuned_at: lastTunedAt,
              valid_until: validUntil,
              ...(tier !== 'large_cap' ? { cap_tier: tier } : {}),
            };
            saveStrategyProfile(cbProfile, dataDir);
          }

          if (Object.keys(tpBestParams).length > 0) {
            const tpOos = !('error' in tpTuneResult) ? tpTuneResult.oosMetrics : null;
            const tpProfile: StrategyProfile = {
              ticker,
              strategy: 'trend_pullback',
              params: tpBestParams,
              walk_forward_metrics: {
                return: tpOos ? tpOos.totalReturnPercent : 0,
                benchmark: 0,
                win_rate: tpOos ? tpOos.winRate : 0,
                trades: tpOos ? tpOos.tradeCount : 0,
                max_drawdown: tpOos ? tpOos.maxDrawdownPercent : 0,
                sharpe: tpOos ? tpOos.sharpeRatio : 0,
              },
              last_tuned_at: lastTunedAt,
              valid_until: validUntil,
              ...(tier !== 'large_cap' ? { cap_tier: tier } : {}),
            };
            saveStrategyProfile(tpProfile, dataDir);
          }

          if (Object.keys(bbBestParams).length > 0) {
            const bbOos = !('error' in bbTuneResult) ? bbTuneResult.oosMetrics : null;
            const bbProfile: StrategyProfile = {
              ticker,
              strategy: 'bear_breakdown',
              params: bbBestParams,
              walk_forward_metrics: {
                return: bbOos ? bbOos.totalReturnPercent : 0,
                benchmark: 0,
                win_rate: bbOos ? bbOos.winRate : 0,
                trades: bbOos ? bbOos.tradeCount : 0,
                max_drawdown: bbOos ? bbOos.maxDrawdownPercent : 0,
                sharpe: bbOos ? bbOos.sharpeRatio : 0,
              },
              last_tuned_at: lastTunedAt,
              valid_until: validUntil,
              ...(tier !== 'large_cap' ? { cap_tier: tier } : {}),
            };
            saveStrategyProfile(bbProfile, dataDir);
          }

          if (Object.keys(kmrBestParams).length > 0) {
            const kmrOos = !('error' in kmrTuneResult) ? kmrTuneResult.oosMetrics : null;
            const kmrProfile: StrategyProfile = {
              ticker,
              strategy: 'keltner_mean_reversion',
              params: kmrBestParams,
              walk_forward_metrics: {
                return: kmrOos ? kmrOos.totalReturnPercent : 0,
                benchmark: 0,
                win_rate: kmrOos ? kmrOos.winRate : 0,
                trades: kmrOos ? kmrOos.tradeCount : 0,
                max_drawdown: kmrOos ? kmrOos.maxDrawdownPercent : 0,
                sharpe: kmrOos ? kmrOos.sharpeRatio : 0,
              },
              last_tuned_at: lastTunedAt,
              valid_until: validUntil,
              ...(tier !== 'large_cap' ? { cap_tier: tier } : {}),
            };
            saveStrategyProfile(kmrProfile, dataDir);
          }

          if (Object.keys(vduBestParams).length > 0) {
            const vduOos = !('error' in vduTuneResult) ? vduTuneResult.oosMetrics : null;
            const vduProfile: StrategyProfile = {
              ticker,
              strategy: 'volume_dry_up',
              params: vduBestParams,
              walk_forward_metrics: {
                return: vduOos ? vduOos.totalReturnPercent : 0,
                benchmark: 0,
                win_rate: vduOos ? vduOos.winRate : 0,
                trades: vduOos ? vduOos.tradeCount : 0,
                max_drawdown: vduOos ? vduOos.maxDrawdownPercent : 0,
                sharpe: vduOos ? vduOos.sharpeRatio : 0,
              },
              last_tuned_at: lastTunedAt,
              valid_until: validUntil,
              ...(tier !== 'large_cap' ? { cap_tier: tier } : {}),
            };
            saveStrategyProfile(vduProfile, dataDir);
          }

          profileSaved = true;
        }

        return successResult('tune-and-chart', {
          tuning: tuningData,
          best_params: {
            consolidation_breakout: cbBestParams,
            trend_pullback: tpBestParams,
            bear_breakdown: bbBestParams,
            keltner_mean_reversion: kmrBestParams,
            volume_dry_up: vduBestParams,
          },
          profile_saved: profileSaved,
          backtest: {
            ...v3BacktestResult,
            chartFilePath,
            chartUrl: `file://${nodePath.resolve(chartFilePath)}`,
          },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult('tune-and-chart', 'BACKTEST_ERROR', message);
      }
    }

    if (isV2) {
      // V2 tune-and-chart path
      const period = horizon === 'short_term' ? '2y' : '5y';

      try {
        // Step 1: Run V2 tuning inline (same logic as tune --v2)
        let dataResult;
        dataResult = await cachingProvider.getHistoricalData(ticker, period);

        if (!dataResult.success) {
          return errorResult('tune-and-chart', 'DATA_PROVIDER_ERROR', dataResult.error);
        }

        const dataPoints = dataResult.data.dataPoints;
        if (dataPoints.length < 100) {
          return errorResult('tune-and-chart', 'INSUFFICIENT_DATA',
            `Insufficient data: need at least 100 data points, got ${dataPoints.length}`);
        }

        const grid = generateV2Grid(horizon);
        const v2Results: Array<{
          params: Record<string, number>;
          outOfSample: { totalReturnPercent: number; sharpeRatio: number; maxDrawdownPercent: number; winRate: number; tradeCount: number; profitFactor: number };
        }> = [];

        for (const entry of grid) {
          const v2Params: PhasedStrategyParams = { config: entry.config };

          const btEngine = new PhasedStrategyEngine(strategy);
          btEngine.reset();
          const bt = new BacktestEngine();
          const result = bt.runV2(dataPoints, btEngine, v2Params, period);
          const trades = result.performanceSummary.trades;
          let profitFactor = 0;
          if (trades.length > 0) {
            let grossProfits = 0, grossLosses = 0;
            for (const t of trades) {
              if (t.profitLossPercent > 0) grossProfits += t.profitLossPercent;
              else if (t.profitLossPercent < 0) grossLosses += Math.abs(t.profitLossPercent);
            }
            profitFactor = grossLosses === 0 ? Infinity : grossProfits / grossLosses;
          }

          v2Results.push({
            params: entry.params,
            outOfSample: {
              totalReturnPercent: result.performanceSummary.totalReturnPercent,
              sharpeRatio: result.performanceSummary.sharpeRatio,
              maxDrawdownPercent: result.performanceSummary.maxDrawdownPercent,
              winRate: result.performanceSummary.winRate,
              tradeCount: result.performanceSummary.numberOfTrades,
              profitFactor,
            },
          });
        }

        const filtered = v2Results.filter(r =>
          r.outOfSample.maxDrawdownPercent <= 25 &&
          r.outOfSample.profitFactor >= 1.0 &&
          r.outOfSample.totalReturnPercent > 0
        );

        // Fallback: if strict filter yields nothing, relax to any config with trades
        const candidates = filtered.length > 0
          ? filtered
          : v2Results.filter(r => r.outOfSample.tradeCount > 0);

        if (candidates.length === 0) {
          return errorResult('tune-and-chart', 'NO_VIABLE_CONFIGS',
            `No viable V2 configurations found for ${ticker} / ${strategy}`);
        }

        candidates.sort((a, b) => b.outOfSample.sharpeRatio - a.outOfSample.sharpeRatio);
        const topCount = Math.max(1, Math.ceil(candidates.length * 0.2));
        const topConfigs = candidates.slice(0, topCount);

        // Compute best region
        const bestRegion: Record<string, { min: number; max: number }> = {};
        const paramNames = Object.keys(topConfigs[0].params);
        for (const name of paramNames) {
          const values = topConfigs.map(c => c.params[name]);
          bestRegion[name] = { min: Math.min(...values), max: Math.max(...values) };
        }

        const riskProfile = (opts['risk'] as RiskProfile) ?? 'low';
        const profile = `${horizon}_${riskProfile}`;
        const n = topConfigs.length;
        const summaryMetrics = {
          totalReturnPercent: topConfigs.reduce((s, c) => s + c.outOfSample.totalReturnPercent, 0) / n,
          sharpeRatio: topConfigs.reduce((s, c) => s + c.outOfSample.sharpeRatio, 0) / n,
          maxDrawdownPercent: topConfigs.reduce((s, c) => s + c.outOfSample.maxDrawdownPercent, 0) / n,
          winRate: topConfigs.reduce((s, c) => s + c.outOfSample.winRate, 0) / n,
          tradeCount: topConfigs.reduce((s, c) => s + c.outOfSample.tradeCount, 0) / n,
          profitFactor: topConfigs.reduce((s, c) => s + c.outOfSample.profitFactor, 0) / n,
        };

        const tuningData = {
          ticker,
          strategy,
          profile,
          best_region: bestRegion,
          summary_metrics: summaryMetrics,
          configurations_evaluated: grid.length,
          configurations_passed_filter: candidates.length,
          computed_at: new Date().toISOString(),
          v2: true,
        };

        // Step 2: Compute midpoint params from best_region
        const midpointParams: Record<string, number> = {};
        for (const [key, range] of Object.entries(bestRegion)) {
          midpointParams[key] = (range.min + range.max) / 2;
        }

        // Step 3: Build V2 config from midpoint params
        const minHoldDays = horizon === 'short_term' ? 7 : 30;
        const v2Config = buildV2Config(midpointParams, minHoldDays);
        const v2Params: PhasedStrategyParams = { config: v2Config, primaryDataPoints: dataPoints };

        // Step 4: Run backtest with V2 config on full data
        const v2Engine = new PhasedStrategyEngine(strategy);
        v2Engine.reset();
        const btEngine = new BacktestEngine();
        const backtestResult = btEngine.runV2(dataPoints, v2Engine, v2Params, period);

        // Step 5: Generate chart
        const chartFilePath = getChartFilePath(dataDir, ticker);
        const html = generateChartHtml({
          backtestResult,
          dataPoints,
          strategyParams: v2Params,
        });
        writeFileSync(chartFilePath, html, 'utf-8');

        return successResult('tune-and-chart', {
          tuning: tuningData,
          midpoint_params: midpointParams,
          backtest: { ...backtestResult, chartFilePath, chartUrl: `file://${nodePath.resolve(chartFilePath)}` },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult('tune-and-chart', 'BACKTEST_ERROR', message);
      }
    }

    // V1 tune-and-chart path (unchanged)
    // Step 1: Run tuning
    const tuningInput: TuningInput = {
      ticker,
      strategy,
      time_horizon: horizon,
      risk_profile: opts['risk'] as RiskProfile | undefined,
      noCache,
    };

    const tuningEngine = new TuningEngine(cachingProvider, dataDir);
    const outcome = await tuningEngine.run(tuningInput);

    if (!outcome.success) {
      return errorResult('tune-and-chart', outcome.error.code, outcome.error.message);
    }

    // Step 2: Compute midpoint params from best_region
    const bestRegion = outcome.data.best_region;
    const midpointParams: Record<string, number> = {};
    for (const [key, range] of Object.entries(bestRegion)) {
      midpointParams[key] = (range.min + range.max) / 2;
    }

    // Step 3: Build StrategyConfiguration from midpoint params
    const config = buildConfig(strategy, midpointParams);
    const compositeParams: CompositeStrategyParams = { config };

    // Step 4: Fetch historical data for backtest
    const period = horizon === 'short_term' ? '2y' : '5y';
    try {
      const histResult = await priceFeedClient.fetchHistoricalData(ticker, period);
      if (!histResult.success) {
        return errorResult('tune-and-chart', 'DATA_PROVIDER_ERROR', histResult.error);
      }

      const pricePoints = convertHistoricalData(histResult.data.dataPoints, ticker);

      // Inject primary data and auxiliary data
      compositeParams.primaryDataPoints = histResult.data.dataPoints;
      const indexTicker = config.indexTicker;
      if (indexTicker) {
        try {
          const auxResult = await priceFeedClient.fetchHistoricalData(indexTicker, period);
          if (auxResult.success) {
            compositeParams.auxiliaryData = { [indexTicker]: auxResult.data.dataPoints };
          }
        } catch {
          // Non-fatal
        }
      }

      // Step 5: Run backtest
      const strategyInstance = new CompositeStrategyEngine(strategy);
      const engine = new BacktestEngine();
      const backtestResult = engine.run(pricePoints, strategyInstance, compositeParams, period);

      // Step 6: Generate chart
      const chartFilePath = getChartFilePath(dataDir, ticker);
      const html = generateChartHtml({
        backtestResult,
        dataPoints: histResult.data.dataPoints,
        strategyParams: compositeParams,
      });
      writeFileSync(chartFilePath, html, 'utf-8');

      // Step 7: Return combined result
      return successResult('tune-and-chart', {
        tuning: outcome.data,
        midpoint_params: midpointParams,
        backtest: { ...backtestResult, chartFilePath, chartUrl: `file://${nodePath.resolve(chartFilePath)}` },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult('tune-and-chart', 'BACKTEST_ERROR', message);
    }
  });

  // --- Strategy Registry: instantiate and register strategies ---
  const strategyRegistry = new StrategyRegistry();
  strategyRegistry.register(new ConsolidationBreakoutStrategy());
  strategyRegistry.register(new BearBreakdownStrategy());
  strategyRegistry.register(new PostEarningsDriftStrategy(dataDir));
  strategyRegistry.register(new KeltnerMeanReversionStrategy());
  strategyRegistry.register(new VduEngine());

  // --- New pipeline commands: tune, scan, chart ---
  const tuneHandler = createTuneHandler({ cachingProvider, registry: strategyRegistry, dataDir });

  // Instantiate RegimeDetector for scan --regime support
  const regimeDetector = new RegimeDetector({
    cachingProvider,
    cacheDir: dataDir,
  });

  const scanHandler = createScanHandler({ cachingProvider, dataDir, regimeDetector });
  const chartHandler = createChartHandler({ cachingProvider, registry: strategyRegistry, dataDir });
  const scanChartHandler = createScanChartHandler({ cachingProvider, dataDir });

  // --- regime command ---
  const regimeHandler = createRegimeHandler({ cachingProvider, dataDir });
  router.register('regime', [], regimeHandler);

  router.register('tune-pipeline', ['tickers', 'strategy'], async (opts) => {
    // Parse and validate --concurrency flag
    const concurrency = parseConcurrency(opts);
    const tickersArg = opts['tickers'];
    const shouldSave = opts['save'] !== undefined;
    const noCache = opts['no-cache'] !== undefined;

    // Validate --cap-tier flag
    const tierResult = parseCapTier(opts['cap-tier']);
    if (typeof tierResult === 'object' && 'error' in tierResult) {
      return errorResult('tune-pipeline', 'INVALID_PARAM_RANGE', tierResult.error);
    }
    const tier: CapTier = tierResult;

    // Resolve ticker list to determine if we should use parallel execution
    const tickers = resolveV3TickerList(tickersArg, dataDir);
    if ('error' in tickers) {
      return errorResult('tune-pipeline', 'CONFIG_ERROR', tickers.error);
    }

    if (tickers.length === 0) {
      return errorResult('tune-pipeline', 'MISSING_PARAM', 'No tickers specified');
    }

    // Multi-ticker path: use parallelTune for parallel execution
    if (tickers.length > 1) {
      const batchResult = await parallelTune({
        tickers,
        concurrency,
        shouldSave,
        noCache,
        runBacktest: false,
        cachingProvider,
        dataDir,
        tier,
      });

      return successResult('tune-pipeline', batchResult);
    }

    // Single ticker path: fall through to sequential handler
    opts['_concurrency'] = String(concurrency);
    return tuneHandler(opts);
  });
  router.register('scan', ['tickers', 'strategy'], async (opts) => {
    // Parse and validate --concurrency flag
    const concurrency = parseConcurrency(opts);
    opts['_concurrency'] = String(concurrency);
    return scanHandler(opts);
  });
  router.register('chart', ['ticker', 'strategy'], chartHandler);
  router.register('scan-chart', ['ticker', 'strategy'], scanChartHandler);

  // --- v3: shorthand for tune-and-chart --v3 --save (only requires --ticker) ---
  // Supports: single ticker, comma-separated tickers, or --ticker top100
  // Multi-ticker → parallelTune(); single ticker → existing tune-and-chart handler
  router.register('v3', ['ticker'], async (opts) => {
    // Parse --concurrency flag
    const concurrency = parseConcurrency(opts);
    const tickerArg = opts['ticker'];

    // Validate --cap-tier flag
    const tierResult = parseCapTier(opts['cap-tier']);
    if (typeof tierResult === 'object' && 'error' in tierResult) {
      return errorResult('v3', 'INVALID_PARAM_RANGE', tierResult.error);
    }
    const tier: CapTier = tierResult;

    // Resolve ticker list: 'top100' loads from data/top100.json, comma-separated splits
    const tickers = resolveV3TickerList(tickerArg, dataDir);
    if ('error' in tickers) {
      return errorResult('v3', 'CONFIG_ERROR', tickers.error);
    }

    if (tickers.length === 0) {
      return errorResult('v3', 'MISSING_PARAM', 'No tickers specified');
    }

    // Multi-ticker path: use parallelTune
    if (tickers.length > 1) {
      const batchResult = await parallelTune({
        tickers,
        concurrency,
        shouldSave: true,
        noCache: opts['no-cache'] !== undefined,
        runBacktest: true,
        cachingProvider,
        dataDir,
        tier,
      });

      return successResult('v3', batchResult);
    }

    // Single ticker path: run on main thread via existing tune-and-chart handler
    opts['ticker'] = tickers[0];
    opts['strategy'] = 'v3';
    opts['v3'] = '';
    opts['save'] = '';
    opts['concurrency'] = String(concurrency);
    const tuneAndChartDef = router.getHandler('tune-and-chart');
    if (!tuneAndChartDef) {
      return errorResult('v3', 'INTERNAL_ERROR', 'tune-and-chart handler not found');
    }
    return tuneAndChartDef(opts);
  });

  // --- Journal commands: status, record, update ---
  const journalStatusHandler = createJournalStatusHandler({ dataDir, cachingProvider });
  const journalRecordHandler = createJournalRecordHandler({ dataDir, cachingProvider });
  const journalUpdateHandler = createJournalUpdateHandler({ dataDir, cachingProvider });

  router.register('journal-status', [], journalStatusHandler);
  router.register('journal-record', [], journalRecordHandler);
  router.register('journal-update', [], journalUpdateHandler);

  // --- Signal history command ---
  const signalHistoryHandler = createSignalHistoryHandler({ dataDir });
  router.register('signal-history', [], signalHistoryHandler);

  return {
    router,
    config,
    priceDataStore,
    priceFeedClient,
    watchlistManager,
    strategyManager,
    processManager,
    registry,
    cachingProvider,
    strategyRegistry,
  };
}

// ============================================================
// V3 Ticker List Resolution
// ============================================================

/**
 * Resolve the --ticker argument for the v3 command.
 * Supports: single ticker, comma-separated list, or 'watchlist' keyword.
 */
function resolveV3TickerList(tickerArg: string, dataDir: string): string[] | { error: string } {
  if (tickerArg.toLowerCase() === 'watchlist' || tickerArg.toLowerCase() === 'top100') {
    try {
      // Look for watchlist.json in the data/ directory relative to CWD (project root)
      // Fallback: also check relative to dataDir
      let watchlistPath = path.join(process.cwd(), 'data', 'watchlist.json');
      try {
        readFileSync(watchlistPath, 'utf-8');
      } catch {
        // Fallback to dataDir-relative path (for compatibility with tune-command)
        watchlistPath = path.join(dataDir, 'data', 'watchlist.json');
      }
      const content = readFileSync(watchlistPath, 'utf-8');
      const parsed = JSON.parse(content) as { tickers?: string[] };
      if (!Array.isArray(parsed.tickers) || parsed.tickers.length === 0) {
        return { error: `watchlist.json at ${watchlistPath} is missing or has empty 'tickers' array` };
      }
      return parsed.tickers.map((t: string) => t.toUpperCase());
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { error: `Failed to load watchlist.json: ${message}` };
    }
  }

  // Comma-separated or single ticker
  const tickers = tickerArg.split(',').map(t => t.trim().toUpperCase()).filter(t => t.length > 0);
  return tickers;
}

function getStrategyInstance(strategyType: StrategyType) {
  switch (strategyType) {
    case 'moving_average_crossover':
      return new MovingAverageCrossoverStrategy();
    case 'rsi_threshold':
      return new RSIThresholdStrategy();
    case 'price_breakout':
      return new PriceBreakoutStrategy();
    case 'momentum_continuation':
    case 'trend_pullback':
    case 'breakout_volume':
      return new CompositeStrategyEngine(strategyType);
    case 'consolidation_breakout':
    case 'bear_breakdown':
    case 'post_earnings_drift':
      // V3 engines are instantiated in the backtest handler's V3 path
      return undefined;
  }
}

function getDefaultParams(strategyType: StrategyType): StrategyParams {
  switch (strategyType) {
    case 'moving_average_crossover':
      return { shortWindow: 10, longWindow: 50 };
    case 'rsi_threshold':
      return { period: 14, overbought: 70, oversold: 30 };
    case 'price_breakout':
      return { upperLevel: 100, lowerLevel: 50 };
    case 'momentum_continuation':
    case 'trend_pullback':
    case 'breakout_volume':
      return { config: getDefaultCompositeConfig(strategyType) } as CompositeStrategyParams;
    case 'consolidation_breakout':
      // Default params for V3 will be added in task 9.1
      return { config: {} } as StrategyParams;
    case 'bear_breakdown':
      return { config: {} } as StrategyParams;
    case 'post_earnings_drift':
      return { config: DEFAULT_PEAD_CONFIG, earningsDates: [] } as StrategyParams;
    case 'keltner_mean_reversion':
      return { config: DEFAULT_KMR_CONFIG } as StrategyParams;
    case 'volume_dry_up':
      return { config: {} } as StrategyParams;
  }
}
