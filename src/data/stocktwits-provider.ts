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
    const url = `https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(ticker)}.json`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return failureResult;

    const json = await response.json() as {
      messages?: Array<{
        sentiment?: { basic?: string } | null;
      }>;
    };

    const messages = json.messages ?? [];
    const capped = messages.slice(0, 30);

    let bullishCount = 0;
    let bearishCount = 0;

    for (const msg of capped) {
      const basic = msg.sentiment?.basic;
      if (basic === 'Bullish') bullishCount++;
      else if (basic === 'Bearish') bearishCount++;
    }

    return {
      band: classifyBand(bullishCount, bearishCount),
      st_bullish_count: bullishCount,
      st_bearish_count: bearishCount,
      st_message_volume: capped.length,
    };
  } catch {
    return failureResult;
  }
}
