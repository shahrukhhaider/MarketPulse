import type { Config, WatchlistEntry } from './types.js';
import { ErrorCodes } from './types.js';
import { save, type Result } from './config-store.js';

export class WatchlistManager {
  private config: Config;
  private configFilePath: string;

  constructor(config: Config, configFilePath: string) {
    this.config = config;
    this.configFilePath = configFilePath;
  }

  addStock(ticker: string): Result<WatchlistEntry> {
    const normalized = ticker.toUpperCase();

    if (this.hasStock(normalized)) {
      return {
        success: false,
        error: `${ErrorCodes.DUPLICATE_STOCK}: Stock '${normalized}' is already in the watchlist`,
      };
    }

    const entry: WatchlistEntry = {
      ticker: normalized,
      addedAt: new Date().toISOString(),
      strategies: [],
    };

    this.config.watchlist.push(entry);

    const saveResult = save(this.config, this.configFilePath);
    if (!saveResult.success) {
      // Roll back the in-memory change
      this.config.watchlist.pop();
      return { success: false, error: saveResult.error };
    }

    return { success: true, data: entry };
  }

  removeStock(ticker: string): Result<void> {
    const normalized = ticker.toUpperCase();
    const index = this.config.watchlist.findIndex(
      (e) => e.ticker.toUpperCase() === normalized
    );

    if (index === -1) {
      return {
        success: false,
        error: `${ErrorCodes.STOCK_NOT_FOUND}: Stock '${normalized}' is not in the watchlist`,
      };
    }

    const [removed] = this.config.watchlist.splice(index, 1);

    const saveResult = save(this.config, this.configFilePath);
    if (!saveResult.success) {
      // Roll back the in-memory change
      this.config.watchlist.splice(index, 0, removed);
      return { success: false, error: saveResult.error };
    }

    return { success: true, data: undefined };
  }

  listStocks(): WatchlistEntry[] {
    return this.config.watchlist;
  }

  hasStock(ticker: string): boolean {
    const normalized = ticker.toUpperCase();
    return this.config.watchlist.some(
      (e) => e.ticker.toUpperCase() === normalized
    );
  }

  getStock(ticker: string): Result<WatchlistEntry> {
    const normalized = ticker.toUpperCase();
    const entry = this.config.watchlist.find(
      (e) => e.ticker.toUpperCase() === normalized
    );

    if (!entry) {
      return {
        success: false,
        error: `${ErrorCodes.STOCK_NOT_FOUND}: Stock '${normalized}' is not in the watchlist`,
      };
    }

    return { success: true, data: entry };
  }
}
