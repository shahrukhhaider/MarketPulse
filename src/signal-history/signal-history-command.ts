// ============================================================
// Signal History CLI Command
// ============================================================
// Reads scan output JSON, extracts a SignalEntry, and upserts it
// into the signal-history.ndjson file.
//
// Usage: cli.js signal-history --scan-output <path>
//
// All errors are non-fatal: logged to stderr, exits 0.
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import { extractSignalEntry } from './extractor.js';
import type { ScanOutput } from './extractor.js';
import { upsertSignalEntry } from './upsert.js';
import { resolveUniverse, resolveSignalHistoryFile } from '../utils/universe.js';
import type { UniverseValue } from '../utils/universe.js';

// ============================================================
// Dependencies
// ============================================================

export interface SignalHistoryCommandDeps {
  dataDir: string;
}

// ============================================================
// createSignalHistoryHandler
// ============================================================

/**
 * Create the signal-history command handler.
 *
 * Accepts --scan-output <path> pointing to the scan output JSON file.
 * Reads/parses the file, skips single-ticker runs, extracts a SignalEntry,
 * and upserts it into signal-history.ndjson.
 *
 * All failures are non-fatal: logged to stderr, returns success with
 * a skip/error message so the daily-scan workflow continues.
 */
export function createSignalHistoryHandler(deps: SignalHistoryCommandDeps): CommandHandler {
  const { dataDir } = deps;

  return (opts: Record<string, string>) => {
    const scanOutputPath = opts['scan-output'];

    // Resolve --universe flag (defaults to large_cap)
    const universeResult = resolveUniverse(opts['universe']);
    if ('error' in universeResult) {
      process.stderr.write(`[signal-history] Error: ${universeResult.error}\n`);
      return errorResult('signal-history', 'INVALID_PARAM_RANGE', universeResult.error);
    }
    const historyFilename = resolveSignalHistoryFile(opts['universe'] as UniverseValue ?? 'large_cap');

    // --scan-output is required
    if (!scanOutputPath) {
      process.stderr.write('[signal-history] Error: --scan-output argument is required\n');
      return errorResult('signal-history', 'MISSING_PARAM', '--scan-output argument is required');
    }

    // Read the scan output file
    let rawContent: string;
    try {
      rawContent = fs.readFileSync(scanOutputPath, 'utf-8');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[signal-history] Error: Cannot read scan output file: ${message}\n`);
      return successResult('signal-history', { skipped: true, reason: `Cannot read scan output file: ${message}` });
    }

    // Check for empty file
    if (!rawContent.trim()) {
      process.stderr.write('[signal-history] Error: Scan output file is empty\n');
      return successResult('signal-history', { skipped: true, reason: 'Scan output file is empty' });
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[signal-history] Error: Invalid JSON in scan output: ${message}\n`);
      return successResult('signal-history', { skipped: true, reason: `Invalid JSON in scan output: ${message}` });
    }

    // The scan output file is a CommandResult envelope: { success, command, data, timestamp }
    // Extract the data payload which contains the actual scan output
    const envelope = parsed as { success?: boolean; data?: Record<string, unknown> };
    const scanData = envelope.data ?? (parsed as Record<string, unknown>);

    // Skip single-ticker runs (requirement 2.8)
    // The scan command sets `total` to the number of tickers scanned.
    // A single-ticker run has total === 1.
    const total = typeof scanData.total === 'number' ? scanData.total : 0;
    if (total <= 1) {
      process.stderr.write(`[signal-history] Skipping: single-ticker run (total=${total})\n`);
      return successResult('signal-history', { skipped: true, reason: 'Single-ticker scan run' });
    }

    // Build the ScanOutput structure expected by the extractor
    const scanOutput: ScanOutput = {
      signals: Array.isArray(scanData.signals) ? scanData.signals : [],
      regime: scanData.regime as ScanOutput['regime'],
      marketRegime: scanData.marketRegime as ScanOutput['marketRegime'],
      openPositions: Array.isArray(scanData.openPositions) ? scanData.openPositions : [],
    };

    // Extract the SignalEntry for today's date
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const entry = extractSignalEntry(scanOutput, today);

    // Upsert into universe-specific signal history file
    const historyPath = path.join(dataDir, historyFilename);
    const result = upsertSignalEntry({ historyPath, entry });

    if (!result.success) {
      process.stderr.write(`[signal-history] Error: Upsert failed: ${result.error}\n`);
      return successResult('signal-history', { skipped: true, reason: `Upsert failed: ${result.error}` });
    }

    const action = result.created ? 'created' : result.replaced ? 'replaced' : 'appended';
    return successResult('signal-history', {
      success: true,
      date: entry.date,
      action,
      activeCount: entry.active.length,
      nearCount: entry.near.length,
      openPositionsCount: entry.open_positions.length,
    });
  };
}
