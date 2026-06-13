// ============================================================
// Tune-Pipeline Command — Orchestrate tuning across multiple tickers
// ============================================================

import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import type { AppDependencies } from '../di/container.js';
import { parseConcurrency } from '../utils/concurrency.js';
import { resolveUniverse } from '../utils/universe.js';
import { parallelTune } from '../pipeline/parallel-tune.js';
import { createTuneHandler } from './tune-command.js';

// ============================================================
// createTunePipelineHandler
// ============================================================

export function createTunePipelineHandler(deps: AppDependencies): CommandHandler {
  const { cachingProvider, strategyRegistry, dataDir } = deps;

  // Create the single-ticker tune handler for fallback
  const tuneHandler = createTuneHandler({ cachingProvider, registry: strategyRegistry, dataDir });

  return async (opts: Record<string, string>) => {
    // Parse and validate --concurrency flag
    const concurrency = parseConcurrency(opts);
    const tickersArg = opts['tickers'];
    const shouldSave = opts['save'] !== undefined;
    const noCache = opts['no-cache'] !== undefined;

    // Resolve universe (replaces --cap-tier)
    const universeResult = resolveUniverse(opts['universe']);
    if ('error' in universeResult) {
      return errorResult('tune-pipeline', 'INVALID_PARAM_RANGE', universeResult.error);
    }

    // Resolve ticker list to determine if we should use parallel execution
    const tickers = resolveV3TickerList(tickersArg, dataDir);
    if ('error' in tickers) {
      return errorResult('tune-pipeline', 'CONFIG_ERROR', tickers.error);
    }

    if (tickers.length === 0) {
      return errorResult('tune-pipeline', 'MISSING_PARAM', 'No tickers specified');
    }

    // Multi-ticker path: use parallelTune for parallel execution
    if (tickers.length > 1) {
      const batchResult = await parallelTune({
        tickers,
        concurrency,
        shouldSave,
        noCache,
        runBacktest: false,
        cachingProvider,
        dataDir,
      });

      return successResult('tune-pipeline', batchResult);
    }

    // Single ticker path: fall through to sequential handler
    opts['_concurrency'] = String(concurrency);
    return tuneHandler(opts);
  };
}

// ============================================================
// V3 Ticker List Resolution (local helper)
// ============================================================

/**
 * Resolve the --ticker argument for the tune-pipeline command.
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
