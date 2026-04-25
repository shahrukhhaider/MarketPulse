import type { Config, WatchlistEntry } from './types.js';
import { type Result } from './config-store.js';
export declare class WatchlistManager {
    private config;
    private configFilePath;
    constructor(config: Config, configFilePath: string);
    addStock(ticker: string): Result<WatchlistEntry>;
    removeStock(ticker: string): Result<void>;
    listStocks(): WatchlistEntry[];
    hasStock(ticker: string): boolean;
    getStock(ticker: string): Result<WatchlistEntry>;
}
//# sourceMappingURL=watchlist-manager.d.ts.map