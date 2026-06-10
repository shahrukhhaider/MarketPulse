// ============================================================
// StockTwits Sentiment Provider
// ============================================================

/**
 * Sentiment band classification derived from StockTwits bullish ratio.
 * - "bullish": ratio >= 0.60
 * - "bearish": ratio <= 0.40
 * - "neutral": between 0.40 and 0.60
 * - "unknown": fewer than 5 labeled messages or fetch failure
 */
export type SentimentBand = 'bullish' | 'neutral' | 'bearish' | 'unknown';

export interface StockTwitsResult {
  band: SentimentBand;
  st_bullish_count: number;
  st_bearish_count: number;
  st_message_volume: number;
}

// ============================================================
// Band classification
// ============================================================

function classifyBand(bullishCount: number, bearishCount: number): SentimentBand {
  const totalLabeled = bullishCount + bearishCount;
  if (totalLabeled < 5) return 'unknown';

  const ratio = bullishCount / totalLabeled;
  if (ratio >= 0.60) return 'bullish';
  if (ratio <= 0.40) return 'bearish';
  return 'neutral';
}

// ============================================================
// fetchStockTwitsSentiment
// ============================================================

/**
 * Fetches the StockTwits symbol stream for a ticker and computes
 * a sentiment band from up to 30 messages.
 *
 * Returns a safe default on any failure (network, timeout, parse error).
 */
export async function fetchStockTwitsSentiment(ticker: string): Promise<StockTwitsResult> {
  const failureResult: StockTwitsResult = {
    band: 'unknown',
    st_bullish_count: 0,
    st_bearish_count: 0,
    st_message_volume: 0,
  };

  try {
    const url = `https://api.stocktwits.com/api/2/symbols/${encodeURIComponent(ticker)}/sentiment.json`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return failureResult;

    const json = await response.json() as {
      data?: Array<{ bullish: number; bearish: number; timestamp: string }>;
    };

    // Use the most recent day's aggregated sentiment
    const latest = json.data?.[0];
    if (!latest) return failureResult;

    const bullishPct = latest.bullish;
    const bearishPct = latest.bearish;

    // Convert percentages to band using same thresholds
    let band: SentimentBand;
    if (bullishPct >= 60) band = 'bullish';
    else if (bearishPct >= 60) band = 'bearish';
    else band = 'neutral';

    return {
      band,
      st_bullish_count: Math.round(bullishPct),
      st_bearish_count: Math.round(bearishPct),
      st_message_volume: 0, // not available from this endpoint
    };
  } catch {
    return failureResult;
  }
}
