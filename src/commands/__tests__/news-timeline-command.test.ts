import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// News Timeline Command — Unit Tests
// ============================================================

// Mock all external dependencies
vi.mock('../../data/news-provider.js', () => ({
  fetchNewsItems: vi.fn(),
}));

vi.mock('../../sentiment/active-ticker-resolver.js', () => ({
  resolveActiveAndNearTickers: vi.fn(),
}));

vi.mock('../../sentiment/news-timeline-store.js', () => ({
  appendNewsItems: vi.fn(),
  readRecentItems: vi.fn(),
}));

vi.mock('../../sentiment/news-summarizer.js', () => ({
  generateTickerSummary: vi.fn(),
}));

import { createNewsTimelineHandler } from '../news-timeline-command.js';
import { fetchNewsItems } from '../../data/news-provider.js';
import { resolveActiveAndNearTickers } from '../../sentiment/active-ticker-resolver.js';
import { appendNewsItems, readRecentItems } from '../../sentiment/news-timeline-store.js';
import { generateTickerSummary } from '../../sentiment/news-summarizer.js';

const mockFetchNewsItems = vi.mocked(fetchNewsItems);
const mockResolveActiveAndNearTickers = vi.mocked(resolveActiveAndNearTickers);
const mockAppendNewsItems = vi.mocked(appendNewsItems);
const mockReadRecentItems = vi.mocked(readRecentItems);
const mockGenerateTickerSummary = vi.mocked(generateTickerSummary);

describe('createNewsTimelineHandler', () => {
  const dataDir = '/tmp/test-data';
  let handler: ReturnType<typeof createNewsTimelineHandler>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    handler = createNewsTimelineHandler({ dataDir });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('exits successfully when no tickers are resolved', async () => {
    mockResolveActiveAndNearTickers.mockReturnValue([]);

    const result = await handler({});

    expect(result.success).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      'No active or near tickers — skipping news timeline',
    );
    expect(mockFetchNewsItems).not.toHaveBeenCalled();
  });

  it('always passes true for includesTech when resolving tickers', async () => {
    mockResolveActiveAndNearTickers.mockReturnValue([]);

    await handler({});

    expect(mockResolveActiveAndNearTickers).toHaveBeenCalledWith(dataDir, true);
  });

  it('fetches and appends news concurrently for all tickers', async () => {
    mockResolveActiveAndNearTickers.mockReturnValue(['AAPL', 'NVDA']);
    mockFetchNewsItems.mockResolvedValue([]);
    mockReadRecentItems.mockReturnValue([]);

    await handler({});

    expect(mockFetchNewsItems).toHaveBeenCalledWith('AAPL');
    expect(mockFetchNewsItems).toHaveBeenCalledWith('NVDA');
    expect(mockAppendNewsItems).toHaveBeenCalledWith(dataDir, 'AAPL', []);
    expect(mockAppendNewsItems).toHaveBeenCalledWith(dataDir, 'NVDA', []);
  });

  it('skips summarization when readRecentItems returns empty array', async () => {
    mockResolveActiveAndNearTickers.mockReturnValue(['AAPL']);
    mockFetchNewsItems.mockResolvedValue([]);
    mockReadRecentItems.mockReturnValue([]);

    await handler({});

    expect(mockGenerateTickerSummary).not.toHaveBeenCalled();
  });

  it('calls generateTickerSummary when recent items exist', async () => {
    const items = [
      {
        ticker: 'AAPL',
        title: 'Apple rises',
        url: 'https://example.com/1',
        source_domain: 'example.com',
        published_at: new Date().toISOString(),
        fetched_at: new Date().toISOString(),
      },
    ];

    mockResolveActiveAndNearTickers.mockReturnValue(['AAPL']);
    mockFetchNewsItems.mockResolvedValue([]);
    mockReadRecentItems.mockReturnValue(items);
    mockGenerateTickerSummary.mockResolvedValue('Apple had a good week.');

    await handler({});

    expect(mockGenerateTickerSummary).toHaveBeenCalledWith(
      dataDir,
      'AAPL',
      items,
      { dryRun: false },
    );
  });

  it('logs summary message on successful summarization', async () => {
    const items = [
      {
        ticker: 'NVDA',
        title: 'NVDA surges',
        url: 'https://example.com/1',
        source_domain: 'example.com',
        published_at: new Date().toISOString(),
        fetched_at: new Date().toISOString(),
      },
    ];

    mockResolveActiveAndNearTickers.mockReturnValue(['NVDA']);
    mockFetchNewsItems.mockResolvedValue([]);
    mockReadRecentItems.mockReturnValue(items);
    mockGenerateTickerSummary.mockResolvedValue('NVDA had a big week.');

    await handler({});

    expect(consoleSpy).toHaveBeenCalledWith(
      '[news-timeline] Summarized NVDA (1 headlines)',
    );
  });

  it('logs total tickers and summaries on completion', async () => {
    const items = [
      {
        ticker: 'AAPL',
        title: 'Apple rises',
        url: 'https://example.com/1',
        source_domain: 'example.com',
        published_at: new Date().toISOString(),
        fetched_at: new Date().toISOString(),
      },
    ];

    mockResolveActiveAndNearTickers.mockReturnValue(['AAPL', 'NVDA']);
    mockFetchNewsItems.mockResolvedValue([]);
    // AAPL has items, NVDA does not
    mockReadRecentItems.mockImplementation((_dir, ticker) => {
      if (ticker === 'AAPL') return items;
      return [];
    });
    mockGenerateTickerSummary.mockResolvedValue('Summary text');

    await handler({});

    expect(consoleSpy).toHaveBeenCalledWith(
      '[news-timeline] Done — 2 tickers processed, 1 summaries written',
    );
  });

  describe('--dry-run flag', () => {
    it('skips appendNewsItems when dry-run is set', async () => {
      mockResolveActiveAndNearTickers.mockReturnValue(['AAPL']);
      mockFetchNewsItems.mockResolvedValue([
        {
          ticker: 'AAPL',
          title: 'test',
          url: 'https://example.com',
          published_at: new Date().toISOString(),
          source_domain: 'example.com',
        },
      ]);
      mockReadRecentItems.mockReturnValue([]);

      await handler({ 'dry-run': 'true' });

      expect(mockAppendNewsItems).not.toHaveBeenCalled();
    });

    it('still fetches news items in dry-run mode', async () => {
      mockResolveActiveAndNearTickers.mockReturnValue(['AAPL']);
      mockFetchNewsItems.mockResolvedValue([]);
      mockReadRecentItems.mockReturnValue([]);

      await handler({ 'dry-run': 'true' });

      expect(mockFetchNewsItems).toHaveBeenCalledWith('AAPL');
    });

    it('passes dryRun option to generateTickerSummary', async () => {
      const items = [
        {
          ticker: 'AAPL',
          title: 'Apple rises',
          url: 'https://example.com/1',
          source_domain: 'example.com',
          published_at: new Date().toISOString(),
          fetched_at: new Date().toISOString(),
        },
      ];

      mockResolveActiveAndNearTickers.mockReturnValue(['AAPL']);
      mockFetchNewsItems.mockResolvedValue([]);
      mockReadRecentItems.mockReturnValue(items);
      mockGenerateTickerSummary.mockResolvedValue('Apple summary text');

      await handler({ 'dry-run': 'true' });

      expect(mockGenerateTickerSummary).toHaveBeenCalledWith(
        dataDir,
        'AAPL',
        items,
        { dryRun: true },
      );
    });

    it('prints summary to stdout in dry-run mode', async () => {
      const items = [
        {
          ticker: 'AAPL',
          title: 'Apple rises',
          url: 'https://example.com/1',
          source_domain: 'example.com',
          published_at: new Date().toISOString(),
          fetched_at: new Date().toISOString(),
        },
      ];

      mockResolveActiveAndNearTickers.mockReturnValue(['AAPL']);
      mockFetchNewsItems.mockResolvedValue([]);
      mockReadRecentItems.mockReturnValue(items);
      mockGenerateTickerSummary.mockResolvedValue('Apple had a great week.');

      await handler({ 'dry-run': 'true' });

      expect(consoleSpy).toHaveBeenCalledWith('\n[AAPL] Apple had a great week.');
    });

    it('does not log completion totals in dry-run mode', async () => {
      mockResolveActiveAndNearTickers.mockReturnValue(['AAPL']);
      mockFetchNewsItems.mockResolvedValue([]);
      mockReadRecentItems.mockReturnValue([]);

      await handler({ 'dry-run': 'true' });

      const calls = consoleSpy.mock.calls.map((c) => c[0]);
      const hasDoneLine = calls.some(
        (msg: string) => typeof msg === 'string' && msg.includes('[news-timeline] Done'),
      );
      expect(hasDoneLine).toBe(false);
    });
  });

  it('does not count tickers with empty summary string', async () => {
    const items = [
      {
        ticker: 'AAPL',
        title: 'Apple rises',
        url: 'https://example.com/1',
        source_domain: 'example.com',
        published_at: new Date().toISOString(),
        fetched_at: new Date().toISOString(),
      },
    ];

    mockResolveActiveAndNearTickers.mockReturnValue(['AAPL']);
    mockFetchNewsItems.mockResolvedValue([]);
    mockReadRecentItems.mockReturnValue(items);
    // Empty string means summarization failed
    mockGenerateTickerSummary.mockResolvedValue('');

    await handler({});

    expect(consoleSpy).toHaveBeenCalledWith(
      '[news-timeline] Done — 1 tickers processed, 0 summaries written',
    );
  });
});
