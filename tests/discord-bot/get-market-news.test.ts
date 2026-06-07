import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fsPromises from 'node:fs/promises';
import { executeTool } from '../../src/discord-bot/tools.js';

vi.mock('node:fs/promises');
vi.mock('node:fs');

describe('get_market_news tool', () => {
  beforeEach(() => {
    process.env.STOCK_TRACKER_HOME = '/tmp/test-tracker';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.STOCK_TRACKER_HOME;
  });

  it('returns friendly message when sentiment-cache.json does not exist', async () => {
    vi.mocked(fsPromises.readFile).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );

    const result = await executeTool('get_market_news', {});
    expect(result).toBe(
      'No sentiment data available yet \u2014 digest runs at 8 AM ET on trading days.',
    );
  });

  it('returns friendly message when file is empty', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue('');

    const result = await executeTool('get_market_news', {});
    expect(result).toBe(
      'No sentiment data available yet \u2014 digest runs at 8 AM ET on trading days.',
    );
  });

  it('returns rebuild message when file contains malformed JSON', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue('{ not valid json !!!');

    const result = await executeTool('get_market_news', {});
    expect(result).toBe(
      'Sentiment cache is being rebuilt \u2014 try again after the next morning digest.',
    );
  });

  it('returns array of ticker summaries for valid cache', async () => {
    const cache = {
      AAPL: {
        ticker: 'AAPL',
        band: 'bullish',
        st_bullish_count: 50,
        st_bearish_count: 10,
        st_message_volume: 200,
        top_headlines: [
          { title: 'Apple hits record', url: 'https://example.com/apple', source_domain: 'example.com', published_at: '2024-01-15' },
          { title: 'Second headline', url: 'https://example.com/apple2', source_domain: 'example.com', published_at: '2024-01-15' },
        ],
        fetched_at: '2024-01-15T08:00:00Z',
      },
      NVDA: {
        ticker: 'NVDA',
        band: 'neutral',
        st_bullish_count: 30,
        st_bearish_count: 25,
        st_message_volume: 150,
        top_headlines: [
          { title: 'NVDA earnings preview', url: 'https://example.com/nvda', source_domain: 'example.com', published_at: '2024-01-15' },
        ],
        fetched_at: '2024-01-15T08:00:00Z',
      },
    };

    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(cache));

    const result = await executeTool('get_market_news', {});
    expect(Array.isArray(result)).toBe(true);

    const arr = result as Array<{ ticker: string; band: string; top_headline: string | null; fetched_at: string }>;
    expect(arr).toHaveLength(2);

    const aapl = arr.find((e) => e.ticker === 'AAPL');
    expect(aapl).toBeDefined();
    expect(aapl!.band).toBe('bullish');
    expect(aapl!.top_headline).toBe('Apple hits record (https://example.com/apple)');
    expect(aapl!.fetched_at).toBe('2024-01-15T08:00:00Z');

    const nvda = arr.find((e) => e.ticker === 'NVDA');
    expect(nvda).toBeDefined();
    expect(nvda!.band).toBe('neutral');
    expect(nvda!.top_headline).toBe('NVDA earnings preview (https://example.com/nvda)');
  });

  it('returns null top_headline when ticker has no headlines', async () => {
    const cache = {
      TSLA: {
        ticker: 'TSLA',
        band: 'bearish',
        st_bullish_count: 5,
        st_bearish_count: 40,
        st_message_volume: 100,
        top_headlines: [],
        fetched_at: '2024-01-15T08:00:00Z',
      },
    };

    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(cache));

    const result = await executeTool('get_market_news', {});
    const arr = result as Array<{ ticker: string; top_headline: string | null }>;
    expect(arr[0].top_headline).toBeNull();
  });
});
