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
import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import type { HistoricalDataCache } from '../data/historical-data-cache.js';
import { loadStrategyProfile } from '../data/profile-store.js';
import type { StrategyProfile } from '../data/profile-store.js';
import { detectSignal } from '../strategies/signal-detector.js';
import type { DetectSignalOptions } from '../strategies/signal-detector.js';
import type { SignalOutput } from '../strategies/strategy-registry.js';
import { parallelScan } from '../pipeline/parallel-scan.js';
import { runPipeline } from '../pipeline/signal-pipeline.js';
import { RegimeDetector } from '../indicators/regime-detector.js';
import type { RegimeResult, RegimeState } from '../indicators/regime-detector.js';
import { load as loadJournal } from '../journal/journal-store.js';
import { JOURNAL_DEFAULTS } from '../journal/journal-types.js';
import { EarningsDateProvider } from '../data/earnings-date-provider.js';
import { DEFAULT_PEAD_CONFIG } from '../strategies/strategy-configs.js';
import type { JournalEntry } from '../journal/journal-types.js';
import { computePositionMetrics } from '../utils/position-metrics.js';
import type { PositionMetrics } from '../utils/position-metrics.js';
import { computeConfluence } from '../indicators/confluence-calculator.js';
import { computeStats } from '../journal/journal-reporter.js';
import { scoreCandlesticks } from '../indicators/candlestick-scorer.js';
import type { Bar } from '../indicators/candlestick-scorer.js';
import { computeLineage } from '../indicators/signal-lineage.js';
import type { SignalLineage } from '../indicators/signal-lineage.js';
import { resolveUniverse, VALID_UNIVERSES } from '../utils/universe.js';
import type { CapTier } from '../utils/universe.js';

// ============================================================
// Dependencies
// ============================================================

export interface ScanCommandDeps {
  cachingProvider: HistoricalDataCache;
  dataDir: string;
  regimeDetector?: RegimeDetector;
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
    const confDiff = b.confidence - a.confidence;
    if (confDiff !== 0) {
      return confDiff;
    }
    // Tertiary sort: higher confluence first; undefined sorts after defined
    const confA = a.confluence ?? -1;
    const confB = b.confluence ?? -1;
    return confB - confA;
  });
}


// ============================================================
// RS Confidence Adjustment
// ============================================================

/**
 * Adjust signal confidence based on RS Rating.
 * RS ≥ 80: slight boost (market leader accelerating)
 * RS 60–79: no change (average performer)
 * RS 40–59: mild reduction (laggard)
 * RS < 40: notable reduction (weak stock)
 */
function applyRsConfidenceAdjustment(confidence: number, rsRating: number): number {
  let adjusted: number;
  if (rsRating >= 80) adjusted = confidence * 1.05;
  else if (rsRating >= 60) adjusted = confidence;
  else if (rsRating >= 40) adjusted = confidence * 0.90;
  else adjusted = confidence * 0.80;
  return Math.max(0, Math.min(1, adjusted));
}

// ============================================================
// Candlestick Confidence Adjustment
// ============================================================

/**
 * Apply candlestick pattern adjustment to an active signal.
 * Only applies to signals with signal === 'active'; all others pass through unchanged.
 * On scorer error, retains original confidence and omits candlestick fields.
 * When patterns detected: sets candlestickPatterns and candlestickAdjustment on signal.
 * When no patterns: returns signal unchanged (fields remain undefined).
 */
function applyCandlestickAdjustment(signal: SignalOutput, bars: Bar[]): SignalOutput {
  if (signal.signal !== 'active') return signal;
  try {
    const result = scoreCandlesticks(bars, signal.strategy);
    if (result.patterns.length === 0) return signal;
    const adjusted = Math.max(0, Math.min(1, signal.confidence * result.adjustment));
    return {
      ...signal,
      confidence: adjusted,
      candlestickPatterns: result.patterns,
      candlestickAdjustment: result.adjustment,
    };
  } catch {
    // Retain original confidence on error
    return signal;
  }
}

// ============================================================
// Top-100 Ticker Resolution
// ============================================================

function resolveTickerList(tickersArg: string, dataDir: string, watchlistFile: string = 'watchlist.json'): string[] | { error: string } {
  if (tickersArg.toLowerCase() === 'watchlist' || tickersArg.toLowerCase() === 'top100') {
    try {
      const watchlistPath = join(dataDir, 'data', watchlistFile);
      const content = readFileSync(watchlistPath, 'utf-8');
      const parsed = JSON.parse(content) as { tickers?: string[] };
      if (!Array.isArray(parsed.tickers) || parsed.tickers.length === 0) {
        return { error: `Watchlist file '${watchlistFile}' at ${watchlistPath} is missing or has empty 'tickers' array` };
      }
      return parsed.tickers.map((t: string) => t.toUpperCase());
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { error: `Failed to load watchlist file '${watchlistFile}': ${message}` };
    }
  }

  return tickersArg.split(',').map(t => t.trim().toUpperCase()).filter(t => t.length > 0);
}

// ============================================================
// Profile Scoping — Universe-aware profile filtering
// ============================================================

/**
 * Check if a strategy profile is scoped to the active universe.
 * Legacy profiles (no cap_tier field) are accepted for any universe.
 * Profiles with a defined cap_tier must match the active universe.
 */
export function isProfileScopedToUniverse(
  profile: StrategyProfile,
  activeUniverse: CapTier
): boolean {
  if (profile.cap_tier === undefined) return true;
  return profile.cap_tier === activeUniverse;
}

// ============================================================
// Open Positions Processing
// ============================================================

/**
 * Load open journal positions, resolve current prices, and compute metrics.
 * Returns the computed positions array and any warnings generated.
 * Non-fatal: always returns a result even if journal is missing or malformed.
 */
async function loadOpenPositions(
  dataDir: string,
  cachingProvider: HistoricalDataCache,
  existingPriceData: Map<string, number>,
): Promise<{ openPositions: PositionMetrics[]; warnings: string[] }> {
  const warnings: string[] = [];
  const journalPath = join(dataDir, JOURNAL_DEFAULTS.JOURNAL_PATH);

  // Load journal entries
  const loadResult = loadJournal(journalPath);
  let openEntries: JournalEntry[] = [];

  if (!loadResult.success) {
    // journal-store.load() returns ok([]) when file doesn't exist,
    // so reaching here means the file is malformed — add a warning
    warnings.push(`Journal warning: ${loadResult.error}`);
  } else {
    openEntries = loadResult.data.filter((e) => e.status === 'open');
  }

  if (openEntries.length === 0) {
    return { openPositions: [], warnings };
  }

  // Collect unique tickers from open positions
  const uniqueTickers = [...new Set(openEntries.map((e) => e.ticker))];

  // Resolve current prices: reuse existing data, fetch remaining
  const priceMap = new Map<string, number>(existingPriceData);

  const tickersToFetch = uniqueTickers.filter((t) => !priceMap.has(t));

  for (const ticker of tickersToFetch) {
    try {
      const dataResult = await cachingProvider.getHistoricalData(ticker, '1y');
      if (dataResult.success && dataResult.data.dataPoints.length > 0) {
        const lastPoint = dataResult.data.dataPoints[dataResult.data.dataPoints.length - 1];
        priceMap.set(ticker, lastPoint.close);
      } else {
        warnings.push(`[${ticker}] Price data unavailable for open position`);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      warnings.push(`[${ticker}] Failed to fetch price for open position: ${message}`);
    }
  }

  // Compute metrics for each open entry
  const today = new Date();
  const positions: PositionMetrics[] = openEntries.map((entry) => {
    const currentPrice = priceMap.get(entry.ticker) ?? null;
    if (currentPrice === null) {
      // Only add warning if we haven't already warned about this ticker
      if (!tickersToFetch.includes(entry.ticker) && !existingPriceData.has(entry.ticker)) {
        warnings.push(`[${entry.ticker}] Price data unavailable for open position`);
      }
    }
    return computePositionMetrics({ entry, currentPrice, today });
  });

  // Sort by pnl_pct descending, nulls last
  positions.sort((a, b) => {
    if (a.pnl_pct === null && b.pnl_pct === null) return 0;
    if (a.pnl_pct === null) return 1;
    if (b.pnl_pct === null) return -1;
    return b.pnl_pct - a.pnl_pct;
  });

  return { openPositions: positions, warnings };
}

// ============================================================
// Load Tickers from Watchlist File
// ============================================================

/**
 * Load tickers directly from a watchlist file path.
 * Used by --universe all to load each universe's tickers independently.
 * Returns the ticker array or an error object.
 */
function loadTickersFromWatchlist(dataDir: string, watchlistFile: string): string[] | { error: string } {
  try {
    const watchlistPath = join(dataDir, 'data', watchlistFile);
    const content = readFileSync(watchlistPath, 'utf-8');
    const parsed = JSON.parse(content) as { tickers?: string[] };
    if (!Array.isArray(parsed.tickers) || parsed.tickers.length === 0) {
      return { error: `Watchlist file '${watchlistFile}' at ${watchlistPath} is missing or has empty 'tickers' array` };
    }
    return parsed.tickers.map((t: string) => t.toUpperCase());
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Failed to load watchlist file '${watchlistFile}': ${message}` };
  }
}

// ============================================================
// Single Ticker Scan Helper (for --universe all with single-ticker universes)
// ============================================================

async function runSingleTickerScan(
  tickers: string[],
  strategyName: string,
  allowStale: boolean,
  cachingProvider: HistoricalDataCache,
  dataDir: string,
  regimeStateMap?: Map<string, RegimeState>,
): Promise<{ signals: SignalOutput[]; warnings: string[]; total: number; scanned: number; skipped: number }> {
  const signals: SignalOutput[] = [];
  const warnings: string[] = [];

  for (const ticker of tickers) {
    try {
      const dataResult = await cachingProvider.getHistoricalData(ticker, '1y');
      if (!dataResult.success) {
        warnings.push(`[${ticker}] Failed to fetch data: ${dataResult.error}`);
        continue;
      }
      const dataPoints = dataResult.data.dataPoints;
      const strategiesToScan = strategyName === 'v3'
        ? ['consolidation_breakout', 'trend_pullback', 'bear_breakdown', 'post_earnings_drift', 'keltner_mean_reversion']
        : [strategyName];

      for (const strat of strategiesToScan) {
        let params: Record<string, number>;
        let signalOptions: DetectSignalOptions | undefined;

        if (strat === 'post_earnings_drift') {
          params = DEFAULT_PEAD_CONFIG as unknown as Record<string, number>;
          const earningsResult = await new EarningsDateProvider({ cacheDir: dataDir }).getEarningsDates(ticker);
          signalOptions = { earningsDates: earningsResult.success ? earningsResult.data.dates : [] };
        } else {
          const profileResult = loadStrategyProfile(ticker, strat, { allowStale, baseDir: dataDir });
          if (!profileResult.success) {
            if (profileResult.error.code === 'PROFILE_NOT_FOUND') {
              warnings.push(`[${ticker}/${strat}] Profile not found. Run: npm run v3 -- --ticker ${ticker}`);
              continue;
            }
            if (profileResult.error.code === 'PROFILE_EXPIRED' && !allowStale) {
              warnings.push(`[${ticker}/${strat}] Profile expired. Retune or use --allow-stale`);
              continue;
            }
            warnings.push(`[${ticker}/${strat}] ${profileResult.error.message}`);
            continue;
          }
          params = profileResult.data.params;
        }

        const signal = detectSignal(dataPoints, params, strat, signalOptions);
        signal.ticker = ticker;

        // Apply RS confidence adjustment if regime data available
        if (regimeStateMap) {
          const regimeState = regimeStateMap.get(ticker);
          signal.confidence = applyRsConfidenceAdjustment(signal.confidence, regimeState?.rs_rating ?? 50);
        }

        signals.push(signal);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      warnings.push(`[${ticker}] Error: ${message}`);
    }
  }

  return {
    signals: sortBySignalPriority(signals),
    warnings,
    total: tickers.length,
    scanned: signals.length,
    skipped: tickers.length - signals.length,
  };
}

// ============================================================
// createScanHandler
// ============================================================

export function createScanHandler(deps: ScanCommandDeps): CommandHandler {
  const { cachingProvider, dataDir, regimeDetector } = deps;

  return async (opts: Record<string, string>) => {
    const tickersArg = opts['tickers'];
    const strategyName = opts['strategy'];
    const allowStale = opts['allow-stale'] !== undefined;
    const regimeFlag = opts['no-regime'] === undefined; // regime runs by default; --no-regime disables it
    const universeArg = opts['universe'];

    if (!strategyName) {
      return errorResult('scan', 'MISSING_PARAM', 'Missing required parameter: --strategy');
    }

    // ---- Universe resolution ----
    // Validate --universe flag value
    if (universeArg !== undefined && universeArg !== 'all') {
      const validWithAll = [...VALID_UNIVERSES, 'all'];
      if (!validWithAll.includes(universeArg as any)) {
        return errorResult(
          'scan',
          'INVALID_PARAM_RANGE',
          `Invalid --universe value '${universeArg}'. Valid options: ${VALID_UNIVERSES.join(', ')}, all`,
        );
      }
    }

    // Handle --universe all: iterate over defined tiers, scan each independently, merge results
    if (universeArg === 'all') {
      const universesToScan: CapTier[] = ['large_cap', 'mid_cap'];
      const allResults: Record<string, unknown>[] = [];
      const allWarnings: string[] = [];

      for (const tier of universesToScan) {
        const resolution = resolveUniverse(tier);
        if ('error' in resolution) {
          allWarnings.push(`[${tier}] ${resolution.error}`);
          continue;
        }

        // Load tickers from the universe's watchlist
        const tickers = loadTickersFromWatchlist(dataDir, resolution.watchlistFile);
        if ('error' in tickers) {
          // Non-fatal for --universe all: skip with warning
          allWarnings.push(`[${tier}] Skipping: ${tickers.error}`);
          continue;
        }

        // Build opts for this universe's scan (reuse most opts, override tickers)
        const universeOpts: Record<string, string> = {
          ...opts,
          tickers: tickers.join(','),
          universe: tier,
        };
        // Remove the 'all' value so recursive call doesn't loop
        delete universeOpts['_universe_all'];

        // Run the scan for this universe using the single-universe path
        const concurrency = opts['_concurrency'] ? parseInt(opts['_concurrency'], 10) : 8;

        // Run regime detection once (shared across universes)
        let regimeResult: RegimeResult | undefined;
        let regimeStateMap: Map<string, RegimeState> | undefined;

        if (regimeFlag && regimeDetector) {
          regimeResult = await regimeDetector.detect(tickers);
          regimeStateMap = new Map<string, RegimeState>();
          for (const state of regimeResult.tickers) {
            regimeStateMap.set(state.ticker, state);
          }
        }

        // Use parallelScan for multi-ticker
        if (tickers.length > 1 && concurrency > 1) {
          const result = await parallelScan({
            tickers,
            concurrency,
            strategyName,
            allowStale,
            cachingProvider,
            dataDir,
            activeUniverse: tier,
          });

          // Annotate signals with regime state + RS confidence adjustment
          const annotatedSignals = regimeStateMap
            ? result.signals.map(s => {
                const regimeState = regimeStateMap!.get(s.ticker);
                const confidence = applyRsConfidenceAdjustment(s.confidence, regimeState?.rs_rating ?? 50);
                return { ...s, confidence, regimeState };
              })
            : result.signals;

          allResults.push({
            universe: tier,
            header: `━━━ ${tier.replace('_cap', ' CAP').toUpperCase()} ━━━`,
            signals: sortBySignalPriority(annotatedSignals),
            warnings: result.warnings,
            total: result.total,
            scanned: result.scanned,
            skipped: result.skipped,
          });
          allWarnings.push(...result.warnings);
        } else {
          // Single ticker or sequential path for this universe
          const singleResult = await runSingleTickerScan(
            tickers, strategyName, allowStale, cachingProvider, dataDir, regimeStateMap,
          );
          allResults.push({
            universe: tier,
            header: `━━━ ${tier.replace('_cap', ' CAP').toUpperCase()} ━━━`,
            signals: singleResult.signals,
            warnings: singleResult.warnings,
            total: singleResult.total,
            scanned: singleResult.scanned,
            skipped: singleResult.skipped,
          });
          allWarnings.push(...singleResult.warnings);
        }
      }

      // Merge results with section headers
      const mergedSignals: SignalOutput[] = [];
      const sections: { header: string; signals: SignalOutput[] }[] = [];
      for (const r of allResults) {
        sections.push({
          header: r.header as string,
          signals: r.signals as SignalOutput[],
        });
        mergedSignals.push(...(r.signals as SignalOutput[]));
      }

      // Load open positions
      const positionsResult = await loadOpenPositions(dataDir, cachingProvider, new Map());

      // Compute journal total P&L
      const journalPath = join(dataDir, JOURNAL_DEFAULTS.JOURNAL_PATH);
      const journalLoadResult = loadJournal(journalPath);
      let journalPnl: number | null = null;
      if (journalLoadResult.success && journalLoadResult.data.length > 0) {
        const stats = computeStats(journalLoadResult.data);
        journalPnl = stats.total_pnl;
      }

      return successResult('scan', {
        signals: mergedSignals,
        processedSignals: runPipeline(mergedSignals),
        sections,
        warnings: [...allWarnings, ...positionsResult.warnings],
        total: allResults.reduce((sum, r) => sum + (r.total as number), 0),
        scanned: allResults.reduce((sum, r) => sum + (r.scanned as number), 0),
        skipped: allResults.reduce((sum, r) => sum + (r.skipped as number), 0),
        openPositions: positionsResult.openPositions,
        journalPnl,
        universeMode: 'all',
      });
    }

    // ---- Single universe path ----
    // Resolve universe (defaults to large_cap when not provided)
    const universeResult = resolveUniverse(universeArg);
    if ('error' in universeResult) {
      return errorResult('scan', 'INVALID_PARAM_RANGE', universeResult.error);
    }

    // Resolve tickers: use --tickers if provided, otherwise load from universe watchlist
    let tickers: string[] | { error: string };
    if (!tickersArg) {
      tickers = loadTickersFromWatchlist(dataDir, universeResult.watchlistFile);
    } else {
      tickers = resolveTickerList(tickersArg, dataDir, universeResult.watchlistFile);
    }
    if ('error' in tickers) {
      return errorResult('scan', 'CONFIG_ERROR', tickers.error);
    }

    if (tickers.length === 0) {
      return errorResult('scan', 'MISSING_PARAM', 'No tickers specified');
    }

    // Run regime detection by default (suppress with --no-regime)
    let regimeResult: RegimeResult | undefined;
    let regimeStateMap: Map<string, RegimeState> | undefined;

    if (regimeFlag && regimeDetector) {
      regimeResult = await regimeDetector.detect(tickers);
      regimeStateMap = new Map<string, RegimeState>();
      for (const state of regimeResult.tickers) {
        regimeStateMap.set(state.ticker, state);
      }
    }

    // Parse concurrency from opts (set by command-wiring.ts)
    const concurrency = opts['_concurrency'] ? parseInt(opts['_concurrency'], 10) : 8;

    // Multi-ticker path: use parallelScan when multiple tickers and concurrency > 1
    if (tickers.length > 1 && concurrency > 1) {
      const result = await parallelScan({
        tickers,
        concurrency,
        strategyName,
        allowStale,
        cachingProvider,
        dataDir,
        activeUniverse: universeResult.capTier,
      });

      // Annotate signals with regime state + RS confidence adjustment if available
      const annotatedSignals = regimeStateMap
        ? result.signals.map(s => {
            const regimeState = regimeStateMap!.get(s.ticker);
            const confidence = applyRsConfidenceAdjustment(s.confidence, regimeState?.rs_rating ?? 50);
            return { ...s, confidence, regimeState };
          })
        : result.signals;

      // Apply candlestick adjustment to active signals (after RS adjustment, before sorting)
      // Fetch last 3 bars per ticker from cache for the scorer
      const tickerBarsCache = new Map<string, Bar[]>();
      for (const sig of annotatedSignals) {
        if (sig.signal !== 'active') continue;
        if (!tickerBarsCache.has(sig.ticker)) {
          try {
            const dataResult = await cachingProvider.getHistoricalData(sig.ticker, '1y');
            if (dataResult.success && dataResult.data.dataPoints.length > 0) {
              const dp = dataResult.data.dataPoints;
              tickerBarsCache.set(sig.ticker, dp.slice(-3).map(p => ({ open: p.open, high: p.high, low: p.low, close: p.close })));
            }
          } catch {
            // On fetch error, skip candlestick adjustment for this ticker
          }
        }
      }
      const candlestickAnnotatedSignals = annotatedSignals.map(s => {
        const bars = tickerBarsCache.get(s.ticker);
        if (!bars) return s;
        return applyCandlestickAdjustment(s, bars);
      });

      // Apply signal lineage adjustment to active signals (after candlestick adjustment)
      const historyPath = join(dataDir, 'signal-history.ndjson');
      const today = new Date().toISOString().slice(0, 10);
      const currentMood = regimeResult?.market?.market_mood ?? 'unknown';

      const lineageAnnotatedSignals = candlestickAnnotatedSignals.map(s => {
        if (s.signal !== 'active' && s.signal !== 'active_late') return s;

        const lineage = computeLineage({
          ticker: s.ticker,
          strategy: s.strategy,
          currentState: 'active',
          currentMood,
          historyPath,
          today,
        });

        const adjusted = Math.max(0, Math.min(1, s.confidence * lineage.adjustment));
        return { ...s, confidence: adjusted, lineage };
      });

      // Compute confluence for v3 scans (multiple strategies)
      if (strategyName === 'v3') {
        const byTicker = new Map<string, SignalOutput[]>();
        for (const sig of lineageAnnotatedSignals) {
          const group = byTicker.get(sig.ticker) ?? [];
          group.push(sig);
          byTicker.set(sig.ticker, group);
        }
        for (const [, tickerSignals] of byTicker) {
          const confluenceResult = computeConfluence(tickerSignals);
          for (const sig of tickerSignals) {
            sig.confluence = confluenceResult.score;
          }
        }
      }

      // Load and process open positions
      // Price data reuse happens transparently via the caching provider
      const positionsResult = await loadOpenPositions(dataDir, cachingProvider, new Map());

      // Compute journal total P&L from closed trades
      const journalPath2 = join(dataDir, JOURNAL_DEFAULTS.JOURNAL_PATH);
      const journalLoadResult2 = loadJournal(journalPath2);
      let journalPnl2: number | null = null;
      if (journalLoadResult2.success && journalLoadResult2.data.length > 0) {
        const stats = computeStats(journalLoadResult2.data);
        journalPnl2 = stats.total_pnl;
      }

      const output: Record<string, unknown> = {
        signals: lineageAnnotatedSignals,
        processedSignals: runPipeline(lineageAnnotatedSignals),
        warnings: [...result.warnings, ...positionsResult.warnings],
        total: result.total,
        scanned: result.scanned,
        skipped: result.skipped,
        openPositions: positionsResult.openPositions,
        journalPnl: journalPnl2,
      };

      if (regimeResult) {
        output.regime = regimeResult;
        output.marketRegime = regimeResult.market;
      }

      return successResult('scan', output);
    }

    // Sequential path: single ticker or concurrency === 1
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
          ? ['consolidation_breakout', 'trend_pullback', 'bear_breakdown', 'post_earnings_drift', 'keltner_mean_reversion']
          : [strategyName];

        for (const strat of strategiesToScan) {
          let params: Record<string, number>;
          let signalOptions: DetectSignalOptions | undefined;

          if (strat === 'post_earnings_drift') {
            // PEAD uses universal defaults — no per-ticker tuning needed
            params = DEFAULT_PEAD_CONFIG as unknown as Record<string, number>;
            const earningsResult = await new EarningsDateProvider({ cacheDir: dataDir }).getEarningsDates(ticker);
            signalOptions = { earningsDates: earningsResult.success ? earningsResult.data.dates : [] };
          } else {
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

            // Profile scoping: check cap_tier matches active universe
            if (!isProfileScopedToUniverse(profileResult.data, universeResult.capTier)) {
              process.stderr.write(
                `[WARN] Skipping profile for ${ticker}: profile cap_tier '${profileResult.data.cap_tier}' does not match active universe '${universeResult.capTier}'. Re-tune with --universe ${universeResult.capTier}.\n`
              );
              // Use default params for this ticker's signal detection
              params = {};
            } else {
              params = profileResult.data.params;
            }
          }

          const signal = detectSignal(dataPoints, params, strat, signalOptions);
          signal.ticker = ticker;
          signals.push(signal);
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        warnings.push(`[${ticker}] Error: ${message}`);
      }
    }

    // Compute confluence for v3 scans (multiple strategies)
    if (strategyName === 'v3') {
      const byTicker = new Map<string, SignalOutput[]>();
      for (const sig of signals) {
        const group = byTicker.get(sig.ticker) ?? [];
        group.push(sig);
        byTicker.set(sig.ticker, group);
      }
      for (const [, tickerSignals] of byTicker) {
        const confluenceResult = computeConfluence(tickerSignals);
        for (const sig of tickerSignals) {
          sig.confluence = confluenceResult.score;
        }
      }
    }

    // Sort by signal priority
    const sorted = sortBySignalPriority(signals);

    // Annotate signals with regime state + RS confidence adjustment if available
    const annotatedSignals = regimeStateMap
      ? sorted.map(s => {
          const regimeState = regimeStateMap!.get(s.ticker);
          const confidence = applyRsConfidenceAdjustment(s.confidence, regimeState?.rs_rating ?? 50);
          return { ...s, confidence, regimeState };
        })
      : sorted;

    // Apply candlestick adjustment to active signals (after RS adjustment)
    // Fetch last 3 bars per ticker from cache for the scorer
    const seqTickerBarsCache = new Map<string, Bar[]>();
    for (const sig of annotatedSignals) {
      if (sig.signal !== 'active') continue;
      if (!seqTickerBarsCache.has(sig.ticker)) {
        try {
          const dataResult = await cachingProvider.getHistoricalData(sig.ticker, '1y');
          if (dataResult.success && dataResult.data.dataPoints.length > 0) {
            const dp = dataResult.data.dataPoints;
            seqTickerBarsCache.set(sig.ticker, dp.slice(-3).map(p => ({ open: p.open, high: p.high, low: p.low, close: p.close })));
          }
        } catch {
          // On fetch error, skip candlestick adjustment for this ticker
        }
      }
    }
    const candlestickAnnotatedSignals = annotatedSignals.map(s => {
      const bars = seqTickerBarsCache.get(s.ticker);
      if (!bars) return s;
      return applyCandlestickAdjustment(s, bars);
    });

    // Apply signal lineage adjustment to active signals (after candlestick adjustment)
    const seqHistoryPath = join(dataDir, 'signal-history.ndjson');
    const seqToday = new Date().toISOString().slice(0, 10);
    const seqCurrentMood = regimeResult?.market?.market_mood ?? 'unknown';

    const lineageAnnotatedSignals = candlestickAnnotatedSignals.map(s => {
      if (s.signal !== 'active' && s.signal !== 'active_late') return s;

      const lineage = computeLineage({
        ticker: s.ticker,
        strategy: s.strategy,
        currentState: 'active',
        currentMood: seqCurrentMood,
        historyPath: seqHistoryPath,
        today: seqToday,
      });

      const adjusted = Math.max(0, Math.min(1, s.confidence * lineage.adjustment));
      return { ...s, confidence: adjusted, lineage };
    });

    // Load and process open positions
    // Price data reuse happens transparently via the caching provider
    const positionsResult = await loadOpenPositions(dataDir, cachingProvider, new Map());

    // Compute journal total P&L from closed trades
    const journalPath = join(dataDir, JOURNAL_DEFAULTS.JOURNAL_PATH);
    const journalLoadResult = loadJournal(journalPath);
    let journalPnl: number | null = null;
    if (journalLoadResult.success && journalLoadResult.data.length > 0) {
      const stats = computeStats(journalLoadResult.data);
      journalPnl = stats.total_pnl;
    }

    const output: Record<string, unknown> = {
      signals: lineageAnnotatedSignals,
      processedSignals: runPipeline(lineageAnnotatedSignals),
      warnings: [...warnings, ...positionsResult.warnings],
      total: tickers.length,
      scanned: signals.length,
      skipped: tickers.length - signals.length,
      openPositions: positionsResult.openPositions,
      journalPnl,
    };

    if (regimeResult) {
      output.regime = regimeResult;
      output.marketRegime = regimeResult.market;
    }

    return successResult('scan', output);
  };
}
