import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchStockTwitsSentiment } from '../../src/data/stocktwits-provider.js';
import type { SentimentBand, StockTwitsResult } from '../../src/data/stocktwits-provider.js';

function makeMessage(sentiment?: string) {
  return sentiment
    ? { sentiment: { basic: sentiment } }
    : { sentiment: null };
}

function makeResponse(messages: Array<{ sentiment: { basic: string } | null }>) {
  return {
    ok: true,
    json: () => Promise.resolve({ messages }),
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

  it('returns "bullish" when ratio >= 0.60', async () => {
    // 6 bullish, 4 bearish → ratio 0.60 → bullish
    const messages = [
      ...Array(6).fill(null).map(() => makeMessage('Bullish')),
      ...Array(4).fill(null).map(() => makeMessage('Bearish')),
    ];
    fetchSpy.mockResolvedValueOnce(makeResponse(messages));

    const result = await fetchStockTwitsSentiment('AAPL');
    expect(result.band).toBe('bullish');
    expect(result.st_bullish_count).toBe(6);
    expect(result.st_bearish_count).toBe(4);
    expect(result.st_message_volume).toBe(10);
  });

  it('returns "bearish" when ratio <= 0.40', async () => {
    // 2 bullish, 8 bearish → ratio 0.20 → bearish
    const messages = [
      ...Array(2).fill(null).map(() => makeMessage('Bullish')),
      ...Array(8).fill(null).map(() => makeMessage('Bearish')),
    ];
    fetchSpy.mockResolvedValueOnce(makeResponse(messages));

    const result = await fetchStockTwitsSentiment('TSLA');
    expect(result.band).toBe('bearish');
    expect(result.st_bullish_count).toBe(2);
    expect(result.st_bearish_count).toBe(8);
  });

  it('returns "neutral" when ratio is between 0.40 and 0.60', async () => {
    // 5 bullish, 5 bearish → ratio 0.50 → neutral
    const messages = [
      ...Array(5).fill(null).map(() => makeMessage('Bullish')),
      ...Array(5).fill(null).map(() => makeMessage('Bearish')),
    ];
    fetchSpy.mockResolvedValueOnce(makeResponse(messages));

    const result = await fetchStockTwitsSentiment('MSFT');
    expect(result.band).toBe('neutral');
    expect(result.st_bullish_count).toBe(5);
    expect(result.st_bearish_count).toBe(5);
  });

  it('returns "unknown" when fewer than 5 labeled messages', async () => {
    // 2 bullish, 1 bearish → only 3 labeled → unknown
    const messages = [
      makeMessage('Bullish'),
      makeMessage('Bullish'),
      makeMessage('Bearish'),
      makeMessage(undefined),
      makeMessage(undefined),
    ];
    fetchSpy.mockResolvedValueOnce(makeResponse(messages));

    const result = await fetchStockTwitsSentiment('GOOG');
    expect(result.band).toBe('unknown');
    expect(result.st_bullish_count).toBe(2);
    expect(result.st_bearish_count).toBe(1);
    expect(result.st_message_volume).toBe(5);
  });

  // ── Message capping ──────────────────────────────────────────────

  it('caps messages at 30', async () => {
    // 35 messages total — only first 30 should be counted
    const messages = [
      ...Array(25).fill(null).map(() => makeMessage('Bullish')),
      ...Array(10).fill(null).map(() => makeMessage('Bearish')),
    ];
    fetchSpy.mockResolvedValueOnce(makeResponse(messages));

    const result = await fetchStockTwitsSentiment('NVDA');
    expect(result.st_message_volume).toBe(30);
    // First 25 are Bullish, next 5 (of 10 Bearish) are counted
    expect(result.st_bullish_count).toBe(25);
    expect(result.st_bearish_count).toBe(5);
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

  it('returns safe default when response has no messages array', async () => {
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
    fetchSpy.mockResolvedValueOnce(makeResponse([]));

    await fetchStockTwitsSentiment('AAPL');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.stocktwits.com/api/2/streams/symbol/AAPL.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
