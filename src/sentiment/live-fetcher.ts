/**
 * Live Sentiment Fetcher
 *
 * Orchestrates on-demand sentiment fetching for Discord bot tools.
 * Fetches StockTwits sentiment and Google News headlines concurrently,
 * assembles results with TTL caching, and handles partial failures gracefully.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { fetchStockTwitsSentiment, type SentimentBand } from '../data/stocktwits-provider.js';
import { fetchNewsItems, type NewsItem } from '../data/news-provider.js';
import { TtlCache } from './ttl-cache.js';
import { validateTicker } from './ticker-validator.js';

// ============================================================
// Interfaces
// ============================================================

export interface LiveSentimentResult {
  ticker: string;
  band: SentimentBand;
  st_bullish_count: number;
  st_bearish_count: number;
  st_message_volume: number;
  headlines: Array<{
    title: string;
    url: string;
    source_domain: string;
    published_at: string;
  }>;
  news_summary?: string;
  fetched_at: string;
  from_cache: boolean;
}

export interface LiveFetcherOptions {
  ttlMs?: number;             // default: 30 * 60 * 1000 (30 minutes)
  requestTimeoutMs?: number;  // default: 10_000 (10 seconds)
  maxHeadlines?: number;      // default: 5
  maxHeadlineAgeDays?: number; // default: 7
}

// ============================================================
// Module-level TTL cache singleton
// ============================================================

const sentimentCache = new TtlCache<LiveSentimentResult>();

// ============================================================
// Constants
// ============================================================

const DEFAULT_TTL_MS = 30 * 60 * 1000;       // 30 minutes
const DEFAULT_TIMEOUT_MS = 10_000;            // 10 seconds
const DEFAULT_MAX_HEADLINES = 5;
const DEFAULT_MAX_HEADLINE_AGE_DAYS = 7;
const NEWS_SUMMARY_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours
const MARKET_TICKERS = ['SPY', 'QQQ', 'DIA'] as const;

// ============================================================
// fetchTickerSentiment
// ============================================================

/**
 * Fetches live sentiment for a single ticker.
 * Returns cached result if fresh, otherwise fetches concurrently from
 * StockTwits + Google News, assembles response, caches, and returns.
 */
export async function fetchTickerSentiment(
  ticker: string,
  dataDir: string,
  options?: LiveFetcherOptions
): Promise<LiveSentimentResult | { error: string }> {
  // 1. Validate ticker format
  const validation = validateTicker(ticker);
  if (!validation.valid) {
    return { error: `Invalid ticker format: ${validation.error}` };
  }

  const normalizedTicker = validation.normalized!;
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxHeadlines = options?.maxHeadlines ?? DEFAULT_MAX_HEADLINES;
  const maxHeadlineAgeDays = options?.maxHeadlineAgeDays ?? DEFAULT_MAX_HEADLINE_AGE_DAYS;

  // 2. Check TTL cache
  // Use a cache instance with the configured TTL if it differs from default
  const cached = sentimentCache.get(normalizedTicker);
  if (cached) {
    return { ...cached, from_cache: true };
  }

  // 3. Fetch StockTwits + Google News concurrently
  const [stResult, newsResult] = await Promise.allSettled([
    fetchStockTwitsSentiment(normalizedTicker),
    fetchNewsWithTimeout(normalizedTicker, requestTimeoutMs),
  ]);

  const stFulfilled = stResult.status === 'fulfilled' ? stResult.value : null;
  const newsFulfilled = newsResult.status === 'fulfilled' ? newsResult.value : null;

  // Determine if each source actually succeeded
  // StockTwits: always returns a result (failureResult with band "unknown" on failure)
  // We consider StockTwits "failed" if the promise was rejected
  const stFailed = stResult.status === 'rejected';
  // News: always returns [] on failure, but we consider it "failed" if the promise was rejected
  const newsFailed = newsResult.status === 'rejected';

  // 4. If both sources fail, return error
  if (stFailed && newsFailed) {
    return {
      error: 'Sentiment data is temporarily unavailable. Please try again in a few minutes.',
    };
  }

  // 5. Assemble result
  const stData = stFulfilled ?? {
    band: 'unknown' as SentimentBand,
    st_bullish_count: 0,
    st_bearish_count: 0,
    st_message_volume: 0,
  };

  const newsItems = newsFulfilled ?? [];

  // Filter headlines to last N days, sort newest-first, cap at maxHeadlines
  const now = Date.now();
  const maxAgeMs = maxHeadlineAgeDays * 24 * 60 * 60 * 1000;

  const filteredHeadlines = newsItems
    .filter((item) => {
      const publishedAt = new Date(item.published_at).getTime();
      return !isNaN(publishedAt) && now - publishedAt <= maxAgeMs;
    })
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
    .slice(0, maxHeadlines)
    .map((item) => ({
      title: item.title,
      url: item.url,
      source_domain: item.source_domain,
      published_at: item.published_at,
    }));

  // 6. Attempt to read news-summary file
  const newsSummary = await readNewsSummary(dataDir, normalizedTicker);

  // 7. Assemble final result
  const result: LiveSentimentResult = {
    ticker: normalizedTicker,
    band: stData.band,
    st_bullish_count: stData.st_bullish_count,
    st_bearish_count: stData.st_bearish_count,
    st_message_volume: stData.st_message_volume,
    headlines: filteredHeadlines,
    fetched_at: new Date().toISOString(),
    from_cache: false,
  };

  if (newsSummary) {
    result.news_summary = newsSummary;
  }

  // 8. Store in TTL cache
  sentimentCache.set(normalizedTicker, result);

  // 9. Return assembled result
  return result;
}

// ============================================================
// fetchMarketSentiment
// ============================================================

/**
 * Fetches live sentiment for market indices (SPY, QQQ, DIA).
 * Executes all fetches concurrently. Returns partial results on partial failure.
 */
export async function fetchMarketSentiment(
  dataDir: string,
  options?: LiveFetcherOptions
): Promise<LiveSentimentResult[] | { error: string }> {
  const results = await Promise.allSettled(
    MARKET_TICKERS.map((ticker) => fetchTickerSentiment(ticker, dataDir, options))
  );

  const assembled: LiveSentimentResult[] = [];
  let allFailed = true;

  for (let i = 0; i < MARKET_TICKERS.length; i++) {
    const result = results[i];
    const ticker = MARKET_TICKERS[i];

    if (result.status === 'fulfilled') {
      const value = result.value;
      if ('error' in value) {
        // This ticker failed — include degraded entry
        assembled.push(createDegradedEntry(ticker));
      } else {
        allFailed = false;
        assembled.push(value);
      }
    } else {
      // Promise rejected — include degraded entry
      assembled.push(createDegradedEntry(ticker));
    }
  }

  if (allFailed) {
    return {
      error: 'Market sentiment data is temporarily unavailable. Please try again in a few minutes.',
    };
  }

  return assembled;
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Wraps fetchNewsItems with an AbortController timeout.
 */
async function fetchNewsWithTimeout(ticker: string, timeoutMs: number): Promise<NewsItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // fetchNewsItems has its own internal 15s timeout, but we enforce
    // a tighter timeout by racing with our abort signal.
    // Since fetchNewsItems doesn't accept an abort signal, we wrap it
    // with a timeout race.
    const result = await Promise.race([
      fetchNewsItems(ticker),
      new Promise<NewsItem[]>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error(`News fetch timed out after ${timeoutMs}ms`));
        });
      }),
    ]);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Reads the news-summary file for a ticker and returns the summary text
 * if the file exists and was generated within the last 48 hours.
 * Returns undefined if the file is missing, malformed, or stale.
 */
async function readNewsSummary(dataDir: string, ticker: string): Promise<string | undefined> {
  try {
    const summaryPath = join(dataDir, 'news-summary', `${ticker}.json`);
    const raw = await readFile(summaryPath, 'utf-8');
    const data: { summary?: string; generated_at?: string } = JSON.parse(raw);

    if (!data.summary || !data.generated_at) return undefined;

    const generatedAt = new Date(data.generated_at).getTime();
    if (isNaN(generatedAt)) return undefined;

    const now = Date.now();
    if (now - generatedAt > NEWS_SUMMARY_MAX_AGE_MS) return undefined;

    return data.summary;
  } catch {
    // Missing or malformed summary file — silently omit
    return undefined;
  }
}

/**
 * Creates a degraded result entry for a ticker when fetching fails.
 */
function createDegradedEntry(ticker: string): LiveSentimentResult {
  return {
    ticker,
    band: 'unknown',
    st_bullish_count: 0,
    st_bearish_count: 0,
    st_message_volume: 0,
    headlines: [],
    fetched_at: new Date().toISOString(),
    from_cache: false,
  };
}
