// ============================================================
// Journal Command — CLI handlers for journal:status, journal:record, journal:update
// ============================================================
// Implements three command handlers:
// - createJournalStatusHandler: loads journal, computes stats, formats output
// - createJournalRecordHandler: reads scan log, filters active signals, records entries
// - createJournalUpdateHandler: loads open entries, runs updater, persists results
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import type { HistoricalDataCache } from '../data/historical-data-cache.js';
import { load, record, save } from '../journal/journal-store.js';
import type { RecordInput } from '../journal/journal-store.js';
import { findLatestScanLog } from '../scan-types.js';
import { createJournalUpdater } from '../journal/journal-updater.js';
import { computeStats } from '../journal/journal-reporter.js';
import { formatJournalStatus } from '../journal/journal-formatter.js';
import { JOURNAL_DEFAULTS } from '../journal/journal-types.js';
import type { JournalEntry, EntryStatus } from '../journal/journal-types.js';
import { todayPST } from '../utils/date-utils.js';

// ============================================================
// Dependencies
// ============================================================

export interface JournalCommandDeps {
  dataDir: string;
  cachingProvider: HistoricalDataCache;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Resolve the journal file path from the data directory.
 */
function getJournalPath(dataDir: string): string {
  return path.join(dataDir, JOURNAL_DEFAULTS.JOURNAL_PATH);
}

/**
 * Parse a scan log JSON file and extract signals with active/active_late state.
 */
function extractActiveSignals(logPath: string): { signals: ActiveSignal[]; error?: string } {
  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    const parsed = JSON.parse(content);

    if (!parsed.success || !parsed.data || !Array.isArray(parsed.data.signals)) {
      return { signals: [], error: 'Scan log does not contain valid signal data' };
    }

    const activeSignals: ActiveSignal[] = parsed.data.signals
      .filter((s: any) => s.signal === 'active' || s.signal === 'active_late')
      .map((s: any) => ({
        ticker: s.ticker,
        strategy: s.strategy,
        date: s.date,
        entry: s.entry,
        stop: s.stop,
        risk_pct: s.risk_pct,
        confidence: s.confidence,
        reason: s.reason || [],
      }));

    return { signals: activeSignals };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { signals: [], error: `Failed to read scan log: ${message}` };
  }
}

interface ActiveSignal {
  ticker: string;
  strategy: string;
  date: string;
  entry: number;
  stop: number;
  risk_pct: number;
  confidence: number;
  reason: string[];
}

// ============================================================
// journal:status handler
// ============================================================

/**
 * Create the journal:status command handler.
 * Loads journal entries, computes performance stats, and formats terminal output.
 */
export function createJournalStatusHandler(deps: JournalCommandDeps): CommandHandler {
  const { dataDir } = deps;

  return (_opts: Record<string, string>) => {
    const journalPath = getJournalPath(dataDir);

    // Load journal entries
    const loadResult = load(journalPath);
    if (!loadResult.success) {
      return errorResult('journal-status', 'IO_ERROR', loadResult.error);
    }

    const entries = loadResult.data;

    // Compute stats
    const stats = computeStats(entries);

    // Separate open and closed entries
    const openEntries = entries.filter((e) => e.status === 'open');
    const closedEntries = entries.filter((e) => e.status !== 'open');

    // Format output
    const output = formatJournalStatus({
      open: openEntries,
      stats,
      recentClosed: closedEntries,
    });

    // Print to stdout
    process.stdout.write(output + '\n');

    return successResult('journal-status', {
      total_trades: stats.total_trades,
      open_trades: stats.open_trades,
      closed_trades: stats.closed_trades,
      win_rate: stats.win_rate,
      average_r: stats.average_r,
      total_pnl: stats.total_pnl,
      expectancy: stats.expectancy,
    });
  };
}

// ============================================================
// journal:record handler
// ============================================================

/**
 * Create the journal:record command handler.
 * Reads a scan log JSON file, filters active/active_late signals,
 * and records them as journal entries.
 *
 * Options:
 *   --from <path>  Explicit scan log path (optional; defaults to most recent)
 */
export function createJournalRecordHandler(deps: JournalCommandDeps): CommandHandler {
  const { dataDir } = deps;

  return (_opts: Record<string, string>) => {
    const journalPath = getJournalPath(dataDir);

    // Resolve scan log path
    let logPath: string | null = null;

    if (_opts['from']) {
      logPath = _opts['from'];
      if (!fs.existsSync(logPath)) {
        return errorResult('journal-record', 'FILE_NOT_FOUND',
          `Scan log file not found: ${logPath}`);
      }
    } else {
      logPath = findLatestScanLog(path.join(dataDir, 'logs'), 'large_cap');
      if (!logPath) {
        return errorResult('journal-record', 'FILE_NOT_FOUND',
          `No scan log files found in ${path.join(dataDir, 'logs/')}`);
      }
    }

    // Extract active signals from scan log
    const { signals, error } = extractActiveSignals(logPath);
    if (error) {
      return errorResult('journal-record', 'PARSE_ERROR', error);
    }

    if (signals.length === 0) {
      process.stdout.write('  No active signals found in scan log.\n');
      return successResult('journal-record', {
        recorded: 0,
        skipped: 0,
        source: logPath,
      });
    }

    // Record each active signal
    let recorded = 0;
    let duplicates = 0;
    let maxOpenSkipped = 0;
    const errors: string[] = [];

    for (const signal of signals) {
      const input: RecordInput = {
        ticker: signal.ticker,
        strategy: signal.strategy,
        signal_date: signal.date,
        entry_price: signal.entry,
        stop_price: signal.stop,
        risk_pct: signal.risk_pct,
        confidence: signal.confidence,
        reasons: signal.reason,
      };

      const result = record(input, journalPath);

      if (result.success) {
        recorded++;
      } else {
        if ('code' in result && result.code === 'DUPLICATE') {
          duplicates++;
        } else if ('code' in result && result.code === 'MAX_OPEN') {
          maxOpenSkipped++;
          process.stderr.write(`[WARNING] ${result.error}\n`);
        } else {
          errors.push(result.error);
        }
      }
    }

    // Report results
    const parts: string[] = [];
    if (recorded > 0) parts.push(`${recorded} new entries recorded`);
    if (duplicates > 0) parts.push(`${duplicates} duplicates skipped`);
    if (maxOpenSkipped > 0) parts.push(`${maxOpenSkipped} skipped (max open reached)`);
    if (errors.length > 0) parts.push(`${errors.length} errors`);

    const summary = parts.length > 0 ? parts.join(', ') : 'No changes';
    process.stdout.write(`  Journal record: ${summary}\n`);

    return successResult('journal-record', {
      recorded,
      skipped: duplicates + maxOpenSkipped,
      duplicates,
      maxOpenSkipped,
      errors,
      source: logPath,
    });
  };
}

// ============================================================
// journal:update handler
// ============================================================

/**
 * Create the journal:update command handler.
 * Loads open journal entries, runs the updater against historical price data,
 * persists resolved entries, and reports counts.
 *
 * Options:
 *   --expiry-days <n>  Override default expiry window (default: 42)
 */
export function createJournalUpdateHandler(deps: JournalCommandDeps): CommandHandler {
  const { dataDir, cachingProvider } = deps;

  return async (_opts: Record<string, string>) => {
    const journalPath = getJournalPath(dataDir);

    // ----------------------------------------------------------
    // Manual close path: --close <TICKER> --exit <price>
    // ----------------------------------------------------------
    const closeTicker = _opts['close'];
    const exitArg = _opts['exit'];

    if (closeTicker !== undefined && exitArg !== undefined) {
      const exitPrice = Number(exitArg);
      if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
        return errorResult('journal-update', 'INVALID_PARAM',
          `Invalid --exit value: '${exitArg}'. Must be a positive number.`);
      }

      const ticker = closeTicker.toUpperCase();

      // Load journal
      const loadResult = load(journalPath);
      if (!loadResult.success) {
        return errorResult('journal-update', 'IO_ERROR', loadResult.error);
      }

      const entries = loadResult.data;

      // Find first open entry for this ticker
      const entryIndex = entries.findIndex(
        (e) => e.ticker === ticker && e.status === 'open'
      );
      if (entryIndex === -1) {
        return errorResult('journal-update', 'NOT_FOUND',
          `No open journal entry found for ticker '${ticker}'.`);
      }

      const entry = entries[entryIndex];

      // Determine outcome status: profit = won, loss = lost
      let status: EntryStatus;
      if (exitPrice >= entry.entry_price) {
        status = 'won';
      } else {
        status = 'lost';
      }

      // Mutate entry
      entry.status = status;
      entry.outcome_date = todayPST();
      entry.outcome_price = exitPrice;

      // Save
      const saveResult = save(entries, journalPath);
      if (!saveResult.success) {
        return errorResult('journal-update', 'IO_ERROR', saveResult.error);
      }

      process.stdout.write(`  Journal close: ${ticker} closed at $${exitPrice} → ${status}\n`);

      return successResult('journal-update', {
        closed: 1,
        ticker,
        exit: exitPrice,
        status,
      });
    }

    // ----------------------------------------------------------
    // Auto-update path (existing logic)
    // ----------------------------------------------------------

    // Parse expiry-days option
    let expiryDays: number = JOURNAL_DEFAULTS.EXPIRY_DAYS;
    if (_opts['expiry-days']) {
      const parsed = parseInt(_opts['expiry-days'], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        expiryDays = parsed;
      } else {
        return errorResult('journal-update', 'INVALID_PARAM',
          `Invalid --expiry-days value: '${_opts['expiry-days']}'. Must be a positive integer.`);
      }
    }

    // Load journal entries
    const loadResult = load(journalPath);
    if (!loadResult.success) {
      return errorResult('journal-update', 'IO_ERROR', loadResult.error);
    }

    const entries = loadResult.data;
    const openEntries = entries.filter((e) => e.status === 'open');

    if (openEntries.length === 0) {
      process.stdout.write('  No open entries to update.\n');
      return successResult('journal-update', {
        resolved: 0,
        remaining: 0,
        errors: [],
      });
    }

    // Create updater and run
    const updater = createJournalUpdater({
      cache: cachingProvider,
      expiryDays,
    });

    const updateResult = await updater.update(entries);

    // Persist resolved entries back to journal
    if (updateResult.resolved.length > 0) {
      // Apply resolved entries to the full entries array
      for (const resolved of updateResult.resolved) {
        const index = entries.findIndex((e) => e.id === resolved.id);
        if (index !== -1) {
          entries[index] = resolved;
        }
      }

      const saveResult = save(entries, journalPath);
      if (!saveResult.success) {
        return errorResult('journal-update', 'IO_ERROR', saveResult.error);
      }
    }

    // Report results
    const resolvedCount = updateResult.resolved.length;
    const remainingCount = updateResult.remaining;

    const parts: string[] = [];
    if (resolvedCount > 0) parts.push(`${resolvedCount} resolved`);
    parts.push(`${remainingCount} remaining open`);
    if (updateResult.errors.length > 0) parts.push(`${updateResult.errors.length} errors`);

    process.stdout.write(`  Journal update: ${parts.join(', ')}\n`);

    return successResult('journal-update', {
      resolved: resolvedCount,
      remaining: remainingCount,
      errors: updateResult.errors,
    });
  };
}
