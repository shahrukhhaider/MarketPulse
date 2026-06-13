// ============================================================
// V3 Command — Shorthand for tune-and-chart --v3 --save
// ============================================================

import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler, CommandRouter } from '../command-router.js';
import type { AppDependencies } from '../di/container.js';
import { parseConcurrency } from '../utils/concurrency.js';
import { resolveUniverse } from '../utils/universe.js';
import { parallelTune } from '../pipeline/parallel-tune.js';

// ============================================================
// V3 Deps — extends AppDependencies with router access
// ============================================================

export interface V3CommandDeps extends AppDependencies {
  router: CommandRouter;
}

// ============================================================
// createV3Handler
// ============================================================

export function createV3Handler(deps: V3CommandDeps): CommandHandler {
  const { cachingProvider, dataDir, router } = deps;

  return async (opts: Record<string, string>) => {
    // Parse --concurrency flag
    const concurrency = parseConcurrency(opts);
    const tickerArg = opts['ticker'];

    // Resolve universe (replaces --cap-tier)
    const universeResult = resolveUniverse(opts['universe']);
    if ('error' in universeResult) {
      return errorResult('v3', 'INVALID_PARAM_RANGE', universeResult.error);
    }

    // Resolve ticker list: 'watchlist' loads from data/watchlist.json, comma-separated splits
    const tickers = resolveV3TickerList(tickerArg, dataDir);
    if ('error' in tickers) {
      return errorResult('v3', 'CONFIG_ERROR', tickers.error);
    }

    if (tickers.length === 0) {
      return errorResult('v3', 'MISSING_PARAM', 'No tickers specified');
    }

    // Multi-ticker path: use parallelTune
    if (tickers.length > 1) {
      const batchResult = await parallelTune({
        tickers,
        concurrency,
        shouldSave: true,
        noCache: opts['no-cache'] !== undefined,
        runBacktest: true,
        cachingProvider,
        dataDir,
      });

      return successResult('v3', batchResult);
    }

    // Single ticker path: run on main thread via existing tune-and-chart handler
    opts['ticker'] = tickers[0];
    opts['strategy'] = 'v3';
    opts['v3'] = '';
    opts['save'] = '';
    opts['concurrency'] = String(concurrency);
    const tuneAndChartDef = router.getHandler('tune-and-chart');
    if (!tuneAndChartDef) {
      return errorResult('v3', 'INTERNAL_ERROR', 'tune-and-chart handler not found');
    }
    return tuneAndChartDef(opts);
  };
}

// ============================================================
// V3 Ticker List Resolution
// ============================================================

/**
 * Resolve the --ticker argument for the v3 command.
 * Supports: single ticker, comma-separated list, or 'watchlist' keyword.
 */
function resolveV3TickerList(tickerArg: string, dataDir: string): string[] | { error: string } {
  if (tickerArg.toLowerCase() === 'watchlist') {
    try {
      // Look for watchlist.json in the data/ directory relative to CWD (project root)
      // Fallback: also check relative to dataDir
      let watchlistPath = path.join(process.cwd(), 'data', 'watchlist.json');
      try {
        readFileSync(watchlistPath, 'utf-8');
      } catch {
        // Fallback to dataDir-relative path (for compatibility with tune-command)
        watchlistPath = path.join(dataDir, 'data', 'watchlist.json');
      }
      const content = readFileSync(watchlistPath, 'utf-8');
      const parsed = JSON.parse(content) as { tickers?: string[] };
      if (!Array.isArray(parsed.tickers) || parsed.tickers.length === 0) {
        return { error: `watchlist.json at ${watchlistPath} is missing or has empty 'tickers' array` };
      }
      return parsed.tickers.map((t: string) => t.toUpperCase());
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { error: `Failed to load watchlist.json: ${message}` };
    }
  }

  // Comma-separated or single ticker
  const tickers = tickerArg.split(',').map(t => t.trim().toUpperCase()).filter(t => t.length > 0);
  return tickers;
}
