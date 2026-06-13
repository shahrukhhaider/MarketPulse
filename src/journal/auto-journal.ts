// ============================================================
// Auto-Journal — Records qualifying signals as paper trades
// ============================================================
// Runs after each scan to auto-enter high-confidence active signals.
// Respects scan-level dedup (ticker already held → skip) and
// delegates entry-level dedup to record() (DUPLICATE, MAX_OPEN).
// ============================================================

import { load, record } from './journal-store.js';
import type { JournalEntry } from './journal-types.js';
import type { SignalOutput } from '../strategies/strategy-registry.js';
import type { ErrorResult } from './journal-store.js';
import { todayPST } from '../utils/date-utils.js';

// ============================================================
// Types
// ============================================================

export interface AutoJournalResult {
  entered: JournalEntry[];   // successfully recorded
  skipped: string[];         // reason strings for skipped signals
  errors: string[];          // record() failures (IO_ERROR)
}

// ============================================================
// Auto-Journal Logic
// ============================================================

/**
 * Auto-enter qualifying signals as paper trades.
 *
 * Filtering criteria:
 * - signal.state === 'active' only (not near/forming/none)
 * - signal.confidence >= minConfidence (default 0.80, env override)
 * - signal.ticker NOT already held as an open position
 *
 * @param signals - All signals from the current scan
 * @param journalPath - Path to journal.json
 * @param opts - Optional overrides (minConfidence)
 * @returns AutoJournalResult with entered, skipped, and errors arrays
 */
export function autoJournal(
  signals: SignalOutput[],
  journalPath: string,
  opts?: { minConfidence?: number },
): AutoJournalResult {
  const result: AutoJournalResult = { entered: [], skipped: [], errors: [] };

  // Resolve minimum confidence threshold
  const envConfidence = process.env['AUTO_JOURNAL_MIN_CONFIDENCE'];
  const minConfidence = opts?.minConfidence
    ?? (envConfidence ? parseFloat(envConfidence) : 0.80);

  // 1. Load current journal entries
  const loadResult = load(journalPath);
  if (!loadResult.success) {
    result.errors.push(`Failed to load journal: ${loadResult.error}`);
    console.log(`[auto-journal] Entered: 0, Skipped: 0, Errors: 1`);
    return result;
  }

  const entries = loadResult.data;

  // 2. Build openTickers set: all tickers with status === 'open'
  const openTickers = new Set(
    entries
      .filter((e) => e.status === 'open')
      .map((e) => e.ticker.toUpperCase()),
  );

  // 3. Filter signals to qualifying candidates
  const today = todayPST();

  for (const signal of signals) {
    // Only active signals qualify
    if (signal.signal !== 'active') continue;

    // Confidence threshold
    if (signal.confidence < minConfidence) continue;

    // Scan-level dedup: ticker already held
    if (openTickers.has(signal.ticker.toUpperCase())) {
      result.skipped.push(`${signal.ticker}: already held as open position`);
      continue;
    }

    // 4. Record the qualifying signal
    const recordResult = record(
      {
        ticker: signal.ticker,
        strategy: signal.strategy,
        signal_date: today,
        entry_price: signal.entry,
        stop_price: signal.stop,
        risk_pct: Math.abs(signal.entry - signal.stop) / signal.entry * 100,
        confidence: signal.confidence,
        reasons: signal.reason ?? [],
      },
      journalPath,
    );

    // 5. Collect results
    if (recordResult.success) {
      result.entered.push(recordResult.data);
      // Add to openTickers so subsequent signals for same ticker are skipped
      openTickers.add(signal.ticker.toUpperCase());
    } else {
      const errorResult = recordResult as ErrorResult;
      if (errorResult.code === 'DUPLICATE' || errorResult.code === 'MAX_OPEN') {
        result.skipped.push(`${signal.ticker}: ${errorResult.error}`);
      } else {
        result.errors.push(`${signal.ticker}: ${errorResult.error}`);
      }
    }
  }

  // 6. Log summary
  console.log(
    `[auto-journal] Entered: ${result.entered.length}, Skipped: ${result.skipped.length}, Errors: ${result.errors.length}`,
  );

  // 7. Return result
  return result;
}
