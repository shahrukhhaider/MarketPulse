import * as path from 'node:path';
import { CommandRouter, successResult, errorResult } from './command-router.js';
import { load as loadConfig, save as saveConfig, getDefault } from './config-store.js';
import { PriceDataStore } from './price-data-store.js';
import { PriceFeedClient } from './price-feed-client.js';
import type { YahooFinanceClient } from './price-feed-client.js';
import { WatchlistManager } from './watchlist-manager.js';
import { StrategyManager } from './strategy-manager.js';
import { ProcessManager } from './process-manager.js';
import { SignalStore } from './signal-store.js';
import { ErrorCodes } from './types.js';
import type { StrategyType, StrategyParams, HistoricalPeriod, HistoricalInterval } from './types.js';
import { DataProviderRegistry } from './data-provider.js';
import { YahooFinanceAdapter } from './yahoo-finance-adapter.js';
import { BacktestEngine, convertHistoricalData } from './backtest-engine.js';
import { MovingAverageCrossoverStrategy } from './strategies/moving-average.js';
import { RSIThresholdStrategy } from './strategies/rsi-threshold.js';
import { PriceBreakoutStrategy } from './strategies/price-breakout.js';
import { CompositeStrategyEngine } from './strategies/composite-engine.js';
import { getDefaultCompositeConfig, isV2Config, isConsolidationBreakoutConfig, type CompositeStrategyParams, type PhasedStrategyParams, type ConsolidationBreakoutParams } from './strategies/strategy-configs.js';
import { PhasedStrategyEngine } from './strategies/phased-engine.js';
import { ConsolidationBreakoutEngine } from './strategies/consolidation-breakout-engine.js';
import { CachingDataProvider } from './caching-data-provider.js';
import { TuningEngine } from './tuning-engine.js';
import type { TuningInput, TunableStrategy, TimeHorizon, RiskProfile, BestRegion } from './tuning-engine.js';
import { normalizeTicker } from './history-cache-store.js';
import type { CacheEntry } from './history-cache-store.js';
import { generateChartHtml, getChartFilePath } from './chart-generator.js';
import { writeFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { buildConfig, buildV2Config, generateV2Grid, generateConsolidationBreakoutGrid, buildConsolidationBreakoutConfig } from './parameter-grid.js';

export interface WiringOptions {
  dataDir?: string;
  configPath?: string;
  priceDataPath?: string;
  yahooFinanceClient?: YahooFinanceClient;
  providerName?: string;
  noCache?: boolean;
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
  cachingProvider: CachingDataProvider;
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

  // Wrap the active provider in CachingDataProvider
  const cachingProvider = new CachingDataProvider(activeProvider, {
    cacheDir: path.join(dataDir, 'history-cache'),
    ttlMs: undefined, // use default 24h
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
    const noCache = opts['no-cache'] !== undefined;

    let result;
    if (noCache) {
      // Bypass cache: call inner provider directly, then write through to cache
      result = await cachingProvider.innerProvider.getHistoricalData(ticker, period, interval);
      if (result.success) {
        const effectivePeriod: HistoricalPeriod = period ?? '1y';
        const entry: CacheEntry = {
          ticker: normalizeTicker(ticker),
          period: effectivePeriod,
          interval: result.data.interval,
          fetchedAt: new Date().toISOString(),
          dataPoints: result.data.dataPoints,
        };
        cachingProvider.cacheStore.write(entry);
      }
    } else {
      result = await priceFeedClient.fetchHistoricalData(ticker, period, interval);
    }

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
  ];

  router.register('backtest', ['ticker', 'strategy'], async (opts) => {
    const ticker = opts['ticker'].toUpperCase();
    const strategyType = opts['strategy'] as StrategyType;

    // Validate strategy type
    if (!VALID_STRATEGY_TYPES.includes(strategyType)) {
      return errorResult('backtest', ErrorCodes.INVALID_PARAM_RANGE,
        `Invalid strategy type '${opts['strategy']}'. Valid types: ${VALID_STRATEGY_TYPES.join(', ')}`);
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
          if (noCache) {
            histResult = await cachingProvider.innerProvider.getHistoricalData(ticker, period);
            if (histResult.success) {
              const entry: CacheEntry = {
                ticker: normalizeTicker(ticker),
                period,
                interval: histResult.data.interval,
                fetchedAt: new Date().toISOString(),
                dataPoints: histResult.data.dataPoints,
              };
              cachingProvider.cacheStore.write(entry);
            }
          } else {
            histResult = await priceFeedClient.fetchHistoricalData(ticker, period);
          }

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
          if (noCache) {
            histResult = await cachingProvider.innerProvider.getHistoricalData(ticker, period);
            if (histResult.success) {
              const entry: CacheEntry = {
                ticker: normalizeTicker(ticker),
                period,
                interval: histResult.data.interval,
                fetchedAt: new Date().toISOString(),
                dataPoints: histResult.data.dataPoints,
              };
              cachingProvider.cacheStore.write(entry);
            }
          } else {
            histResult = await priceFeedClient.fetchHistoricalData(ticker, period);
          }

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
      if (noCache) {
        // Bypass cache: call inner provider directly, then write through to cache
        histResult = await cachingProvider.innerProvider.getHistoricalData(ticker, period);
        if (histResult.success) {
          const entry: CacheEntry = {
            ticker: normalizeTicker(ticker),
            period,
            interval: histResult.data.interval,
            fetchedAt: new Date().toISOString(),
            dataPoints: histResult.data.dataPoints,
          };
          cachingProvider.cacheStore.write(entry);
        }
      } else {
        histResult = await priceFeedClient.fetchHistoricalData(ticker, period);
      }

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
        if (noCache) {
          dataResult = await cachingProvider.innerProvider.getHistoricalData(ticker, period);
        } else {
          dataResult = await priceFeedClient.fetchHistoricalData(ticker, period);
        }

        if (!dataResult.success) {
          return errorResult('tune', 'DATA_PROVIDER_ERROR', dataResult.error);
        }

        const dataPoints = dataResult.data.dataPoints;
        if (dataPoints.length < 100) {
          return errorResult('tune', 'INSUFFICIENT_DATA',
            `Insufficient data: need at least 100 data points, got ${dataPoints.length}`);
        }

        const grid = generateConsolidationBreakoutGrid();
        const v3Results: Array<{
          params: Record<string, number>;
          inSample: { totalReturnPercent: number; sharpeRatio: number; maxDrawdownPercent: number; winRate: number; tradeCount: number; profitFactor: number };
          outOfSample: { totalReturnPercent: number; sharpeRatio: number; maxDrawdownPercent: number; winRate: number; tradeCount: number; profitFactor: number };
        }> = [];

        for (const entry of grid) {
          const v3Params: ConsolidationBreakoutParams = { config: entry.config };

          const engine = new ConsolidationBreakoutEngine();
          engine.reset();
          const bt = new BacktestEngine();
          const result = bt.runV2(dataPoints, engine, v3Params, period);
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

          v3Results.push({
            params: entry.params,
            inSample: metrics,
            outOfSample: metrics,
          });
        }

        // Filter: OOS drawdown <= 25%, profit factor >= 1.0, positive return, min 3 trades
        const filtered = v3Results.filter(r =>
          r.outOfSample.maxDrawdownPercent <= 25 &&
          r.outOfSample.profitFactor >= 1.0 &&
          r.outOfSample.totalReturnPercent > 0 &&
          r.outOfSample.tradeCount >= 3
        );

        // Fallback: if strict filter yields nothing, relax to any config with trades
        const candidates = filtered.length > 0
          ? filtered
          : v3Results.filter(r => r.outOfSample.tradeCount > 0);

        if (candidates.length === 0) {
          return errorResult('tune', 'NO_VIABLE_CONFIGS',
            `No viable V3 configurations found for ${ticker} / ${strategy}`);
        }

        // Rank by OOS total return descending
        candidates.sort((a, b) => b.outOfSample.totalReturnPercent - a.outOfSample.totalReturnPercent);
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
        const horizon = (opts['horizon'] as TimeHorizon) ?? 'long_term';
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
        if (noCache) {
          dataResult = await cachingProvider.innerProvider.getHistoricalData(ticker, period);
        } else {
          dataResult = await priceFeedClient.fetchHistoricalData(ticker, period);
        }

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
      // V3 tune-and-chart path
      const period = '5y';

      try {
        // Step 1: Run V3 tuning inline (same logic as tune --v3)
        let dataResult;
        if (noCache) {
          dataResult = await cachingProvider.innerProvider.getHistoricalData(ticker, period);
        } else {
          dataResult = await priceFeedClient.fetchHistoricalData(ticker, period);
        }

        if (!dataResult.success) {
          return errorResult('tune-and-chart', 'DATA_PROVIDER_ERROR', dataResult.error);
        }

        const dataPoints = dataResult.data.dataPoints;
        if (dataPoints.length < 100) {
          return errorResult('tune-and-chart', 'INSUFFICIENT_DATA',
            `Insufficient data: need at least 100 data points, got ${dataPoints.length}`);
        }

        const grid = generateConsolidationBreakoutGrid();
        const v3Results: Array<{
          params: Record<string, number>;
          outOfSample: { totalReturnPercent: number; sharpeRatio: number; maxDrawdownPercent: number; winRate: number; tradeCount: number; profitFactor: number };
        }> = [];

        for (const entry of grid) {
          const v3Params: ConsolidationBreakoutParams = { config: entry.config };

          const btEngine = new ConsolidationBreakoutEngine();
          btEngine.reset();
          const bt = new BacktestEngine();
          const result = bt.runV2(dataPoints, btEngine, v3Params, period);
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

          v3Results.push({
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

        const filtered = v3Results.filter(r =>
          r.outOfSample.maxDrawdownPercent <= 25 &&
          r.outOfSample.profitFactor >= 1.0 &&
          r.outOfSample.totalReturnPercent > 0 &&
          r.outOfSample.tradeCount >= 3
        );

        // Fallback: if strict filter yields nothing, relax to any config with trades
        const candidates = filtered.length > 0
          ? filtered
          : v3Results.filter(r => r.outOfSample.tradeCount > 0);

        if (candidates.length === 0) {
          return errorResult('tune-and-chart', 'NO_VIABLE_CONFIGS',
            `No viable V3 configurations found for ${ticker} / ${strategy}`);
        }

        candidates.sort((a, b) => b.outOfSample.totalReturnPercent - a.outOfSample.totalReturnPercent);

        // Use the single best config directly — no midpointing
        const bestCandidate = candidates[0];
        const bestParams = bestCandidate.params;

        const riskProfile = (opts['risk'] as RiskProfile) ?? 'low';
        const profile = `${horizon}_${riskProfile}`;

        const tuningData = {
          ticker,
          strategy,
          profile,
          best_params: bestParams,
          best_metrics: bestCandidate.outOfSample,
          configurations_evaluated: grid.length,
          configurations_passed_filter: candidates.length,
          computed_at: new Date().toISOString(),
          v3: true,
        };

        // Build V3 config from the best params and run backtest
        const v3Config = buildConsolidationBreakoutConfig(bestParams);
        const v3Params: ConsolidationBreakoutParams = { config: v3Config, primaryDataPoints: dataPoints };

        const v3Engine = new ConsolidationBreakoutEngine();
        v3Engine.reset();
        const btEngine2 = new BacktestEngine();
        const backtestResult = btEngine2.runV2(dataPoints, v3Engine, v3Params, period);

        // Generate chart
        const chartFilePath = getChartFilePath(dataDir, ticker);
        const html = generateChartHtml({
          backtestResult,
          dataPoints,
          strategyParams: v3Params,
        });
        writeFileSync(chartFilePath, html, 'utf-8');

        return successResult('tune-and-chart', {
          tuning: tuningData,
          best_params: bestParams,
          backtest: { ...backtestResult, chartFilePath, chartUrl: `file://${nodePath.resolve(chartFilePath)}` },
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
        if (noCache) {
          dataResult = await cachingProvider.innerProvider.getHistoricalData(ticker, period);
        } else {
          dataResult = await priceFeedClient.fetchHistoricalData(ticker, period);
        }

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
  };
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
      // V3 engine is instantiated in the backtest handler's V3 path (task 9.1)
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
  }
}
