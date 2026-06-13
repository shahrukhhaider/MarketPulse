import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchNewsItems } from '../../src/data/news-provider.js';
import type { NewsItem } from '../../src/data/news-provider.js';

function makeRssXml(items: Array<{ title: string; link: string; pubDate: string; sourceUrl?: string }>): string {
  const itemsXml = items.map(item => {
    const source = item.sourceUrl
      ? `<source url="${item.sourceUrl}">${item.title}</source>`
      : '';
    return `<item>
      <title>${item.title}</title>
      <link>${item.link}</link>
      <pubDate>${item.pubDate}</pubDate>
      ${source}
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test RSS</title>
    ${itemsXml}
  </channel>
</rss>`;
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toUTCString();
}

describe('fetchNewsItems', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Successful parsing ───────────────────────────────────────────

  it('parses RSS items and returns NewsItem array', async () => {
    const xml = makeRssXml([
      {
        title: 'AAPL hits new high',
        link: 'https://news.google.com/rss/articles/abc123',
        pubDate: hoursAgo(2),
        sourceUrl: 'https://www.reuters.com/article/123',
      },
    ]);
    // First call: RSS fetch
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(xml),
    } as unknown as Response);
    // Second call: URL redirect resolution (returns same URL = no redirect)
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      url: 'https://news.google.com/rss/articles/abc123',
    } as unknown as Response);

    const items = await fetchNewsItems('AAPL');
    expect(items).toHaveLength(1);
    expect(items[0].ticker).toBe('AAPL');
    expect(items[0].title).toBe('AAPL hits new high');
    expect(items[0].url).toBe('https://news.google.com/rss/articles/abc123');
    expect(items[0].source_domain).toBe('reuters.com');
    expect(items[0].published_at).toBeDefined();
  });

  it('uppercases the ticker', async () => {
    const xml = makeRssXml([
      {
        title: 'Stock moves',
        link: 'https://example.com/article',
        pubDate: hoursAgo(1),
      },
    ]);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(xml),
    } as unknown as Response);

    const items = await fetchNewsItems('aapl');
    expect(items[0].ticker).toBe('AAPL');
  });

  // ── 48h filtering ────────────────────────────────────────────────

  it('filters out items older than 48 hours', async () => {
    const xml = makeRssXml([
      {
        title: 'Recent news',
        link: 'https://example.com/recent',
        pubDate: hoursAgo(10),
      },
      {
        title: 'Old news',
        link: 'https://example.com/old',
        pubDate: hoursAgo(50),
      },
    ]);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(xml),
    } as unknown as Response);

    const items = await fetchNewsItems('TSLA');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Recent news');
  });

  // ── Sorting newest-first ─────────────────────────────────────────

  it('sorts items newest-first', async () => {
    const xml = makeRssXml([
      { title: 'Older', link: 'https://example.com/a', pubDate: hoursAgo(24) },
      { title: 'Newest', link: 'https://example.com/b', pubDate: hoursAgo(1) },
      { title: 'Middle', link: 'https://example.com/c', pubDate: hoursAgo(12) },
    ]);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(xml),
    } as unknown as Response);

    const items = await fetchNewsItems('GOOG');
    expect(items[0].title).toBe('Newest');
    expect(items[1].title).toBe('Middle');
    expect(items[2].title).toBe('Older');
  });

  // ── Cap at 10 ────────────────────────────────────────────────────

  it('returns at most 10 items', async () => {
    const rssItems = Array.from({ length: 15 }, (_, i) => ({
      title: `Article ${i}`,
      link: `https://example.com/article-${i}`,
      pubDate: hoursAgo(i + 1),
    }));
    const xml = makeRssXml(rssItems);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(xml),
    } as unknown as Response);

    const items = await fetchNewsItems('NVDA');
    expect(items).toHaveLength(10);
  });

  // ── Source domain extraction ─────────────────────────────────────

  it('extracts source_domain from <source url="..."> attribute', async () => {
    const xml = makeRssXml([
      {
        title: 'Test',
        link: 'https://news.google.com/rss/articles/xyz',
        pubDate: hoursAgo(1),
        sourceUrl: 'https://www.cnbc.com/2024/01/01/article.html',
      },
    ]);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(xml),
    } as unknown as Response);

    const items = await fetchNewsItems('MSFT');
    expect(items[0].source_domain).toBe('cnbc.com');
  });

  it('falls back to link domain when no <source> element', async () => {
    const xml = makeRssXml([
      {
        title: 'Test',
        link: 'https://www.bloomberg.com/news/article-123',
        pubDate: hoursAgo(1),
      },
    ]);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(xml),
    } as unknown as Response);

    const items = await fetchNewsItems('AMZN');
    expect(items[0].source_domain).toBe('bloomberg.com');
  });

  // ── Failure cases ────────────────────────────────────────────────

  it('returns empty array on network error', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const items = await fetchNewsItems('AAPL');
    expect(items).toEqual([]);
  });

  it('returns empty array on non-2xx response', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 403,
    } as Response);

    const items = await fetchNewsItems('AAPL');
    expect(items).toEqual([]);
  });

  it('returns empty array on malformed XML', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('not valid xml at all'),
    } as unknown as Response);

    const items = await fetchNewsItems('AAPL');
    expect(items).toEqual([]);
  });

  // ── URL construction ─────────────────────────────────────────────

  it('constructs the correct Google News RSS URL', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('<rss></rss>'),
    } as unknown as Response);

    await fetchNewsItems('AAPL');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://news.google.com/rss/search?q=AAPL+stock&hl=en-US&gl=US&ceid=US:en',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        headers: { 'User-Agent': 'stock-tracker-bot/1.0' },
      }),
    );
  });

  // ── HTML entity decoding ─────────────────────────────────────────

  it('decodes HTML entities in titles', async () => {
    const xml = makeRssXml([
      {
        title: 'Apple &amp; Google&#39;s &quot;deal&quot;',
        link: 'https://example.com/article',
        pubDate: hoursAgo(1),
      },
    ]);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(xml),
    } as unknown as Response);

    const items = await fetchNewsItems('AAPL');
    expect(items[0].title).toBe('Apple & Google\'s "deal"');
  });
});
