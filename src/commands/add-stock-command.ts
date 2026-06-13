// ============================================================
// Add Stock Command — Validate ticker and add to watchlist
// ============================================================

import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import { ErrorCodes } from '../types.js';
import type { AppDependencies } from '../di/container.js';

// ============================================================
// createAddStockHandler
// ============================================================

export function createAddStockHandler(deps: AppDependencies): CommandHandler {
  const { priceFeedClient, watchlistManager } = deps;

  return async (opts: Record<string, string>) => {
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
  };
}
