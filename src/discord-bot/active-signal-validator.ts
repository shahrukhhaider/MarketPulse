import * as fs from 'node:fs';
import * as path from 'node:path';
import { findLatestScanLog } from '../scan-types.js';

/**
 * In-memory cache for active ticker set.
 * Avoids re-reading scan files on every interaction.
 */
let cache: { tickers: Set<string>; cachedAt: number } | null = null;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Returns the base data directory where scan logs are stored.
 */
function getLogsDir(): string {
  const base = process.env.STOCK_TRACKER_HOME ?? process.cwd();
  return path.join(base, '.stock-tracker', 'logs');
}

/**
 * Extracts active tickers from a scan JSON file.
 * Active signals are entries in data.signals[] where signal === "active".
 */
function extractActiveTickers(filePath: string): string[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(raw);
    const signals: Array<{ ticker: string; signal: string }> = json?.data?.signals ?? [];
    return signals
      .filter((s) => s.signal === 'active')
      .map((s) => s.ticker.toUpperCase());
  } catch {
    return [];
  }
}

/**
 * Loads the set of active tickers from the most recent scan files,
 * using the in-memory cache when fresh.
 */
function loadActiveTickers(): Set<string> | null {
  // Return cached result if still fresh
  if (cache && Date.now() - cache.cachedAt < CACHE_TTL_MS) {
    return cache.tickers;
  }

  const logsDir = getLogsDir();

  const largeCap = findLatestScanLog(logsDir, 'large_cap');
  const tech = findLatestScanLog(logsDir, 'tech');

  // If neither file exists, return null to signal "no data"
  if (!largeCap && !tech) {
    return null;
  }

  const tickers = new Set<string>();

  if (largeCap) {
    for (const t of extractActiveTickers(largeCap)) {
      tickers.add(t);
    }
  }

  if (tech) {
    for (const t of extractActiveTickers(tech)) {
      tickers.add(t);
    }
  }

  cache = { tickers, cachedAt: Date.now() };
  return tickers;
}

/**
 * Validates whether a ticker has an active signal in the most recent scan.
 *
 * Returns `{ valid: true }` when the ticker is found,
 * or `{ valid: false, error: string }` with a user-facing message.
 */
export async function validateActiveTicker(
  ticker: string,
): Promise<{ valid: true } | { valid: false; error: string }> {
  const activeTickers = loadActiveTickers();

  if (activeTickers === null) {
    return {
      valid: false,
      error: 'No scan data available yet — signals are posted after 4:30 PM ET.',
    };
  }

  const upper = ticker.toUpperCase();

  if (!activeTickers.has(upper)) {
    return {
      valid: false,
      error: `No active signal for ${upper} in today's scan. Only active signals can be logged.`,
    };
  }

  return { valid: true };
}
