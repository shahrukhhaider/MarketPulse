import * as path from 'node:path';
import { load as loadConfig, getDefault } from '../data/config-store.js';
import { PriceDataStore } from '../data/price-data-store.js';
import { PriceFeedClient } from '../data/price-feed-client.js';
import { WatchlistManager } from '../utils/watchlist-manager.js';
import { StrategyManager } from '../strategies/strategy-manager.js';
import { ProcessManager } from '../monitoring/process-manager.js';
import { DataProviderRegistry } from '../data/data-provider.js';
import { YahooFinanceAdapter } from '../data/yahoo-finance-adapter.js';
import { HistoricalDataCache } from '../data/historical-data-cache.js';
import { StrategyRegistry } from '../strategies/strategy-registry.js';
import { ConsolidationBreakoutStrategy } from '../strategies/consolidation-breakout-strategy.js';
import { BearBreakdownStrategy } from '../strategies/bear-breakdown-strategy.js';
import { PostEarningsDriftStrategy } from '../strategies/post-earnings-drift-strategy.js';
import { KeltnerMeanReversionStrategy } from '../strategies/keltner-mean-reversion-strategy.js';
import { VduEngine } from '../strategies/vdu-engine.js';
import { RegimeDetector } from '../indicators/regime-detector.js';
import type { Config } from '../types.js';
import type { WiringOptions } from '../command-wiring.js';

export interface AppDependencies {
  config: Config;
  configPath: string;
  dataDir: string;
  registry: DataProviderRegistry;
  cachingProvider: HistoricalDataCache;
  priceDataStore: PriceDataStore;
  priceFeedClient: PriceFeedClient;
  watchlistManager: WatchlistManager;
  strategyManager: StrategyManager;
  processManager: ProcessManager;
  strategyRegistry: StrategyRegistry;
  regimeDetector: RegimeDetector;
}

export function createDependencies(options: WiringOptions): AppDependencies {
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

  // Strategy Registry: instantiate and register strategies
  const strategyRegistry = new StrategyRegistry();
  strategyRegistry.register(new ConsolidationBreakoutStrategy());
  strategyRegistry.register(new BearBreakdownStrategy());
  strategyRegistry.register(new PostEarningsDriftStrategy(dataDir));
  strategyRegistry.register(new KeltnerMeanReversionStrategy());
  strategyRegistry.register(new VduEngine());

  // Regime detector
  const regimeDetector = new RegimeDetector({
    cachingProvider,
    cacheDir: dataDir,
  });

  return {
    config,
    configPath,
    dataDir,
    registry,
    cachingProvider,
    priceDataStore,
    priceFeedClient,
    watchlistManager,
    strategyManager,
    processManager,
    strategyRegistry,
    regimeDetector,
  };
}
