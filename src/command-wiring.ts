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

export interface WiringOptions {
  dataDir?: string;
  configPath?: string;
  priceDataPath?: string;
  yahooFinanceClient?: YahooFinanceClient;
}

export interface WiredRouter {
  router: CommandRouter;
  config: ReturnType<typeof getDefault>;
  priceDataStore: PriceDataStore;
  priceFeedClient: PriceFeedClient;
  watchlistManager: WatchlistManager;
  strategyManager: StrategyManager;
  processManager: ProcessManager;
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

  // Create domain components
  const priceFeedClient = new PriceFeedClient(options.yahooFinanceClient);
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

    const result = await priceFeedClient.fetchHistoricalData(ticker, period, interval);

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

  return {
    router,
    config,
    priceDataStore,
    priceFeedClient,
    watchlistManager,
    strategyManager,
    processManager,
  };
}

function getDefaultParams(strategyType: StrategyType): StrategyParams {
  switch (strategyType) {
    case 'moving_average_crossover':
      return { shortWindow: 10, longWindow: 50 };
    case 'rsi_threshold':
      return { period: 14, overbought: 70, oversold: 30 };
    case 'price_breakout':
      return { upperLevel: 100, lowerLevel: 50 };
  }
}
