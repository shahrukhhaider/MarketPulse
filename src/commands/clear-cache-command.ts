// ============================================================
// Clear-Cache Command — Remove cached historical data files
// ============================================================

import { successResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import type { AppDependencies } from '../di/container.js';

// ============================================================
// createClearCacheHandler
// ============================================================

export function createClearCacheHandler(deps: AppDependencies): CommandHandler {
  const { cachingProvider } = deps;

  return (opts: Record<string, string>) => {
    const ticker = opts['ticker'] ? opts['ticker'].toUpperCase() : undefined;
    const result = cachingProvider.clearCache(ticker);
    return successResult('clear-cache', {
      removed: result.removed,
      message: ticker
        ? `Cleared ${result.removed} cache entries for '${ticker}'`
        : `Cleared ${result.removed} cache entries`,
    });
  };
}
