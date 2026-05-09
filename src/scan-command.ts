// ============================================================
// Scan Command — Daily signal detection handler
// ============================================================
// Loads cached profiles and runs signal detection.
// Accepts --tickers (required), --strategy (required),
// --date (optional, default "latest"), --allow-stale (optional).
//
// ISOLATION: This module does NOT import TuningEngine,
// generateConsolidationBreakoutGrid, generateV2Grid, generateGrid,
// evaluateV3Configuration, evaluateConfiguration, or walkForwardValidate.
// ============================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { successResult, errorResult } from './command-router.js';
import type { CommandHandler } from './command-router.js';
import type { CachingDataProvider } from './caching-data-provider.js';
import { loadStrategyProfile } from './profile-store.js';
import { detectSignal } from './signal-detector.js';
import type { SignalOutput } from './strategy-registry.js';

// ============================================================
// Dependencies
// ============================================================

export interface ScanCommandDeps {
  cachingProvider: CachingDataProvider;
  dataDir: string;
}

// ============================================================
// Signal Priority Map
// ============================================================

const SIGNAL_PRIORITY: Record<string, number> = {
  active: 0,
  active_late: 1,
  extended: 2,
  pressure: 3,
  near: 4,
  forming: 5,
  none: 6,
};

// ============================================================
// Sort by Signal Priority
// ============================================================

/**
 * Sort SignalOutput array by signal priority:
 * active > active_late > extended > pressure > near > forming > none.
 * When two signals share the same priority, sorts by confidence descending.
 * Returns a new sorted array (does not mutate the input).
 */
export function sortBySignalPriority(signals: SignalOutput[]): SignalOutput[] {
  return [...signals].sort((a, b) => {
    const priorityA = SIGNAL_PRIORITY[a.signal] ?? 6;
    const priorityB = SIGNAL_PRIORITY[b.signal] ?? 6;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    // Secondary sort: higher confidence first
    return b.confidence - a.confidence;
  });
}


// ============================================================
// Top-100 Ticker Resolution
// ============================================================

function resolveTickerList(tickersArg: string, dataDir: string): string[] | { error: string } {
  if (tickersArg.toLowerCase() === 'top100') {
    try {
      const top100Path = join(dataDir, 'data', 'top100.json');
      const content = readFileSync(top100Path, 'utf-8');
      const parsed = JSON.parse(content) as { tickers?: string[] };
      if (!Array.isArray(parsed.tickers) || parsed.tickers.length === 0) {
        return { error: `top100.json at ${top100Path} is missing or has empty 'tickers' array` };
      }
      return parsed.tickers.map((t: string) => t.toUpperCase());
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { error: `Failed to load top100.json: ${message}` };
    }
  }

  return tickersArg.split(',').map(t => t.trim().toUpperCase()).filter(t => t.length > 0);
}

// ============================================================
// createScanHandler
// ============================================================

export function createScanHandler(deps: ScanCommandDeps): CommandHandler {
  const { cachingProvider, dataDir } = deps;

  return async (opts: Record<string, string>) => {
    const tickersArg = opts['tickers'];
    const strategyName = opts['strategy'];
    const allowStale = opts['allow-stale'] !== undefined;

    if (!tickersArg) {
      return errorResult('scan', 'MISSING_PARAM', 'Missing required parameter: --tickers');
    }

    if (!strategyName) {
      return errorResult('scan', 'MISSING_PARAM', 'Missing required parameter: --strategy');
    }

    // Resolve ticker list
    const tickers = resolveTickerList(tickersArg, dataDir);
    if ('error' in tickers) {
      return errorResult('scan', 'CONFIG_ERROR', tickers.error);
    }

    if (tickers.length === 0) {
      return errorResult('scan', 'MISSING_PARAM', 'No tickers specified');
    }

    const signals: SignalOutput[] = [];
    const warnings: string[] = [];

    // Process each ticker sequentially
    for (const ticker of tickers) {
      try {
        // Fetch latest data
        const dataResult = await cachingProvider.getHistoricalData(ticker, '1y');

        if (!dataResult.success) {
          warnings.push(`[${ticker}] Failed to fetch data: ${dataResult.error}`);
          continue;
        }

        const dataPoints = dataResult.data.dataPoints;

        // Determine which strategies to scan
        const strategiesToScan = strategyName === 'v3'
          ? ['consolidation_breakout', 'trend_pullback']
          : [strategyName];

        for (const strat of strategiesToScan) {
          // Load profile
          const profileResult = loadStrategyProfile(ticker, strat, {
            allowStale,
            baseDir: dataDir,
          });

          if (!profileResult.success) {
            if (profileResult.error.code === 'PROFILE_NOT_FOUND') {
              warnings.push(
                `[${ticker}/${strat}] Profile not found. Run: npm run v3 -- --ticker ${ticker}`
              );
              continue;
            }

            if (profileResult.error.code === 'PROFILE_EXPIRED' && !allowStale) {
              warnings.push(
                `[${ticker}/${strat}] Profile expired. Retune with: npm run v3 -- --ticker ${ticker} --force, or use --allow-stale`
              );
              continue;
            }

            warnings.push(`[${ticker}/${strat}] ${profileResult.error.message}`);
            continue;
          }

          const profile = profileResult.data;

          // Detect signal using profile params
          const signal = detectSignal(dataPoints, profile.params, strat);
          signal.ticker = ticker;
          signals.push(signal);
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        warnings.push(`[${ticker}] Error: ${message}`);
      }
    }

    // Sort by signal priority
    const sorted = sortBySignalPriority(signals);

    return successResult('scan', {
      signals: sorted,
      warnings,
      total: tickers.length,
      scanned: signals.length,
      skipped: tickers.length - signals.length,
    });
  };
}
