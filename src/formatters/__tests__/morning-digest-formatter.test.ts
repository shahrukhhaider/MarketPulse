/**
 * Unit Tests: Morning Digest Formatter
 *
 * Tests formatMorningDigest for correct header, sentiment section,
 * news section, and edge case handling.
 */

import { describe, it, expect } from 'vitest';
import { formatMorningDigest } from '../morning-digest-formatter.js';
import type { StockTwitsResult } from '../../data/stocktwits-provider.js';
import type { NewsItem } from '../../data/news-provider.js';

// Fixed date: Wednesday, June 11, 2025 at 12:00 PM ET
const TEST_DATE = new Date('2025-06-11T16:00:00.000Z');

function makeResult(band: 'bullish' | 'bearish' | 'neutral' | 'unknown'): StockTwitsResult {
  return { band, st_bullish_count: 10, st_bearish_count: 5, st_message_volume: 30 };
}

function makeNewsItem(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    ticker: 'AAPL',
    title: 'Apple hits all-time high',
    url: 'https://example.com/apple-ath',
    published_at: new Date(TEST_DATE.getTime() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
    source_domain: 'example.com',
    ...overrides,
  };
}

describe('formatMorningDigest', () => {
  describe('header', () => {
    it('formats header with weekday and date in ET', () => {
      const result = formatMorningDigest(TEST_DATE, new Map(), []);
      expect(result).toContain('📰 Morning Brief — Wednesday,');
      expect(result).toContain('Jun 11, 2025');
    });
  });

  describe('sentiment section', () => {
    it('shows bullish ticker with green emoji', () => {
      const sentiments = new Map<string, StockTwitsResult>([
        ['AAPL', makeResult('bullish')],
      ]);
      const result = formatMorningDigest(TEST_DATE, sentiments, []);
      expect(result).toContain('AAPL: 🟢 Bullish');
    });

    it('shows bearish ticker with red emoji', () => {
      const sentiments = new Map<string, StockTwitsResult>([
        ['TSLA', makeResult('bearish')],
      ]);
      const result = formatMorningDigest(TEST_DATE, sentiments, []);
      expect(result).toContain('TSLA: 🔴 Bearish');
    });

    it('shows neutral ticker with white emoji', () => {
      const sentiments = new Map<string, StockTwitsResult>([
        ['MSFT', makeResult('neutral')],
      ]);
      const result = formatMorningDigest(TEST_DATE, sentiments, []);
      expect(result).toContain('MSFT: ⚪ Neutral');
    });

    it('skips unknown tickers', () => {
      const sentiments = new Map<string, StockTwitsResult>([
        ['AAPL', makeResult('bullish')],
        ['TSLA', makeResult('unknown')],
      ]);
      const result = formatMorningDigest(TEST_DATE, sentiments, []);
      expect(result).toContain('AAPL: 🟢 Bullish');
      expect(result).not.toContain('TSLA');
    });

    it('omits sentiment section entirely when all tickers are unknown', () => {
      const sentiments = new Map<string, StockTwitsResult>([
        ['AAPL', makeResult('unknown')],
        ['TSLA', makeResult('unknown')],
      ]);
      const result = formatMorningDigest(TEST_DATE, sentiments, []);
      // Should only have header + news fallback
      expect(result).not.toContain('🟢');
      expect(result).not.toContain('🔴');
      expect(result).not.toContain('⚪');
    });
  });

  describe('news section', () => {
    it('formats news items with title, source, time_ago, and url', () => {
      const items: NewsItem[] = [
        makeNewsItem({
          title: 'Apple hits all-time high',
          source_domain: 'reuters.com',
          url: 'https://reuters.com/apple',
          published_at: new Date(TEST_DATE.getTime() - 2 * 60 * 60 * 1000).toISOString(),
        }),
      ];
      const result = formatMorningDigest(TEST_DATE, new Map(), items);
      expect(result).toContain('• Apple hits all-time high — reuters.com (2h ago)');
      expect(result).toContain('  https://reuters.com/apple');
    });

    it('shows minutes for items less than 1h old', () => {
      const items: NewsItem[] = [
        makeNewsItem({
          published_at: new Date(TEST_DATE.getTime() - 45 * 60 * 1000).toISOString(),
        }),
      ];
      const result = formatMorningDigest(TEST_DATE, new Map(), items);
      expect(result).toContain('(45m ago)');
    });

    it('shows days for items 24h+ old', () => {
      const items: NewsItem[] = [
        makeNewsItem({
          published_at: new Date(TEST_DATE.getTime() - 26 * 60 * 60 * 1000).toISOString(),
        }),
      ];
      const result = formatMorningDigest(TEST_DATE, new Map(), items);
      expect(result).toContain('(1d ago)');
    });

    it('shows fallback message when no news items', () => {
      const result = formatMorningDigest(TEST_DATE, new Map(), []);
      expect(result).toContain('No new headlines since last digest.');
    });
  });

  describe('full message', () => {
    it('combines all sections into a complete message', () => {
      const sentiments = new Map<string, StockTwitsResult>([
        ['AAPL', makeResult('bullish')],
        ['TSLA', makeResult('bearish')],
      ]);
      const items: NewsItem[] = [
        makeNewsItem({ title: 'News 1', source_domain: 'cnn.com', url: 'https://cnn.com/1' }),
        makeNewsItem({ title: 'News 2', source_domain: 'bbc.com', url: 'https://bbc.com/2' }),
      ];

      const result = formatMorningDigest(TEST_DATE, sentiments, items);

      // Header present
      expect(result).toContain('📰 Morning Brief');
      // Sentiment present
      expect(result).toContain('AAPL: 🟢 Bullish');
      expect(result).toContain('TSLA: 🔴 Bearish');
      // News present
      expect(result).toContain('• News 1 — cnn.com');
      expect(result).toContain('• News 2 — bbc.com');
      // No fallback
      expect(result).not.toContain('No new headlines since last digest.');
    });
  });
});
