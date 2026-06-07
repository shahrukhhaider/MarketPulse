// ============================================================
// Google News RSS Provider
// ============================================================

/**
 * A structured news result extracted from Google News RSS.
 */
export interface NewsItem {
  ticker: string;
  title: string;
  url: string;
  published_at: string;
  source_domain: string;
}

// ============================================================
// RSS XML parsing helpers (no external dependency)
// ============================================================

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`);
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function extractLink(itemXml: string): string {
  // <link> in RSS can be self-closing or have content on the next line.
  // Google News RSS typically puts the URL on the line after <link>.
  const match = itemXml.match(/<link\s*\/?>\s*(https?:\/\/[^\s<]+)/);
  if (match) return match[1].trim();

  // Fallback: try as regular tag content
  const tagContent = extractTag(itemXml, 'link');
  if (tagContent.startsWith('http')) return tagContent;

  return '';
}

function extractSourceDomain(itemXml: string, linkUrl: string): string {
  // Try <source url="...">
  const sourceMatch = itemXml.match(/<source\s+url="([^"]+)"/);
  if (sourceMatch) {
    try {
      return new URL(sourceMatch[1]).hostname.replace(/^www\./, '');
    } catch {
      // fall through
    }
  }

  // Fallback: parse domain from the link URL
  if (linkUrl) {
    try {
      return new URL(linkUrl).hostname.replace(/^www\./, '');
    } catch {
      // fall through
    }
  }

  return '';
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

// ============================================================
// fetchNewsItems
// ============================================================

/**
 * Fetches Google News RSS for a ticker and returns structured news items.
 *
 * - Requests with 15s timeout and User-Agent `stock-tracker-bot/1.0`
 * - Parses RSS XML using string split + regex (no external XML parser)
 * - Filters to items published within the last 48 hours
 * - Returns at most 10 items sorted newest-first
 * - Returns `[]` on any fetch/parse failure
 */
export async function fetchNewsItems(ticker: string): Promise<NewsItem[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(ticker)}+stock&hl=en-US&gl=US&ceid=US:en`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'stock-tracker-bot/1.0' },
    });
    clearTimeout(timeout);

    if (!response.ok) return [];

    const body = await response.text();
    return parseRssItems(body, ticker);
  } catch {
    return [];
  }
}

// ============================================================
// RSS parsing and filtering
// ============================================================

function parseRssItems(xml: string, ticker: string): NewsItem[] {
  const now = Date.now();
  const fortyEightHoursMs = 48 * 60 * 60 * 1000;

  // Split on <item> to isolate individual entries (first chunk is the channel header)
  const chunks = xml.split('<item>');
  const items: NewsItem[] = [];

  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];

    const title = decodeHtmlEntities(extractTag(chunk, 'title'));
    const link = extractLink(chunk);
    const pubDateStr = extractTag(chunk, 'pubDate');
    const sourceDomain = extractSourceDomain(chunk, link);

    if (!title || !link || !pubDateStr) continue;

    // Parse RFC 2822 date
    const pubDate = new Date(pubDateStr);
    if (isNaN(pubDate.getTime())) continue;

    // Filter: must be within 48h of now
    if (now - pubDate.getTime() > fortyEightHoursMs) continue;

    items.push({
      ticker: ticker.toUpperCase(),
      title,
      url: link,
      published_at: pubDate.toISOString(),
      source_domain: sourceDomain,
    });
  }

  // Sort newest-first and cap at 10
  items.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
  return items.slice(0, 10);
}
