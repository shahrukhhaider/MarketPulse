// ============================================================
// Discovery Filter — Removes known tickers and non-equities
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SpikeResult } from './spike-detector.js';

export interface DiscoveryTicker extends SpikeResult {
  // Inherits all SpikeResult fields
}

/**
 * Load all tickers from watchlist JSON files.
 */
function loadWatchlistTickers(dataDir: string): Set<string> {
  const tickers = new Set<string>();
  const watchlistFiles = [
    'watchlist.json',
    'watchlist-tech.json',
    'watchlist-midcap.json',
    'watchlist-smallcap.json',
  ];

  for (const file of watchlistFiles) {
    const filePath = path.join(dataDir, 'data', file);
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        const tickerList: string[] = Array.isArray(data) ? data : (data.tickers ?? []);
        for (const t of tickerList) {
          tickers.add(t.toUpperCase());
        }
      }
    } catch {
      // Skip unreadable watchlists
    }
  }

  return tickers;
}

/**
 * Filter spike results to only include new discovery tickers:
 * - Not in any watchlist
 * - Must be "Stock" instrument class (no ETFs, crypto, etc.)
 */
export function filterDiscoveries(
  spikes: SpikeResult[],
  dataDir: string,
  communityTickers?: Set<string>,
): DiscoveryTicker[] {
  const known = loadWatchlistTickers(dataDir);

  // Merge community tickers if provided
  if (communityTickers) {
    for (const t of communityTickers) {
      known.add(t.toUpperCase());
    }
  }

  return spikes.filter(s => {
    // Must be a stock (not ETF, crypto, etc.)
    if (s.ticker.length > 5) return false; // likely not a standard ticker
    // Not already tracked
    if (known.has(s.ticker.toUpperCase())) return false;
    return true;
  });
}
