import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { SentimentBand } from '../data/stocktwits-provider.js';

/**
 * A single entry in the sentiment cache, representing per-ticker
 * sentiment data and top headlines for bot consumption.
 */
export interface SentimentCacheEntry {
  ticker: string;
  fetched_at: string;
  band: SentimentBand;
  st_bullish_count: number;
  st_bearish_count: number;
  st_message_volume: number;
  top_headlines: Array<{
    title: string;
    url: string;
    source_domain: string;
    published_at: string;
  }>;
}

const CACHE_FILE = 'sentiment-cache.json';

/**
 * Writes sentiment cache entries to `.stock-tracker/sentiment-cache.json`
 * as a JSON object keyed by ticker symbol.
 *
 * Creates the `.stock-tracker/` directory if it doesn't exist.
 * Logs a warning to stderr on write failure but does NOT throw.
 *
 * @param dataDir - The base directory containing `.stock-tracker/`
 * @param entries - Array of sentiment cache entries to persist
 */
export function writeSentimentCache(dataDir: string, entries: SentimentCacheEntry[]): void {
  const filePath = join(dataDir, '.stock-tracker', CACHE_FILE);

  const record: Record<string, SentimentCacheEntry> = {};
  for (const entry of entries) {
    record[entry.ticker] = entry;
  }

  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
  } catch (err) {
    console.error(
      `[sentiment-cache] Warning: failed to write ${filePath}:`,
      err instanceof Error ? err.message : err
    );
  }
}
