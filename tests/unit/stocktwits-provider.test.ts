import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchStockTwitsSentiment } from '../../src/data/stocktwits-provider.js';
import type { SentimentBand, StockTwitsResult } from '../../src/data/stocktwits-provider.js';

function makeSentimentResponse(bullish: number, bearish: number) {
  return {
    ok: true,
    json: () => Promise.resolve({
      data: [{ bullish, bearish, timestamp: new Date().toISOString() }],
    }),
  } as unknown as Response;
}

describe('fetchStockTwitsSentiment', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Band classification ──────────────────────────────────────────

  it('returns "bullish" when bullish pct >= 60', async () => {
    fetchSpy.mockResolvedValueOnce(makeSentimentResponse(72, 28));

    const result = await fetchStockTwitsSentiment('AAPL');
    expect(result.band).toBe('bullish');
    expect(result.st_bullish_count).toBe(72);
    expect(result.st_bearish_count).toBe(28);
    expect(result.st_message_volume).toBe(0);
  });

  it('returns "bearish" when bearish pct >= 60', async () => {
    fetchSpy.mockResolvedValueOnce(makeSentimentResponse(25, 75));

    const result = await fetchStockTwitsSentiment('TSLA');
    expect(result.band).toBe('bearish');
    expect(result.st_bullish_count).toBe(25);
    expect(result.st_bearish_count).toBe(75);
  });

  it('returns "neutral" when neither bullish nor bearish >= 60', async () => {
    fetchSpy.mockResolvedValueOnce(makeSentimentResponse(50, 50));

    const result = await fetchStockTwitsSentiment('MSFT');
    expect(result.band).toBe('neutral');
    expect(result.st_bullish_count).toBe(50);
    expect(result.st_bearish_count).toBe(50);
  });

  it('returns "unknown" when data array is empty', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    } as unknown as Response);

    const result = await fetchStockTwitsSentiment('GOOG');
    expect(result.band).toBe('unknown');
    expect(result.st_bullish_count).toBe(0);
    expect(result.st_bearish_count).toBe(0);
    expect(result.st_message_volume).toBe(0);
  });

  // ── Edge cases ───────────────────────────────────────────────────

  it('returns bullish at exact boundary (60/40)', async () => {
    fetchSpy.mockResolvedValueOnce(makeSentimentResponse(60, 40));

    const result = await fetchStockTwitsSentiment('NVDA');
    expect(result.band).toBe('bullish');
    expect(result.st_bullish_count).toBe(60);
    expect(result.st_bearish_count).toBe(40);
  });

  it('returns bearish at exact boundary (40/60)', async () => {
    fetchSpy.mockResolvedValueOnce(makeSentimentResponse(40, 60));

    const result = await fetchStockTwitsSentiment('META');
    expect(result.band).toBe('bearish');
  });

  // ── Failure cases ────────────────────────────────────────────────

  it('returns safe default on network error', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await fetchStockTwitsSentiment('AAPL');
    expect(result).toEqual<StockTwitsResult>({
      band: 'unknown',
      st_bullish_count: 0,
      st_bearish_count: 0,
      st_message_volume: 0,
    });
  });

  it('returns safe default on non-2xx response', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 429,
    } as Response);

    const result = await fetchStockTwitsSentiment('AAPL');
    expect(result).toEqual<StockTwitsResult>({
      band: 'unknown',
      st_bullish_count: 0,
      st_bearish_count: 0,
      st_message_volume: 0,
    });
  });

  it('returns safe default when response has no data field', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    } as unknown as Response);

    const result = await fetchStockTwitsSentiment('AAPL');
    expect(result.band).toBe('unknown');
    expect(result.st_message_volume).toBe(0);
  });

  // ── URL construction ─────────────────────────────────────────────

  it('constructs the correct URL for the ticker', async () => {
    fetchSpy.mockResolvedValueOnce(makeSentimentResponse(55, 45));

    await fetchStockTwitsSentiment('AAPL');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.stocktwits.com/api/2/symbols/AAPL/sentiment.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
