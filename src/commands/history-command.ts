// ============================================================
// History Command — Fetch historical price data for a ticker
// ============================================================

import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import { ErrorCodes } from '../types.js';
import type { HistoricalPeriod, HistoricalInterval } from '../types.js';
import type { AppDependencies } from '../di/container.js';

// ============================================================
// createHistoryHandler
// ============================================================

export function createHistoryHandler(deps: AppDependencies): CommandHandler {
  const { priceFeedClient } = deps;

  return async (opts: Record<string, string>) => {
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
  };
}
