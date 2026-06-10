/**
 * Unit Tests: News Timeline Store
 *
 * Tests appendNewsItems and readRecentItems for correct NDJSON read/write,
 * URL deduplication, date filtering, and graceful error handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendNewsItems, readRecentItems, type TimelineItem } from '../news-timeline-store.js';
import type { NewsItem } from '../../data/news-provider.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'news-timeline-test-'));
  mkdirSync(join(tempDir, '.stock-tracker'), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeNewsItem(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    ticker: 'AAPL',
    title: 'Apple releases new product',
    url: 'https://example.com/apple-news',
    published_at: new Date().toISOString(),
    source_domain: 'example.com',
    ...overrides,
  };
}

describe('appendNewsItems', () => {
  it('creates news-timeline directory and file when they do not exist', () => {
    const items: NewsItem[] = [makeNewsItem()];

    appendNewsItems(tempDir, 'AAPL', items);

    const filePath = join(tempDir, '.stock-tracker', 'news-timeline', 'AAPL.ndjson');
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]) as TimelineItem;
    expect(entry.ticker).toBe('AAPL');
    expect(entry.title).toBe('Apple releases new product');
    expect(entry.url).toBe('https://example.com/apple-news');
    expect(entry.source_domain).toBe('example.com');
    expect(entry.fetched_at).toBeDefined();
  });

  it('deduplicates by URL — does not append items already present', () => {
    const filePath = join(tempDir, '.stock-tracker', 'news-timeline', 'AAPL.ndjson');
    mkdirSync(join(tempDir, '.stock-tracker', 'news-timeline'), { recursive: true });

    const existing: TimelineItem = {
      ticker: 'AAPL',
      title: 'Old headline',
      url: 'https://example.com/existing',
      source_domain: 'example.com',
      published_at: '2024-01-10T10:00:00.000Z',
      fetched_at: '2024-01-10T12:00:00.000Z',
    };
    writeFileSync(filePath, JSON.stringify(existing) + '\n');

    const items: NewsItem[] = [
      makeNewsItem({ url: 'https://example.com/existing', title: 'Duplicate' }),
      makeNewsItem({ url: 'https://example.com/new-one', title: 'New headline' }),
    ];

    appendNewsItems(tempDir, 'AAPL', items);

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);

    const appended = JSON.parse(lines[1]) as TimelineItem;
    expect(appended.url).toBe('https://example.com/new-one');
    expect(appended.title).toBe('New headline');
  });

  it('does nothing when items array is empty', () => {
    appendNewsItems(tempDir, 'AAPL', []);

    // news-timeline directory should not even be created
    expect(() =>
      readFileSync(join(tempDir, '.stock-tracker', 'news-timeline', 'AAPL.ndjson'), 'utf-8')
    ).toThrow();
  });

  it('does nothing when all items are duplicates', () => {
    const filePath = join(tempDir, '.stock-tracker', 'news-timeline', 'TSLA.ndjson');
    mkdirSync(join(tempDir, '.stock-tracker', 'news-timeline'), { recursive: true });

    const existing: TimelineItem = {
      ticker: 'TSLA',
      title: 'Tesla news',
      url: 'https://example.com/tesla',
      source_domain: 'example.com',
      published_at: '2024-01-10T10:00:00.000Z',
      fetched_at: '2024-01-10T12:00:00.000Z',
    };
    writeFileSync(filePath, JSON.stringify(existing) + '\n');

    const items: NewsItem[] = [makeNewsItem({ ticker: 'TSLA', url: 'https://example.com/tesla' })];
    appendNewsItems(tempDir, 'TSLA', items);

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1); // No new line added
  });

  it('sets fetched_at to a valid ISO 8601 UTC timestamp', () => {
    const before = new Date().toISOString();
    appendNewsItems(tempDir, 'NVDA', [makeNewsItem({ ticker: 'NVDA' })]);
    const after = new Date().toISOString();

    const filePath = join(tempDir, '.stock-tracker', 'news-timeline', 'NVDA.ndjson');
    const entry = JSON.parse(readFileSync(filePath, 'utf-8').trim()) as TimelineItem;

    expect(entry.fetched_at >= before).toBe(true);
    expect(entry.fetched_at <= after).toBe(true);
  });

  it('does not throw on write failure (e.g. invalid path)', () => {
    const invalidDir = '/nonexistent/path/that/cannot/be/created';
    const items: NewsItem[] = [makeNewsItem()];

    expect(() => appendNewsItems(invalidDir, 'AAPL', items)).not.toThrow();
  });
});

describe('readRecentItems', () => {
  it('returns empty array when file does not exist', () => {
    const result = readRecentItems(tempDir, 'AAPL', 7);
    expect(result).toEqual([]);
  });

  it('returns items within the last N days', () => {
    const filePath = join(tempDir, '.stock-tracker', 'news-timeline', 'AAPL.ndjson');
    mkdirSync(join(tempDir, '.stock-tracker', 'news-timeline'), { recursive: true });

    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago

    const items: TimelineItem[] = [
      { ticker: 'AAPL', title: 'Recent', url: 'https://a.com/1', source_domain: 'a.com', published_at: recent, fetched_at: recent },
      { ticker: 'AAPL', title: 'Old', url: 'https://a.com/2', source_domain: 'a.com', published_at: old, fetched_at: old },
    ];
    writeFileSync(filePath, items.map((i) => JSON.stringify(i)).join('\n') + '\n');

    const result = readRecentItems(tempDir, 'AAPL', 7);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Recent');
  });

  it('returns items sorted newest-first', () => {
    const filePath = join(tempDir, '.stock-tracker', 'news-timeline', 'MSFT.ndjson');
    mkdirSync(join(tempDir, '.stock-tracker', 'news-timeline'), { recursive: true });

    const day1 = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    const day3 = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const day5 = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

    const items: TimelineItem[] = [
      { ticker: 'MSFT', title: 'Day 5', url: 'https://a.com/5', source_domain: 'a.com', published_at: day5, fetched_at: day5 },
      { ticker: 'MSFT', title: 'Day 1', url: 'https://a.com/1', source_domain: 'a.com', published_at: day1, fetched_at: day1 },
      { ticker: 'MSFT', title: 'Day 3', url: 'https://a.com/3', source_domain: 'a.com', published_at: day3, fetched_at: day3 },
    ];
    writeFileSync(filePath, items.map((i) => JSON.stringify(i)).join('\n') + '\n');

    const result = readRecentItems(tempDir, 'MSFT', 7);
    expect(result).toHaveLength(3);
    expect(result[0].title).toBe('Day 1');
    expect(result[1].title).toBe('Day 3');
    expect(result[2].title).toBe('Day 5');
  });

  it('skips malformed lines gracefully', () => {
    const filePath = join(tempDir, '.stock-tracker', 'news-timeline', 'GOOG.ndjson');
    mkdirSync(join(tempDir, '.stock-tracker', 'news-timeline'), { recursive: true });

    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    const validItem: TimelineItem = {
      ticker: 'GOOG', title: 'Valid', url: 'https://a.com/1',
      source_domain: 'a.com', published_at: recent, fetched_at: recent,
    };

    const content = [
      'not valid json {{{',
      JSON.stringify(validItem),
      '',
      '{"published_at": "invalid-date", "title": "Bad date", "url": "x", "source_domain": "x", "ticker": "GOOG", "fetched_at": "x"}',
    ].join('\n');
    writeFileSync(filePath, content);

    const result = readRecentItems(tempDir, 'GOOG', 7);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Valid');
  });

  it('returns empty array when file is unreadable', () => {
    // Point to a directory instead of a file — readFileSync will fail
    mkdirSync(join(tempDir, '.stock-tracker', 'news-timeline', 'BAD.ndjson'), { recursive: true });

    const result = readRecentItems(tempDir, 'BAD', 7);
    expect(result).toEqual([]);
  });
});
