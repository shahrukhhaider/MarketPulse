// ============================================================
// Remove Stock Command — Remove ticker from watchlist
// ============================================================

import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import { ErrorCodes } from '../types.js';
import type { AppDependencies } from '../di/container.js';

// ============================================================
// createRemoveStockHandler
// ============================================================

export function createRemoveStockHandler(deps: AppDependencies): CommandHandler {
  const { watchlistManager } = deps;

  return (opts: Record<string, string>) => {
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
  };
}
