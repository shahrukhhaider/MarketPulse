import { describe, it, expect } from 'vitest';
import {
  formatHeaderEmbed,
  formatTickerEmbed,
  chunkEmbeds,
  computeTimeAgo,
  selectHeadlines,
} from '../../src/formatters/morning-brief-embed-formatter.js';
import type { TickerEmbedData, DiscordEmbed } from '../../src/formatters/morning-brief-embed-formatter.js';
import type { NewsItem } from '../../src/data/news-provider.js';

// ============================================================
// computeTimeAgo
// ============================================================

describe('computeTimeAgo', () => {
  const now = new Date('2025-06-11T13:00:00.000Z');

  it('returns "0m ago" for same time', () => {
    expect(computeTimeAgo('2025-06-11T13:00:00.000Z', now)).toBe('0m ago');
  });

  it('returns "Xm ago" for < 60 minutes', () => {
    expect(computeTimeAgo('2025-06-11T12:15:00.000Z', now)).toBe('45m ago');
  });

  it('returns "Xh ago" for >= 60 minutes and < 24 hours', () => {
    expect(computeTimeAgo('2025-06-11T11:00:00.000Z', now)).toBe('2h ago');
  });

  it('returns "Xd ago" for >= 24 hours', () => {
    expect(computeTimeAgo('2025-06-09T13:00:00.000Z', now)).toBe('2d ago');
  });

  it('truncates to integer (no rounding up)', () => {
    // 89 minutes = 1h 29m → should be "1h ago"
    expect(computeTimeAgo('2025-06-11T11:31:00.000Z', now)).toBe('1h ago');
  });
});

// ============================================================
// selectHeadlines
// ============================================================

describe('selectHeadlines', () => {
  const now = new Date('2025-06-11T13:00:00.000Z');

  const makeItem = (title: string, url: string, hoursAgo: number): NewsItem => ({
    ticker: 'AAPL',
    title,
    url,
    published_at: new Date(now.getTime() - hoursAgo * 60 * 60 * 1000).toISOString(),
    source_domain: 'example.com',
  });

  it('returns at most 2 headlines', () => {
    const items = [
      makeItem('A', 'http://a.com', 1),
      makeItem('B', 'http://b.com', 2),
      makeItem('C', 'http://c.com', 3),
      makeItem('D', 'http://d.com', 4),
    ];
    const result = selectHeadlines(items, now, new Set());
    expect(result).toHaveLength(2);
  });

  it('excludes headlines older than 48h', () => {
    const items = [
      makeItem('Recent', 'http://recent.com', 1),
      makeItem('Old', 'http://old.com', 49), // > 48h
    ];
    const result = selectHeadlines(items, now, new Set());
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Recent');
  });

  it('excludes seen URLs', () => {
    const items = [
      makeItem('A', 'http://a.com', 1),
      makeItem('B', 'http://b.com', 2),
    ];
    const seen = new Set(['http://a.com']);
    const result = selectHeadlines(items, now, seen);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('B');
  });

  it('returns newest-first order', () => {
    const items = [
      makeItem('Oldest', 'http://oldest.com', 10),
      makeItem('Newest', 'http://newest.com', 1),
      makeItem('Middle', 'http://middle.com', 5),
    ];
    const result = selectHeadlines(items, now, new Set());
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Newest');
    expect(result[1].title).toBe('Middle');
  });

  it('returns empty array when no headlines qualify', () => {
    const items = [makeItem('Old', 'http://old.com', 50)];
    const result = selectHeadlines(items, now, new Set());
    expect(result).toHaveLength(0);
  });
});

// ============================================================
// formatHeaderEmbed
// ============================================================

describe('formatHeaderEmbed', () => {
  it('formats header with weekday and date in Pacific Time', () => {
    // Wednesday, Jun 11, 2025 (PT)
    const date = new Date('2025-06-11T13:00:00.000Z');
    const result = formatHeaderEmbed(date, 5);

    expect(result.title).toContain('Wednesday');
    expect(result.title).toContain('Jun 11, 2025');
    expect(result.title).toContain('📰 Morning Sentiment Brief');
    expect(result.description).toBe('Reporting on **5** active signals');
    expect(result.color).toBe(3447003);
  });

  it('uses singular "signal" for count of 1', () => {
    const date = new Date('2025-06-11T13:00:00.000Z');
    const result = formatHeaderEmbed(date, 1);
    expect(result.description).toBe('Reporting on **1** active signal');
  });
});

// ============================================================
// formatTickerEmbed
// ============================================================

describe('formatTickerEmbed', () => {
  const now = new Date('2025-06-11T13:00:00.000Z');

  it('formats ticker with all sections (divergence + sentiment + summary + headlines)', () => {
    const data: TickerEmbedData = {
      ticker: 'AAPL',
      strategy: 'trend_pullback',
      sentiment: { band: 'bullish', st_bullish_count: 72, st_bearish_count: 28, st_message_volume: 100 },
      headlines: [
        { ticker: 'AAPL', title: 'Apple Reports Record Revenue', url: 'http://reuters.com/1', published_at: '2025-06-11T11:00:00.000Z', source_domain: 'reuters.com' },
        { ticker: 'AAPL', title: 'AAPL Hits New High', url: 'http://cnbc.com/1', published_at: '2025-06-11T08:00:00.000Z', source_domain: 'cnbc.com' },
      ],
      newsSummary: 'Apple reported record Q3 revenue driven by strong iPhone sales.',
      divergence: '⚠️ Bearish sentiment on bullish signal',
    };

    const result = formatTickerEmbed(data, now);

    expect(result.title).toBe('AAPL');
    expect(result.color).toBe(2278750); // bullish green
    expect(result.description).toContain('⚠️ Bearish sentiment on bullish signal');
    expect(result.description).toContain('📊 Sentiment: 🟢 Bullish (72% bull / 28% bear)');
    expect(result.description).toContain('📰 AI Summary');
    expect(result.description).toContain('Apple reported record Q3 revenue');
    expect(result.description).toContain('📰 Headlines');
    expect(result.description).toContain('Apple Reports Record Revenue — reuters.com (2h ago)');
    expect(result.description).toContain('AAPL Hits New High — cnbc.com (5h ago)');
  });

  it('formats ticker with no summary and no headlines', () => {
    const data: TickerEmbedData = {
      ticker: 'TSLA',
      strategy: 'consolidation_breakout',
      sentiment: { band: 'neutral', st_bullish_count: 50, st_bearish_count: 50, st_message_volume: 20 },
      headlines: [],
      newsSummary: null,
      divergence: null,
    };

    const result = formatTickerEmbed(data, now);

    expect(result.title).toBe('TSLA');
    expect(result.color).toBe(7041920); // neutral gray
    expect(result.description).toContain('📊 Sentiment: ⚪ Neutral (50% bull / 50% bear)');
    expect(result.description).not.toContain('📰 AI Summary');
    expect(result.description).not.toContain('📰 Headlines');
    expect(result.description).not.toContain('⚠️');
  });

  it('uses correct color for bearish band', () => {
    const data: TickerEmbedData = {
      ticker: 'META',
      strategy: 'bear_breakdown',
      sentiment: { band: 'bearish', st_bullish_count: 20, st_bearish_count: 80, st_message_volume: 50 },
      headlines: [],
      newsSummary: null,
      divergence: null,
    };

    const result = formatTickerEmbed(data, now);
    expect(result.color).toBe(15684676); // bearish red
  });

  it('uses correct color for unknown band', () => {
    const data: TickerEmbedData = {
      ticker: 'XYZ',
      strategy: 'trend_pullback',
      sentiment: { band: 'unknown', st_bullish_count: 0, st_bearish_count: 0, st_message_volume: 0 },
      headlines: [],
      newsSummary: null,
      divergence: null,
    };

    const result = formatTickerEmbed(data, now);
    expect(result.color).toBe(3621201); // unknown dark gray
  });

  it('truncates description when too long by removing oldest headlines first', () => {
    const longTitle = 'A'.repeat(2000);
    const data: TickerEmbedData = {
      ticker: 'TEST',
      strategy: 'trend_pullback',
      sentiment: { band: 'bullish', st_bullish_count: 70, st_bearish_count: 30, st_message_volume: 10 },
      headlines: [
        { ticker: 'TEST', title: longTitle, url: 'http://a.com', published_at: '2025-06-11T12:00:00.000Z', source_domain: 'a.com' },
        { ticker: 'TEST', title: longTitle, url: 'http://b.com', published_at: '2025-06-11T11:00:00.000Z', source_domain: 'b.com' },
        { ticker: 'TEST', title: longTitle, url: 'http://c.com', published_at: '2025-06-11T10:00:00.000Z', source_domain: 'c.com' },
      ],
      newsSummary: 'B'.repeat(2000),
      divergence: null,
    };

    const result = formatTickerEmbed(data, now);
    expect(result.description.length).toBeLessThanOrEqual(4096);
  });

  it('truncates summary with ellipsis when removing all headlines is insufficient', () => {
    const data: TickerEmbedData = {
      ticker: 'BIG',
      strategy: 'trend_pullback',
      sentiment: { band: 'bullish', st_bullish_count: 60, st_bearish_count: 40, st_message_volume: 10 },
      headlines: [],
      newsSummary: 'X'.repeat(5000),
      divergence: null,
    };

    const result = formatTickerEmbed(data, now);
    expect(result.description.length).toBeLessThanOrEqual(4096);
    expect(result.description).toContain('…');
  });
});

// ============================================================
// chunkEmbeds
// ============================================================

describe('chunkEmbeds', () => {
  const makeEmbed = (i: number): DiscordEmbed => ({
    title: `Embed ${i}`,
    description: `Desc ${i}`,
    color: 0,
  });

  it('returns empty array for empty input', () => {
    expect(chunkEmbeds([])).toEqual([]);
  });

  it('returns single chunk for <= 10 embeds', () => {
    const embeds = Array.from({ length: 5 }, (_, i) => makeEmbed(i));
    const result = chunkEmbeds(embeds);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(5);
  });

  it('splits into multiple chunks for > 10 embeds', () => {
    const embeds = Array.from({ length: 25 }, (_, i) => makeEmbed(i));
    const result = chunkEmbeds(embeds);
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveLength(10);
    expect(result[1]).toHaveLength(10);
    expect(result[2]).toHaveLength(5);
  });

  it('preserves order across chunks', () => {
    const embeds = Array.from({ length: 12 }, (_, i) => makeEmbed(i));
    const result = chunkEmbeds(embeds);
    const flattened = result.flat();
    expect(flattened).toEqual(embeds);
  });

  it('respects custom maxPerMessage parameter', () => {
    const embeds = Array.from({ length: 7 }, (_, i) => makeEmbed(i));
    const result = chunkEmbeds(embeds, 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveLength(3);
    expect(result[1]).toHaveLength(3);
    expect(result[2]).toHaveLength(1);
  });
});
