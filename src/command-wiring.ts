import { CommandRouter } from './command-router.js';
import { PriceDataStore } from './data/price-data-store.js';
import { PriceFeedClient } from './data/price-feed-client.js';
import type { YahooFinanceClient } from './data/price-feed-client.js';
import { WatchlistManager } from './utils/watchlist-manager.js';
import { StrategyManager } from './strategies/strategy-manager.js';
import { ProcessManager } from './monitoring/process-manager.js';
import { DataProviderRegistry } from './data/data-provider.js';
import { HistoricalDataCache } from './data/historical-data-cache.js';
import { StrategyRegistry } from './strategies/strategy-registry.js';
import { getDefault } from './data/config-store.js';

// Handler factory imports
import { createTuneSingleHandler } from './commands/tune-single-command.js';
import { createScanHandler } from './commands/scan-command.js';
import { createChartHandler } from './commands/chart-command.js';
import { createScanChartHandler } from './commands/scan-chart-command.js';
import { createJournalStatusHandler, createJournalRecordHandler, createJournalUpdateHandler } from './commands/journal-command.js';
import { createRegimeHandler } from './commands/regime-command.js';
import { createSignalHistoryHandler } from './signal-history/signal-history-command.js';
import { createSentimentCheckHandler } from './commands/sentiment-check-command.js';
import { createNewsTimelineHandler } from './commands/news-timeline-command.js';
import { createAddStockHandler } from './commands/add-stock-command.js';
import { createRemoveStockHandler } from './commands/remove-stock-command.js';
import { createListWatchlistHandler } from './commands/list-watchlist-command.js';
import { createStartMonitorHandler } from './commands/start-monitor-command.js';
import { createStopMonitorHandler } from './commands/stop-monitor-command.js';
import { createGetStatusHandler } from './commands/get-status-command.js';
import { createConfigureStrategyHandler } from './commands/configure-strategy-command.js';
import { createShowSignalsHandler } from './commands/show-signals-command.js';
import { createHistoryHandler } from './commands/history-command.js';
import { createClearCacheHandler } from './commands/clear-cache-command.js';
import { createBacktestHandler } from './commands/backtest-command.js';
import { createTuneAndChartHandler } from './commands/tune-and-chart-command.js';
import { createV3Handler } from './commands/v3-command.js';
import { createTunePipelineHandler } from './commands/tune-pipeline-command.js';
import { createDependencies } from './di/container.js';

// Re-export parseConcurrency for backward compatibility
export { parseConcurrency } from './utils/concurrency.js';

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
  cachingProvider: HistoricalDataCache;
  strategyRegistry: StrategyRegistry;
}

/**
 * Create a fully wired CommandRouter with real handlers connected to domain components.
 * Loads config and price data on initialization.
 */
export function createWiredRouter(options: WiringOptions = {}): WiredRouter {
  const deps = createDependencies(options);
  const { config, dataDir, registry, cachingProvider, priceDataStore, priceFeedClient, watchlistManager, strategyManager, processManager, strategyRegistry, regimeDetector } = deps;

  const router = new CommandRouter();

  // Register all handlers
  router.register('add-stock', ['ticker'], createAddStockHandler(deps));
  router.register('remove-stock', ['ticker'], createRemoveStockHandler(deps));
  router.register('list-watchlist', [], createListWatchlistHandler(deps));
  router.register('start-monitor', [], createStartMonitorHandler(deps));
  router.register('stop-monitor', [], createStopMonitorHandler(deps));
  router.register('get-status', [], createGetStatusHandler(deps));
  router.register('configure-strategy', ['ticker', 'strategy'], createConfigureStrategyHandler(deps));
  router.register('show-signals', [], createShowSignalsHandler(deps));
  router.register('history', ['ticker'], createHistoryHandler(deps));
  router.register('backtest', ['strategy'], createBacktestHandler(deps));
  router.register('clear-cache', [], createClearCacheHandler(deps));
  router.register('tune', ['ticker', 'strategy'], createTuneSingleHandler(deps));
  router.register('tune-and-chart', ['ticker', 'strategy'], createTuneAndChartHandler(deps));
  router.register('tune-pipeline', ['tickers', 'strategy'], createTunePipelineHandler(deps));
  router.register('scan', ['strategy'], createScanHandler({ cachingProvider, dataDir, regimeDetector }));
  router.register('chart', ['ticker', 'strategy'], createChartHandler({ cachingProvider, registry: strategyRegistry, dataDir }));
  router.register('scan-chart', ['ticker', 'strategy'], createScanChartHandler({ cachingProvider, dataDir }));
  router.register('v3', ['ticker'], createV3Handler({ ...deps, router }));
  router.register('regime', [], createRegimeHandler({ cachingProvider, dataDir }));
  router.register('journal-status', [], createJournalStatusHandler({ dataDir, cachingProvider }));
  router.register('journal-record', [], createJournalRecordHandler({ dataDir, cachingProvider }));
  router.register('journal-update', [], createJournalUpdateHandler({ dataDir, cachingProvider }));
  router.register('signal-history', [], createSignalHistoryHandler({ dataDir }));
  router.register('sentiment-check', [], createSentimentCheckHandler({ dataDir }));
  router.register('news-timeline', [], createNewsTimelineHandler({ dataDir }));

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
