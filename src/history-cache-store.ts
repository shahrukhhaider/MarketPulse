import fs from 'node:fs';
import path from 'node:path';
import type {
  HistoricalDataPoint,
  HistoricalInterval,
  HistoricalPeriod,
} from './types.js';
import { VALID_PERIODS, VALID_INTERVALS } from './types.js';

// ============================================================
// Cache Entry Interface
// ============================================================

export interface CacheEntry {
  ticker: string;
  period: HistoricalPeriod;
  interval: HistoricalInterval;
  fetchedAt: string; // ISO 8601 timestamp
  dataPoints: HistoricalDataPoint[];
}

// ============================================================
// Cache Key Utilities
// ============================================================

export function normalizeTicker(ticker: string): string {
  return ticker.toUpperCase();
}

export function cacheKey(ticker: string, period: HistoricalPeriod): string {
  return `${normalizeTicker(ticker)}_${period}`;
}

export function isExpired(entry: CacheEntry, ttlMs: number): boolean {
  return Date.now() - Date.parse(entry.fetchedAt) > ttlMs;
}

// ============================================================
// Cache Entry Validation
// ============================================================

export function validateCacheEntry(parsed: unknown): parsed is CacheEntry {
  if (typeof parsed !== 'object' || parsed === null) return false;

  const obj = parsed as Record<string, unknown>;

  // ticker must be a non-empty string
  if (typeof obj.ticker !== 'string' || obj.ticker.length === 0) return false;

  // period must be a valid HistoricalPeriod
  if (
    typeof obj.period !== 'string' ||
    !VALID_PERIODS.includes(obj.period as HistoricalPeriod)
  )
    return false;

  // interval must be a valid HistoricalInterval
  if (
    typeof obj.interval !== 'string' ||
    !VALID_INTERVALS.includes(obj.interval as HistoricalInterval)
  )
    return false;

  // fetchedAt must be a valid ISO 8601 timestamp
  if (typeof obj.fetchedAt !== 'string' || isNaN(Date.parse(obj.fetchedAt)))
    return false;

  // dataPoints must be an array of valid data points
  if (!Array.isArray(obj.dataPoints)) return false;

  for (const dp of obj.dataPoints) {
    if (typeof dp !== 'object' || dp === null) return false;
    const point = dp as Record<string, unknown>;
    if (typeof point.date !== 'string') return false;
    if (typeof point.open !== 'number') return false;
    if (typeof point.high !== 'number') return false;
    if (typeof point.low !== 'number') return false;
    if (typeof point.close !== 'number') return false;
    if (typeof point.volume !== 'number') return false;
  }

  return true;
}

// ============================================================
// History Cache Store
// ============================================================

export class HistoryCacheStore {
  constructor(private readonly cacheDir: string) {}

  filePath(ticker: string, period: HistoricalPeriod): string {
    return path.join(this.cacheDir, cacheKey(ticker, period) + '.json');
  }

  ensureDir(): void {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    } catch (err) {
      console.warn('Failed to create cache directory:', err);
    }
  }

  read(ticker: string, period: HistoricalPeriod): CacheEntry | null {
    try {
      const fp = this.filePath(ticker, period);
      const raw = fs.readFileSync(fp, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (!validateCacheEntry(parsed)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  write(entry: CacheEntry): boolean {
    try {
      this.ensureDir();
      const fp = this.filePath(entry.ticker, entry.period);
      fs.writeFileSync(fp, JSON.stringify(entry, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.warn('Failed to write cache entry:', err);
      return false;
    }
  }

  clear(ticker?: string): number {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        return 0;
      }
      const files = fs.readdirSync(this.cacheDir);
      let removed = 0;
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        if (ticker) {
          const prefix = normalizeTicker(ticker) + '_';
          if (!file.startsWith(prefix)) continue;
        }
        try {
          fs.unlinkSync(path.join(this.cacheDir, file));
          removed++;
        } catch (err) {
          console.warn('Failed to delete cache file:', file, err);
        }
      }
      return removed;
    } catch (err) {
      console.warn('Failed to clear cache:', err);
      return 0;
    }
  }
}
