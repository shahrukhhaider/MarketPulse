// ============================================================
// Regime Detector — Market-state classification orchestrator
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { HistoricalDataPoint } from './types.js';
import type { HistoricalDataCache } from './historical-data-cache.js';
import type { SuperTrendParams } from './supertrend.js';
import { computeSuperTrend } from './supertrend.js';
import { atr, adx } from './indicators.js';

// ============================================================
// Types
// ============================================================

export type TickerRegime = 'bullish' | 'bearish' | 'unknown';
export type MarketRegime = 'bullish' | 'bearish' | 'neutral' | 'unknown';
export type VolatilityRegime = 'high' | 'low' | 'normal' | 'unknown';
export type TrendStrength = 'strong' | 'moderate' | 'weak' | 'unknown';

export interface RegimeState {
  ticker: string;
  ticker_regime: TickerRegime;
  market_regime: MarketRegime;
  volatility_regime: VolatilityRegime;
  trend_strength: TrendStrength;
  regime_score: number;  // 0–100
  warnings: string[];
}

export interface RegimeDetectorOptions {
  cachingProvider: HistoricalDataCache;
  superTrendParams?: Partial<SuperTrendParams>;
  cacheDir: string;  // path to store regime-cache.json
}

export interface RegimeResult {
  market: {
    spy_trend: 1 | -1 | null;
    qqq_trend: 1 | -1 | null;
    market_regime: MarketRegime;
  };
  tickers: RegimeState[];
  cachedAt: string;  // ISO date (YYYY-MM-DD)
  warnings: string[];
}

// ============================================================
// Internal cache file structure
// ============================================================

interface RegimeCacheFile {
  date: string;           // YYYY-MM-DD
  computedAt: string;     // ISO 8601 timestamp
  market: {
    spy_trend: 1 | -1 | null;
    qqq_trend: 1 | -1 | null;
    market_regime: MarketRegime;
  };
  tickers: RegimeState[];
  warnings: string[];
}

// ============================================================
// Score tables
// ============================================================

const TICKER_REGIME_POINTS: Record<TickerRegime, number> = {
  bullish: 40,
  bearish: 0,
  unknown: 0,
};

const MARKET_REGIME_POINTS: Record<MarketRegime, number> = {
  bullish: 25,
  neutral: 12,
  bearish: 0,
  unknown: 0,
};

const VOLATILITY_REGIME_POINTS: Record<VolatilityRegime, number> = {
  normal: 20,
  low: 15,
  high: 5,
  unknown: 0,
};

const TREND_STRENGTH_POINTS: Record<TrendStrength, number> = {
  strong: 15,
  moderate: 10,
  weak: 0,
  unknown: 0,
};

const TICKER_REGIME_MAX = 40;
const MARKET_REGIME_MAX = 25;
const VOLATILITY_REGIME_MAX = 20;
const TREND_STRENGTH_MAX = 15;

// ============================================================
// RegimeDetector class
// ============================================================

export class RegimeDetector {
  private readonly cache: HistoricalDataCache;
  private readonly superTrendParams: Partial<SuperTrendParams> | undefined;
  private readonly cacheDir: string;
  private readonly cacheFilePath: string;

  constructor(options: RegimeDetectorOptions) {
    this.cache = options.cachingProvider;
    this.superTrendParams = options.superTrendParams;
    this.cacheDir = options.cacheDir;
    this.cacheFilePath = path.join(options.cacheDir, 'regime-cache.json');
  }

  /**
   * Run regime detection for a list of tickers.
   * Returns cached result if same-day cache exists.
   */
  async detect(tickers: string[]): Promise<RegimeResult> {
    // Try to read day-level cache
    const cached = this.readCache();
    if (cached) {
      return cached;
    }

    return this.detectFresh(tickers);
  }

  /**
   * Force fresh computation (bypass day cache).
   */
  async detectFresh(tickers: string[]): Promise<RegimeResult> {
    const warnings: string[] = [];
    const today = todayISO();

    // Compute market regime (SPY/QQQ)
    const marketResult = await this.computeMarketRegime(warnings);

    // Compute per-ticker regime states
    const tickerStates: RegimeState[] = [];
    for (const ticker of tickers) {
      const state = await this.computeTickerState(ticker, marketResult.market_regime, warnings);
      if (state) {
        tickerStates.push(state);
      }
    }

    const result: RegimeResult = {
      market: marketResult,
      tickers: tickerStates,
      cachedAt: today,
      warnings,
    };

    // Write cache (non-fatal if it fails)
    this.writeCache(result);

    return result;
  }

  // ──────────────────────────────────────────────────────────
  // Market regime computation
  // ──────────────────────────────────────────────────────────

  private async computeMarketRegime(warnings: string[]): Promise<{
    spy_trend: 1 | -1 | null;
    qqq_trend: 1 | -1 | null;
    market_regime: MarketRegime;
  }> {
    const spyTrend = await this.fetchIndexTrend('SPY', warnings);
    const qqqTrend = await this.fetchIndexTrend('QQQ', warnings);

    let marketRegime: MarketRegime;
    if (spyTrend === null || qqqTrend === null) {
      marketRegime = 'unknown';
    } else if (spyTrend === 1 && qqqTrend === 1) {
      marketRegime = 'bullish';
    } else if (spyTrend === -1 && qqqTrend === -1) {
      marketRegime = 'bearish';
    } else {
      marketRegime = 'neutral';
    }

    return {
      spy_trend: spyTrend,
      qqq_trend: qqqTrend,
      market_regime: marketRegime,
    };
  }

  private async fetchIndexTrend(ticker: string, warnings: string[]): Promise<1 | -1 | null> {
    try {
      const result = await this.cache.getHistoricalData(ticker, '1y', '1d');
      if (!result.success) {
        warnings.push(`${ticker}: Failed to fetch data — ${result.error}`);
        return null;
      }

      const data = result.data.dataPoints;
      if (data.length < 50) {
        warnings.push(`${ticker}: Insufficient data (${data.length} bars, need 50+)`);
        return null;
      }

      const stBars = computeSuperTrend(data, this.superTrendParams);
      if (stBars.length === 0) {
        warnings.push(`${ticker}: SuperTrend returned no results`);
        return null;
      }

      return stBars[stBars.length - 1].trend;
    } catch (err) {
      warnings.push(`${ticker}: Error computing trend — ${String(err)}`);
      return null;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Per-ticker regime computation
  // ──────────────────────────────────────────────────────────

  private async computeTickerState(
    ticker: string,
    marketRegime: MarketRegime,
    globalWarnings: string[]
  ): Promise<RegimeState | null> {
    const tickerWarnings: string[] = [];

    let dataPoints: HistoricalDataPoint[] | null = null;

    try {
      const result = await this.cache.getHistoricalData(ticker, '1y', '1d');
      if (!result.success) {
        globalWarnings.push(`${ticker}: Failed to fetch data — ${result.error}`);
        return null;
      }
      dataPoints = result.data.dataPoints;
    } catch (err) {
      globalWarnings.push(`${ticker}: Error fetching data — ${String(err)}`);
      return null;
    }

    // Ticker regime
    const tickerRegime = this.classifyTickerRegime(dataPoints, tickerWarnings, ticker);

    // Volatility regime
    const volatilityRegime = this.classifyVolatilityRegime(dataPoints, tickerWarnings, ticker);

    // Trend strength
    const trendStrength = this.classifyTrendStrength(dataPoints, tickerWarnings, ticker);

    // Compute regime score
    const regimeScore = computeRegimeScore(tickerRegime, marketRegime, volatilityRegime, trendStrength);

    return {
      ticker,
      ticker_regime: tickerRegime,
      market_regime: marketRegime,
      volatility_regime: volatilityRegime,
      trend_strength: trendStrength,
      regime_score: regimeScore,
      warnings: tickerWarnings,
    };
  }

  private classifyTickerRegime(
    data: HistoricalDataPoint[],
    warnings: string[],
    ticker: string
  ): TickerRegime {
    if (data.length < 50) {
      warnings.push(`${ticker}: Insufficient data for ticker regime (${data.length} bars, need 50+)`);
      return 'unknown';
    }

    const stBars = computeSuperTrend(data, this.superTrendParams);
    if (stBars.length === 0) {
      warnings.push(`${ticker}: SuperTrend returned no results`);
      return 'unknown';
    }

    const lastTrend = stBars[stBars.length - 1].trend;
    return lastTrend === 1 ? 'bullish' : 'bearish';
  }

  private classifyVolatilityRegime(
    data: HistoricalDataPoint[],
    warnings: string[],
    ticker: string
  ): VolatilityRegime {
    if (data.length < 51) {
      warnings.push(`${ticker}: Insufficient data for volatility regime (${data.length} bars, need 51+)`);
      return 'unknown';
    }

    const atr14 = atr(data, 14);
    const atr50 = atr(data, 50);

    if (atr14 === undefined || atr50 === undefined || atr50 === 0) {
      warnings.push(`${ticker}: Unable to compute ATR ratio`);
      return 'unknown';
    }

    const ratio = atr14 / atr50;

    if (ratio > 1.3) return 'high';
    if (ratio < 0.7) return 'low';
    return 'normal';
  }

  private classifyTrendStrength(
    data: HistoricalDataPoint[],
    warnings: string[],
    ticker: string
  ): TrendStrength {
    const adxValue = adx(data, 14);

    if (adxValue === undefined) {
      warnings.push(`${ticker}: Unable to compute ADX (insufficient data)`);
      return 'unknown';
    }

    if (adxValue > 25) return 'strong';
    if (adxValue >= 20) return 'moderate';
    return 'weak';
  }

  // ──────────────────────────────────────────────────────────
  // Day-level caching
  // ──────────────────────────────────────────────────────────

  private readCache(): RegimeResult | null {
    try {
      if (!fs.existsSync(this.cacheFilePath)) {
        return null;
      }

      const raw = fs.readFileSync(this.cacheFilePath, 'utf-8');
      const cached: RegimeCacheFile = JSON.parse(raw);

      // Check if cache is from today
      const today = todayISO();
      if (cached.date !== today) {
        return null;
      }

      return {
        market: cached.market,
        tickers: cached.tickers,
        cachedAt: cached.date,
        warnings: cached.warnings,
      };
    } catch {
      // Cache corrupt or unreadable — proceed with fresh computation
      return null;
    }
  }

  private writeCache(result: RegimeResult): void {
    try {
      // Ensure cache directory exists
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }

      const cacheFile: RegimeCacheFile = {
        date: todayISO(),
        computedAt: new Date().toISOString(),
        market: result.market,
        tickers: result.tickers,
        warnings: result.warnings,
      };

      fs.writeFileSync(this.cacheFilePath, JSON.stringify(cacheFile, null, 2), 'utf-8');
    } catch {
      // Cache write failure is non-fatal — log to stderr
      process.stderr.write(`[WARNING] Failed to write regime cache to ${this.cacheFilePath}\n`);
    }
  }
}

// ============================================================
// Regime Score Computation (exported for testing)
// ============================================================

/**
 * Compute regime score from component classifications.
 * Unknown components are excluded from both earned and maximum.
 * Score = (earned / available_max) * 100, clamped to [0, 100].
 */
export function computeRegimeScore(
  tickerRegime: TickerRegime,
  marketRegime: MarketRegime,
  volatilityRegime: VolatilityRegime,
  trendStrength: TrendStrength
): number {
  let earned = 0;
  let available = 0;

  if (tickerRegime !== 'unknown') {
    earned += TICKER_REGIME_POINTS[tickerRegime];
    available += TICKER_REGIME_MAX;
  }

  if (marketRegime !== 'unknown') {
    earned += MARKET_REGIME_POINTS[marketRegime];
    available += MARKET_REGIME_MAX;
  }

  if (volatilityRegime !== 'unknown') {
    earned += VOLATILITY_REGIME_POINTS[volatilityRegime];
    available += VOLATILITY_REGIME_MAX;
  }

  if (trendStrength !== 'unknown') {
    earned += TREND_STRENGTH_POINTS[trendStrength];
    available += TREND_STRENGTH_MAX;
  }

  if (available === 0) {
    return 0;
  }

  const score = (earned / available) * 100;
  return Math.max(0, Math.min(100, score));
}

// ============================================================
// Helpers
// ============================================================

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}
