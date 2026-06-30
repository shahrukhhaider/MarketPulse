// ============================================================
// StockTwits Trending Fetcher
// ============================================================
// Fetches currently trending tickers from StockTwits public API.
// Returns structured data including score, sentiment summary,
// instrument class, and sector.
// ============================================================

export interface TrendingTicker {
  ticker: string;
  title: string;
  trendingScore: number;
  instrumentClass: string;  // "Stock", "ETF", "Crypto", etc.
  sector: string | null;
  summary: string | null;
  watchlistCount: number;
}

const TRENDING_URL = 'https://api.stocktwits.com/api/2/trending/symbols.json';
const TIMEOUT_MS = 15_000;

/**
 * Fetch trending tickers from StockTwits.
 * Returns empty array on any failure (network, timeout, parse error).
 */
export async function fetchTrendingTickers(): Promise<TrendingTicker[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(TRENDING_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[trending-fetcher] StockTwits returned HTTP ${response.status}`);
      return [];
    }

    const json = await response.json() as {
      symbols?: Array<{
        symbol: string;
        title: string;
        trending_score: number;
        instrument_class: string;
        sector: string | null;
        watchlist_count: number;
        trends?: { summary?: string };
      }>;
    };

    const symbols = json.symbols ?? [];

    return symbols.map(s => ({
      ticker: s.symbol,
      title: s.title,
      trendingScore: s.trending_score,
      instrumentClass: s.instrument_class ?? 'Unknown',
      sector: s.sector ?? null,
      summary: s.trends?.summary ?? null,
      watchlistCount: s.watchlist_count,
    }));
  } catch (err) {
    console.warn(`[trending-fetcher] Error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
