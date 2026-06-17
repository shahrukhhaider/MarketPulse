import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeTool } from '../../src/discord-bot/tools.js';

// Mock the live-fetcher module
vi.mock('../../src/sentiment/live-fetcher.js', () => ({
  fetchTickerSentiment: vi.fn(),
  fetchMarketSentiment: vi.fn(),
}));

import { fetchMarketSentiment } from '../../src/sentiment/live-fetcher.js';

describe('get_market_news tool', () => {
  beforeEach(() => {
    process.env.STOCK_TRACKER_HOME = '/tmp/test-tracker';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.STOCK_TRACKER_HOME;
  });

  it('returns error string when all market indices fail', async () => {
    vi.mocked(fetchMarketSentiment).mockResolvedValue({
      error: 'Market sentiment data is temporarily unavailable. Please try again in a few minutes.',
    });

    const result = await executeTool('get_market_news', {});
    expect(result).toBe(
      'Market sentiment data is temporarily unavailable. Please try again in a few minutes.',
    );
  });

  it('returns array of results when market sentiment fetch succeeds', async () => {
    const mockResults = [
      {
        ticker: 'SPY',
        band: 'bullish' as const,
        st_bullish_count: 72,
        st_bearish_count: 28,
        st_message_volume: 200,
        headlines: [
          { title: 'S&P 500 hits record', url: 'https://example.com/spy', source_domain: 'example.com', published_at: '2024-01-15T10:00:00Z' },
        ],
        fetched_at: '2024-01-15T08:00:00Z',
        from_cache: false,
      },
      {
        ticker: 'QQQ',
        band: 'neutral' as const,
        st_bullish_count: 50,
        st_bearish_count: 50,
        st_message_volume: 150,
        headlines: [],
        fetched_at: '2024-01-15T08:00:00Z',
        from_cache: false,
      },
      {
        ticker: 'DIA',
        band: 'unknown' as const,
        st_bullish_count: 0,
        st_bearish_count: 0,
        st_message_volume: 0,
        headlines: [],
        fetched_at: '2024-01-15T08:00:00Z',
        from_cache: false,
      },
    ];

    vi.mocked(fetchMarketSentiment).mockResolvedValue(mockResults);

    const result = await executeTool('get_market_news', {});
    expect(Array.isArray(result)).toBe(true);

    const arr = result as typeof mockResults;
    expect(arr).toHaveLength(3);

    const spy = arr.find((e) => e.ticker === 'SPY');
    expect(spy).toBeDefined();
    expect(spy!.band).toBe('bullish');
    expect(spy!.headlines).toHaveLength(1);
    expect(spy!.headlines[0].title).toBe('S&P 500 hits record');

    const qqq = arr.find((e) => e.ticker === 'QQQ');
    expect(qqq).toBeDefined();
    expect(qqq!.band).toBe('neutral');

    const dia = arr.find((e) => e.ticker === 'DIA');
    expect(dia).toBeDefined();
    expect(dia!.band).toBe('unknown');
  });

  it('calls fetchMarketSentiment with the correct dataDir', async () => {
    vi.mocked(fetchMarketSentiment).mockResolvedValue([]);

    await executeTool('get_market_news', {});

    expect(fetchMarketSentiment).toHaveBeenCalledWith('/tmp/test-tracker/.stock-tracker');
  });
});
