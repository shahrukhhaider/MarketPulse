import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Result } from './config-store.js';

// ============================================================
// Interfaces
// ============================================================

export interface EarningsDateResult {
  ticker: string;
  dates: string[]; // ISO 8601 date strings (YYYY-MM-DD), sorted ascending
}

export interface EarningsDateProviderOptions {
  cacheDurationHours?: number; // default 24, range [1/60, 168]
  cacheDir?: string;
}

interface EarningsCacheEntry {
  ticker: string;
  fetchedAt: string; // ISO 8601 timestamp
  dates: string[];
}

// ============================================================
// Constants
// ============================================================

const DEFAULT_CACHE_DURATION_HOURS = 24;
const MIN_CACHE_DURATION_HOURS = 1 / 60; // 1 minute
const MAX_CACHE_DURATION_HOURS = 168; // 7 days
const MAX_EARNINGS_DATES = 100;
const DEFAULT_CACHE_DIR = '.stock-tracker/earnings';

// ============================================================
// Yahoo Finance Lazy Loader
// ============================================================

let _yahooFinance: any;
function getYahooFinance(): any {
  if (!_yahooFinance) {
    const YahooFinanceModule = require('yahoo-finance2').default ?? require('yahoo-finance2');
    try {
      _yahooFinance = new (YahooFinanceModule as any)();
    } catch {
      _yahooFinance = YahooFinanceModule;
    }
    try {
      (_yahooFinance as any).setGlobalConfig?.({ queue: { concurrency: 1 } });
    } catch {
      // Ignore if setGlobalConfig is not available
    }
  }
  return _yahooFinance;
}

// ============================================================
// EarningsDateProvider
// ============================================================

export class EarningsDateProvider {
  private readonly cacheDurationHours: number;
  private readonly cacheDir: string;
  private readonly yahooFinance: any;

  constructor(options?: EarningsDateProviderOptions, yahooFinanceClient?: any) {
    this.cacheDurationHours = clampCacheDuration(
      options?.cacheDurationHours ?? DEFAULT_CACHE_DURATION_HOURS
    );
    this.cacheDir = options?.cacheDir ?? DEFAULT_CACHE_DIR;
    this.yahooFinance = yahooFinanceClient ?? getYahooFinance();
  }

  /**
   * Fetch earnings dates for a ticker. Returns cached data if fresh.
   * Never throws — returns Result with empty dates array on valid ticker with no data,
   * or error result on API failure.
   */
  async getEarningsDates(ticker: string): Promise<Result<EarningsDateResult>> {
    const normalized = ticker.toUpperCase();

    try {
      // Check cache first
      const cached = this.readCache(normalized);
      if (cached !== null) {
        return { success: true, data: { ticker: normalized, dates: cached.dates } };
      }

      // Fetch from API
      const dates = await this.fetchFromApi(normalized);

      // Sort ascending and cap at 100
      const sorted = dates.sort((a, b) => a.localeCompare(b));
      const capped = sorted.slice(0, MAX_EARNINGS_DATES);

      // Write to cache
      this.writeCache(normalized, capped);

      return { success: true, data: { ticker: normalized, dates: capped } };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `PRICE_FEED_UNAVAILABLE: Failed to fetch earnings dates for '${normalized}': ${message}`,
      };
    }
  }

  /**
   * Synchronously read earnings dates from cache only (no API call).
   * Returns the cached dates array if fresh, or an empty array if cache is missing/expired.
   * Use this in synchronous contexts (e.g., signal detection, backtest) where async is not possible.
   */
  getEarningsDatesFromCache(ticker: string): string[] {
    const normalized = ticker.toUpperCase();
    const cached = this.readCache(normalized);
    return cached ? cached.dates : [];
  }

  /**
   * Invalidate cached earnings dates for a ticker.
   */
  clearCache(ticker: string): void {
    const normalized = ticker.toUpperCase();
    const filePath = this.cacheFilePath(normalized);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Silently ignore deletion errors
    }
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private cacheFilePath(ticker: string): string {
    return path.join(this.cacheDir, `${ticker}.json`);
  }

  private readCache(ticker: string): EarningsCacheEntry | null {
    try {
      const filePath = this.cacheFilePath(ticker);
      if (!fs.existsSync(filePath)) return null;

      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);

      if (!isValidCacheEntry(parsed)) return null;

      const entry = parsed as EarningsCacheEntry;

      // Check if cache is still fresh
      const fetchedAt = new Date(entry.fetchedAt).getTime();
      const now = Date.now();
      const maxAgeMs = this.cacheDurationHours * 60 * 60 * 1000;

      if (now - fetchedAt > maxAgeMs) {
        return null; // Cache expired
      }

      return entry;
    } catch {
      return null; // Corrupted or unreadable cache
    }
  }

  private writeCache(ticker: string, dates: string[]): void {
    try {
      this.ensureCacheDir();
      const entry: EarningsCacheEntry = {
        ticker,
        fetchedAt: new Date().toISOString(),
        dates,
      };
      const filePath = this.cacheFilePath(ticker);
      const tmpPath = filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(entry, null, 2), 'utf-8');
      fs.renameSync(tmpPath, filePath);
    } catch {
      // Silently ignore write errors — caching is best-effort
    }
  }

  private ensureCacheDir(): void {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    } catch {
      // Ignore if directory already exists or cannot be created
    }
  }

  private async fetchFromApi(ticker: string): Promise<string[]> {
    const result = await this.yahooFinance.quoteSummary(ticker, {
      modules: ['earningsHistory', 'calendarEvents'],
    });

    const dates: Set<string> = new Set();

    // Extract from earningsHistory
    if (result?.earningsHistory?.history) {
      for (const entry of result.earningsHistory.history) {
        const date = extractDate(entry?.quarter);
        if (date) dates.add(date);
      }
    }

    // Extract from calendarEvents
    if (result?.calendarEvents?.earnings?.earningsDate) {
      for (const dateVal of result.calendarEvents.earnings.earningsDate) {
        const date = extractDate(dateVal);
        if (date) dates.add(date);
      }
    }

    return Array.from(dates);
  }
}

// ============================================================
// Helper Functions
// ============================================================

function clampCacheDuration(hours: number): number {
  if (hours < MIN_CACHE_DURATION_HOURS) return MIN_CACHE_DURATION_HOURS;
  if (hours > MAX_CACHE_DURATION_HOURS) return MAX_CACHE_DURATION_HOURS;
  return hours;
}

function isValidCacheEntry(obj: unknown): obj is EarningsCacheEntry {
  if (typeof obj !== 'object' || obj === null) return false;
  const record = obj as Record<string, unknown>;
  if (typeof record.ticker !== 'string') return false;
  if (typeof record.fetchedAt !== 'string') return false;
  if (isNaN(Date.parse(record.fetchedAt))) return false;
  if (!Array.isArray(record.dates)) return false;
  for (const d of record.dates) {
    if (typeof d !== 'string') return false;
  }
  return true;
}

/**
 * Extract an ISO date string (YYYY-MM-DD) from a Date object, string, or timestamp.
 */
function extractDate(value: unknown): string | null {
  if (value == null) return null;

  if (value instanceof Date) {
    return toISODateString(value);
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) return null;
    return toISODateString(parsed);
  }

  if (typeof value === 'number') {
    const parsed = new Date(value * 1000); // Unix timestamp in seconds
    if (isNaN(parsed.getTime())) return null;
    return toISODateString(parsed);
  }

  // yahoo-finance2 sometimes returns objects with a `raw` or `fmt` field
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj.fmt && typeof obj.fmt === 'string') {
      return extractDate(obj.fmt);
    }
    if (obj.raw != null) {
      return extractDate(obj.raw);
    }
  }

  return null;
}

function toISODateString(date: Date): string {
  return date.toISOString().split('T')[0];
}
