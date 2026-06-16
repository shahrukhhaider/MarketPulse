// ============================================================
// Chart persistence service — writes signal chart PNGs to the
// persistent volume during the daily scan cycle.
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateChartFilename } from './chart-types.js';
import type { ChartResult } from './chart-types.js';

/**
 * Resolve the full filesystem path for a signal chart.
 *
 * @param stockTrackerHome - Base path (e.g., "/data")
 * @param date - Scan date in YYYY-MM-DD format
 * @param ticker - Stock ticker symbol
 * @param strategy - Strategy name
 * @returns Absolute path to the chart PNG file
 */
export function getSignalChartPath(
  stockTrackerHome: string,
  date: string,
  ticker: string,
  strategy: string,
): string {
  const filename = generateChartFilename(ticker, strategy);
  return path.join(stockTrackerHome, '.stock-tracker', 'signal-charts', date, filename);
}

/**
 * Persist chart PNG buffers to the persistent volume.
 * Creates the date directory if needed. Logs warnings on individual failures
 * but never aborts the batch.
 *
 * @param results - Array of ChartResult from generateChartImages()
 * @param date - Scan date in YYYY-MM-DD format
 * @param stockTrackerHome - Base path (e.g., "/data")
 * @returns Count of successfully persisted charts
 */
export function persistChartImages(
  results: ChartResult[],
  date: string,
  stockTrackerHome: string,
): number {
  const dir = path.join(stockTrackerHome, '.stock-tracker', 'signal-charts', date);
  fs.mkdirSync(dir, { recursive: true });

  let persisted = 0;
  const total = results.length;

  for (const result of results) {
    if (!result.success) {
      continue;
    }

    const filePath = getSignalChartPath(stockTrackerHome, date, result.ticker, result.strategy);

    try {
      fs.writeFileSync(filePath, result.pngBuffer);
      persisted++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[chart-persistence] Warning: failed to write chart for ${result.ticker} ${result.strategy}: ${message}\n`,
      );
    }
  }

  process.stdout.write(`[chart-persistence] ${persisted} of ${total} charts persisted\n`);
  return persisted;
}
