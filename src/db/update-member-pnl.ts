import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAllOpenTrades, updateLastPrice } from './database.js';

/**
 * Finds the most recent scan JSON file matching a given prefix in the logs directory.
 */
function findMostRecentScanFile(logsDir: string, prefix: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(logsDir);
  } catch {
    return null;
  }

  const matches = entries
    .filter((f) => {
      if (!f.startsWith(prefix) || !f.endsWith('.json')) return false;
      if (prefix === 'scan_' && f.startsWith('scan_tech_')) return false;
      return true;
    })
    .sort()
    .reverse();

  return matches.length > 0 ? path.join(logsDir, matches[0]) : null;
}

/**
 * Extracts a price map (ticker → price) from the most recent scan JSONs.
 * Uses the `entry` field from active signal entries in data.signals[].
 */
function buildScanPriceMap(logsDir: string): Map<string, number> {
  const priceMap = new Map<string, number>();

  for (const prefix of ['scan_', 'scan_tech_']) {
    const filePath = findMostRecentScanFile(logsDir, prefix);
    if (!filePath) continue;

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const json = JSON.parse(raw);
      const signals: Array<{ ticker: string; signal: string; entry?: number; close?: number }> =
        json?.data?.signals ?? [];

      for (const sig of signals) {
        if (!sig.ticker) continue;
        const ticker = sig.ticker.toUpperCase();
        // Prefer close if present, otherwise use entry
        const price = sig.close ?? sig.entry;
        if (typeof price === 'number' && price > 0) {
          priceMap.set(ticker, price);
        }
      }
    } catch {
      // Skip unreadable scan files
    }
  }

  return priceMap;
}

/**
 * Falls back to OHLCV history cache for a ticker's last close price.
 */
function getHistoryCachePrice(baseDir: string, ticker: string): number | null {
  const cachePath = path.join(baseDir, '.stock-tracker', 'history-cache', `${ticker}.json`);

  try {
    const raw = fs.readFileSync(cachePath, 'utf-8');
    const json = JSON.parse(raw);
    const dataPoints: Array<{ close?: number }> = json?.dataPoints ?? [];

    if (dataPoints.length === 0) return null;

    const lastEntry = dataPoints[dataPoints.length - 1];
    if (typeof lastEntry.close === 'number' && lastEntry.close > 0) {
      return lastEntry.close;
    }
  } catch {
    // File doesn't exist or is malformed
  }

  return null;
}

/**
 * Updates last_price for all open member trades using the most recent scan data
 * or OHLCV history cache as a fallback. Never throws — all errors are logged.
 */
export async function updateMemberTradePnL(): Promise<void> {
  try {
    const baseDir = process.env.STOCK_TRACKER_HOME ?? process.cwd();
    const logsDir = path.join(baseDir, '.stock-tracker', 'logs');

    const trades = await getAllOpenTrades();
    if (trades.length === 0) return;

    const scanPriceMap = buildScanPriceMap(logsDir);

    for (const trade of trades) {
      try {
        const ticker = trade.ticker.toUpperCase();

        // Try scan price first
        let price = scanPriceMap.get(ticker) ?? null;

        // Fall back to history cache
        if (price === null) {
          price = getHistoryCachePrice(baseDir, ticker);
        }

        if (price !== null) {
          await updateLastPrice(trade.id, price);
        } else {
          console.warn(`[updateMemberTradePnL] No price found for ${ticker}, skipping`);
        }
      } catch (err) {
        console.warn(
          `[updateMemberTradePnL] Error updating trade ${trade.id} (${trade.ticker}):`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  } catch (err) {
    console.warn(
      '[updateMemberTradePnL] Failed to update member trade P&L:',
      err instanceof Error ? err.message : String(err),
    );
  }
}
