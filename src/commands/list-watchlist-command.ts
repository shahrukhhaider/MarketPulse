// ============================================================
// List Watchlist Command — List all stocks with enriched data
// ============================================================

import { successResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import type { AppDependencies } from '../di/container.js';

// ============================================================
// createListWatchlistHandler
// ============================================================

export function createListWatchlistHandler(deps: AppDependencies): CommandHandler {
  const { watchlistManager, priceDataStore } = deps;

  return (_opts: Record<string, string>) => {
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
  };
}
