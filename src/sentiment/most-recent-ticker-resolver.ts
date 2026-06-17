import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEntries } from '../signal-history/ndjson.js';

export interface ResolvedTicker {
  ticker: string;
  strategy: string;
}

/**
 * Reads both signal-history.ndjson and signal-history-tech.ndjson,
 * finds the most recent entry in each, and extracts tickers from the
 * `active` arrays only.
 *
 * Returns deduplicated uppercase tickers with their strategy.
 * Skips files that are missing or unparseable.
 */
export function resolveMostRecentActiveTickers(dataDir: string): ResolvedTicker[] {
  const files = [
    join(dataDir, 'signal-history.ndjson'),
    join(dataDir, 'signal-history-tech.ndjson'),
  ];

  const seen = new Map<string, string>(); // uppercase ticker → strategy

  for (const filePath of files) {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      // File missing or unreadable — skip gracefully
      continue;
    }

    const entries = parseEntries(content);
    if (entries.length === 0) {
      continue;
    }

    // Sort by date descending to find the most recent entry
    entries.sort((a, b) => b.date.localeCompare(a.date));
    const mostRecent = entries[0];

    for (const signal of mostRecent.active) {
      const key = signal.ticker.toUpperCase();
      if (!seen.has(key)) {
        seen.set(key, signal.strategy);
      }
    }
  }

  // Build result sorted alphabetically by ticker
  const result: ResolvedTicker[] = [];
  for (const [ticker, strategy] of seen) {
    result.push({ ticker, strategy });
  }

  result.sort((a, b) => a.ticker.localeCompare(b.ticker));
  return result;
}
