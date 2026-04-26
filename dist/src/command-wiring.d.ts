import { CommandRouter } from './command-router.js';
import { getDefault } from './config-store.js';
import { PriceDataStore } from './price-data-store.js';
import { PriceFeedClient } from './price-feed-client.js';
import type { YahooFinanceClient } from './price-feed-client.js';
import { WatchlistManager } from './watchlist-manager.js';
import { StrategyManager } from './strategy-manager.js';
import { ProcessManager } from './process-manager.js';
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
export declare function createWiredRouter(options?: WiringOptions): WiredRouter;
//# sourceMappingURL=command-wiring.d.ts.map