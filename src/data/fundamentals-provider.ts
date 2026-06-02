import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FundamentalData } from '../types.js';
import {
  computeEpsGrowthScore,
  computeEpsAccelerationScore,
  computeRevenueGrowthScore,
  computeEarningsBeatsScore,
  computeFundamentalScore,
  classifyTier,
  defaultFundamentalData,
} from '../indicators/fundamental-scorer.js';

// ============================================================
// Interfaces
// ============================================================

export interface FundamentalsProviderOptions {
  cacheDir?: string;          // default: '.stock-tracker'
  cacheTtlSeconds?: number;   // default: 7_776_000 (90 days)
}

// ============================================================
// Constants
// ============================================================

const DEFAULT_CACHE_DIR = '.stock-tracker';
const DEFAULT_CACHE_TTL_SECONDS = 7_776_000; // 90 days
const CACHE_FILENAME = 'fundamentals-cache.json';

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
// FundamentalsProvider
// ============================================================

export class FundamentalsProvider {
  private readonly cacheDir: string;
  private readonly cacheTtlSeconds: number;
  private readonly yahooFinance: any;

  constructor(options?: FundamentalsProviderOptions, yahooFinanceClient?: any) {
    this.cacheDir = options?.cacheDir ?? DEFAULT_CACHE_DIR;
    this.cacheTtlSeconds = options?.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS;
    this.yahooFinance = yahooFinanceClient ?? getYahooFinance();
  }

  /**
   * Get FundamentalData for a single ticker.
   * Returns cached data if fresh (< 90 days), otherwise fetches from yahoo-finance2.
   * Never throws — returns default FundamentalData on any failure.
   */
  async getFundamentals(ticker: string): Promise<FundamentalData> {
    const normalized = ticker.toUpperCase();

    try {
      const cache = this.readCache();
      const cached = cache[normalized];

      if (cached && this.isFresh(cached)) {
        return cached;
      }

      // Fetch fresh data
      const freshData = await this.fetchAndScore(normalized);

      // Update cache
      if (cached) {
        delete cache[normalized]; // Remove expired entry
      }
      cache[normalized] = freshData;
      this.writeCache(cache);

      return freshData;
    } catch {
      // On any failure, remove expired entry and return default
      try {
        const cache = this.readCache();
        if (cache[normalized]) {
          delete cache[normalized];
          this.writeCache(cache);
        }
      } catch {
        // Ignore cache cleanup failures
      }
      return defaultFundamentalData(normalized);
    }
  }

  /**
   * Build a fundamentalsMap for a list of tickers.
   * Uses cache where possible, fetches only expired/missing entries.
   * Returns the map and any warnings for failed tickers.
   */
  async buildFundamentalsMap(
    tickers: string[]
  ): Promise<{ map: Map<string, FundamentalData>; warnings: string[] }> {
    const map = new Map<string, FundamentalData>();
    const warnings: string[] = [];

    const cache = this.readCache();
    const tickersToFetch: string[] = [];

    // Separate cached vs needs-fetch
    for (const ticker of tickers) {
      const normalized = ticker.toUpperCase();
      const cached = cache[normalized];

      if (cached && this.isFresh(cached)) {
        map.set(normalized, cached);
      } else {
        tickersToFetch.push(normalized);
      }
    }

    // Fetch sequentially (yahoo-finance2 queue concurrency: 1)
    for (const ticker of tickersToFetch) {
      try {
        const freshData = await this.fetchAndScore(ticker);
        cache[ticker] = freshData;
        map.set(ticker, freshData);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`Failed to fetch fundamentals for ${ticker}: ${message}`);
        // Remove expired entry from cache
        if (cache[ticker]) {
          delete cache[ticker];
        }
        const fallback = defaultFundamentalData(ticker);
        map.set(ticker, fallback);
      }
    }

    // Write updated cache if any fetches occurred
    if (tickersToFetch.length > 0) {
      this.writeCache(cache);
    }

    return { map, warnings };
  }

  // ============================================================
  // Internal Methods
  // ============================================================

  /**
   * Read and parse .stock-tracker/fundamentals-cache.json.
   * Returns empty object if file doesn't exist or contains malformed JSON.
   */
  readCache(): Record<string, FundamentalData> {
    try {
      const filePath = path.join(this.cacheDir, CACHE_FILENAME);
      if (!fs.existsSync(filePath)) return {};

      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return {};
      }

      return parsed as Record<string, FundamentalData>;
    } catch {
      // Malformed JSON or read error → treat as empty
      return {};
    }
  }

  /**
   * Atomically write the full cache object to disk.
   * Creates the .stock-tracker directory if absent.
   */
  writeCache(entries: Record<string, FundamentalData>): void {
    try {
      this.ensureCacheDir();
      const filePath = path.join(this.cacheDir, CACHE_FILENAME);
      const tmpPath = filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2), 'utf-8');
      fs.renameSync(tmpPath, filePath);
    } catch {
      // Silently ignore write errors — caching is best-effort
    }
  }

  /**
   * Check if a cache entry is still fresh (fetched_at < cacheTtlSeconds ago).
   */
  isFresh(entry: FundamentalData): boolean {
    try {
      const fetchedAt = new Date(entry.fetched_at).getTime();
      const now = Date.now();
      const elapsedSeconds = (now - fetchedAt) / 1000;
      return elapsedSeconds < this.cacheTtlSeconds;
    } catch {
      return false;
    }
  }

  /**
   * Fetch quoteSummary from yahoo-finance2 with earningsHistory and financialData modules.
   */
  async fetchFromApi(ticker: string): Promise<any> {
    return this.yahooFinance.quoteSummary(ticker, {
      modules: ['earningsHistory', 'financialData'],
    });
  }

  /**
   * Extract raw metrics from yahoo-finance2 quoteSummary response.
   * Returns partial metric values; null for unavailable fields.
   */
  extractMetrics(response: any): {
    epsActuals: (number | null)[];
    surprises: (number | null)[];
    revenueGrowth: number | null;
    profitMargin: number | null;
    earningsQuarters: number;
  } {
    const history: any[] = response?.earningsHistory?.history ?? [];
    const financialData = response?.financialData;

    // Extract epsActual and surprisePercent from earnings history
    const epsActuals: (number | null)[] = history.map(
      (entry: any) => entry?.epsActual ?? null
    );
    const surprises: (number | null)[] = history.map(
      (entry: any) => entry?.surprisePercent ?? null
    );

    // Revenue growth from financialData
    const revenueGrowth: number | null =
      financialData?.revenueGrowth != null ? financialData.revenueGrowth : null;

    // Profit margin from financialData
    const profitMargin: number | null =
      financialData?.profitMargins != null ? financialData.profitMargins : null;

    const earningsQuarters = Math.min(history.length, 8);

    return { epsActuals, surprises, revenueGrowth, profitMargin, earningsQuarters };
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Fetch from API and compute the full scored FundamentalData.
   */
  private async fetchAndScore(ticker: string): Promise<FundamentalData> {
    const response = await this.fetchFromApi(ticker);

    // Validate response has required data
    const hasEarningsHistory =
      response?.earningsHistory?.history &&
      Array.isArray(response.earningsHistory.history) &&
      response.earningsHistory.history.length > 0;

    const hasFinancialData = response?.financialData != null;

    if (!hasEarningsHistory && !hasFinancialData) {
      return defaultFundamentalData(ticker);
    }

    const metrics = this.extractMetrics(response);

    // Compute sub-scores
    const recentEps = metrics.epsActuals[0] ?? null;
    const yearAgoEps = metrics.epsActuals.length > 4 ? (metrics.epsActuals[4] ?? null) : null;
    const epsGrowthScore = computeEpsGrowthScore(recentEps, yearAgoEps);

    // EPS acceleration: compare recent YoY growth vs prior YoY growth
    let recentGrowth: number | null = null;
    let priorGrowth: number | null = null;
    if (
      metrics.epsActuals.length >= 6 &&
      metrics.epsActuals[0] != null &&
      metrics.epsActuals[4] != null &&
      metrics.epsActuals[4] > 0
    ) {
      recentGrowth = ((metrics.epsActuals[0] - metrics.epsActuals[4]) / metrics.epsActuals[4]) * 100;
    }
    if (
      metrics.epsActuals.length >= 6 &&
      metrics.epsActuals[1] != null &&
      metrics.epsActuals[5] != null &&
      metrics.epsActuals[5] > 0
    ) {
      priorGrowth = ((metrics.epsActuals[1] - metrics.epsActuals[5]) / metrics.epsActuals[5]) * 100;
    }
    const epsAccelerationScore = computeEpsAccelerationScore(recentGrowth, priorGrowth);

    // Revenue growth score
    const revenueGrowthScore = computeRevenueGrowthScore(metrics.revenueGrowth);

    // Earnings beats score (last 4 quarters)
    const last4Surprises = metrics.surprises.slice(0, 4);
    const earningsBeatsScore = computeEarningsBeatsScore(last4Surprises);

    // Composite score
    const fundamentalScore = computeFundamentalScore({
      epsGrowth: epsGrowthScore,
      epsAcceleration: epsAccelerationScore,
      revenueGrowth: revenueGrowthScore,
      earningsBeats: earningsBeatsScore,
    });

    // Tier classification
    const fundamentalTier = classifyTier(fundamentalScore);

    // Compute derived metrics for display
    let epsGrowthYoy: number | null = null;
    if (recentEps != null && yearAgoEps != null && yearAgoEps > 0) {
      epsGrowthYoy = ((recentEps - yearAgoEps) / yearAgoEps) * 100;
    }

    const epsAccelerating: boolean | null =
      recentGrowth != null && priorGrowth != null
        ? recentGrowth > priorGrowth + 5
        : null;

    const revenueGrowthYoy: number | null =
      metrics.revenueGrowth != null ? metrics.revenueGrowth * 100 : null;

    // Count beats in last 4 quarters
    const availableSurprises = last4Surprises.filter((s): s is number => s != null);
    const earningsBeats: number | null =
      availableSurprises.length >= 2
        ? availableSurprises.filter(s => s > 0).length
        : null;

    return {
      ticker,
      fetched_at: new Date().toISOString(),
      fundamental_score: fundamentalScore,
      fundamental_tier: fundamentalTier,
      eps_growth_yoy: epsGrowthYoy,
      eps_accelerating: epsAccelerating,
      revenue_growth_yoy: revenueGrowthYoy,
      earnings_beats: earningsBeats,
      earnings_quarters: metrics.earningsQuarters,
      profit_margin: metrics.profitMargin,
    };
  }

  private ensureCacheDir(): void {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    } catch {
      // Ignore if directory already exists or cannot be created
    }
  }
}
