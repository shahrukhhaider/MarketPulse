// ============================================================
// Price Map Builder — Reads history-cache to build ticker→price map
// ============================================================
// Extracts the latest close price for each ticker from the
// .stock-tracker/history-cache/ directory. Used by both the
// API routes and the winning-trades command.
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Builds a map of ticker → latest close price from history-cache files.
 *
 * Reads all JSON files from `{dataDir}/.stock-tracker/history-cache/`,
 * extracts the last `close` value from each file's data points array.
 * Falls back to the latest scan log files for tickers not found in the cache.
 *
 * @param dataDir - The base directory (typically the user's home or stockTrackerHome)
 *                  containing the `.stock-tracker` folder.
 * @returns A Map where keys are uppercase ticker symbols and values are the latest close prices.
 */
export function buildPriceMapFromCache(dataDir: string): Map<string, number> {
  const priceMap = new Map<string, number>();

  // Primary source: history-cache contains the latest close prices for each ticker
  const cacheDir = path.join(dataDir, '.stock-tracker', 'history-cache');
  try {
    const cacheFiles = fs.readdirSync(cacheDir);
    for (const file of cacheFiles) {
      if (!file.endsWith('.json')) continue;
      const ticker = file.replace('.json', '').toUpperCase();
      try {
        const raw = fs.readFileSync(path.join(cacheDir, file), 'utf-8');
        const data = JSON.parse(raw);
        const points: Array<{ close: number }> = data.dataPoints ?? data.quotes ?? data;
        if (!Array.isArray(points) || points.length === 0) continue;
        const lastClose = points[points.length - 1].close;
        if (typeof lastClose === 'number' && lastClose > 0) {
          priceMap.set(ticker, lastClose);
        }
      } catch (err) {
        console.warn(
          `[price-map] Failed to read history-cache for ${ticker}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  } catch (err) {
    console.warn(
      '[price-map] Unable to read history-cache directory:',
      err instanceof Error ? err.message : String(err),
    );
  }

  // Secondary source: latest scan log files for tickers not in history-cache
  const logsDir = path.join(dataDir, '.stock-tracker', 'logs');
  let entries: string[];
  try {
    entries = fs.readdirSync(logsDir);
  } catch {
    return priceMap;
  }

  for (const prefix of ['scan_', 'scan_tech_']) {
    const matches = entries
      .filter((f) => {
        if (!f.startsWith(prefix) || !f.endsWith('.json')) return false;
        if (prefix === 'scan_' && f.startsWith('scan_tech_')) return false;
        return true;
      })
      .sort()
      .reverse();

    if (matches.length === 0) continue;

    try {
      const raw = fs.readFileSync(path.join(logsDir, matches[0]), 'utf-8');
      const json = JSON.parse(raw);
      const signals: Array<{ ticker: string; signal: string; close?: number; entry?: number }> =
        json?.data?.signals ?? [];

      for (const sig of signals) {
        if (!sig.ticker) continue;
        const ticker = sig.ticker.toUpperCase();
        if (priceMap.has(ticker)) continue; // history-cache already has a price
        const price = sig.close ?? sig.entry;
        if (typeof price === 'number' && price > 0) {
          priceMap.set(ticker, price);
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return priceMap;
}
