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
  near: 1,
  forming: 2,
  none: 3,
};

// ============================================================
// Sort by Signal Priority
// ============================================================

/**
 * Sort SignalOutput array by signal priority: active > near > forming > none.
 * Returns a new sorted array (does not mutate the input).
 */
export function sortBySignalPriority(signals: SignalOutput[]): SignalOutput[] {
  return [...signals].sort((a, b) => {
    const priorityA = SIGNAL_PRIORITY[a.signal] ?? 3;
    const priorityB = SIGNAL_PRIORITY[b.signal] ?? 3;
    return priorityA - priorityB;
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
        // Load profile
        const profileResult = loadStrategyProfile(ticker, strategyName, {
          allowStale,
          baseDir: dataDir,
        });

        if (!profileResult.success) {
          if (profileResult.error.code === 'PROFILE_NOT_FOUND') {
            warnings.push(
              `[${ticker}] Profile not found. Run: npm run tune -- --tickers ${ticker} --strategy ${strategyName} --save`
            );
            continue;
          }

          if (profileResult.error.code === 'PROFILE_EXPIRED' && !allowStale) {
            warnings.push(
              `[${ticker}] Profile expired. Retune with: npm run tune -- --tickers ${ticker} --strategy ${strategyName} --save, or use --allow-stale`
            );
            continue;
          }

          // PROFILE_CORRUPT or other errors
          warnings.push(`[${ticker}] ${profileResult.error.message}`);
          continue;
        }

        const profile = profileResult.data;

        // Fetch latest data
        const dataResult = await cachingProvider.getHistoricalData(ticker, '1y');

        if (!dataResult.success) {
          warnings.push(`[${ticker}] Failed to fetch data: ${dataResult.error}`);
          continue;
        }

        const dataPoints = dataResult.data.dataPoints;

        // Detect signal using profile params
        const signal = detectSignal(dataPoints, profile.params, strategyName);

        // Set ticker on the output
        signal.ticker = ticker;

        signals.push(signal);
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
