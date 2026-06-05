// ============================================================
// Ticker Resolution — shared utility for resolving ticker arguments
// ============================================================
// Combines logic from scan-command.ts and tune-command.ts into a single
// canonical implementation. Handles:
//   - undefined/empty string → default to watchlist (tune-command behavior)
//   - 'watchlist'/'top100' keywords → load universe-resolved watchlist JSON
//   - comma-separated string → split, trim, uppercase, filter empty
// ============================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Resolve a ticker argument into a list of uppercase ticker symbols.
 *
 * @param tickersArg - The raw --tickers flag value (undefined when not provided)
 * @param dataDir - Base data directory (e.g. '.stock-tracker')
 * @param watchlistFile - Watchlist JSON filename within dataDir/data/ (default: 'watchlist.json')
 * @returns Array of uppercase ticker symbols, or an error object
 */
export function resolveTickerList(
  tickersArg: string | undefined,
  dataDir: string,
  watchlistFile: string = 'watchlist.json',
): string[] | { error: string } {
  // When --tickers is not provided, empty, 'watchlist', or 'top100', load from watchlist file
  if (
    tickersArg === undefined ||
    tickersArg === '' ||
    tickersArg.toLowerCase() === 'watchlist' ||
    tickersArg.toLowerCase() === 'top100'
  ) {
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

  // Explicit comma-separated ticker list — split, trim, uppercase, filter empty
  return tickersArg.split(',').map(t => t.trim().toUpperCase()).filter(t => t.length > 0);
}
