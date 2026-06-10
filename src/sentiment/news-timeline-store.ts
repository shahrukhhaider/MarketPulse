import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { NewsItem } from '../data/news-provider.js';

// ============================================================
// Types
// ============================================================

/**
 * A single stored news item in the per-ticker NDJSON timeline.
 * All date fields are ISO 8601 strings.
 */
export interface TimelineItem {
  ticker: string;
  title: string;
  url: string;
  source_domain: string;
  published_at: string;
  fetched_at: string;
}

// ============================================================
// Constants
// ============================================================

const TIMELINE_DIR = 'news-timeline';

function timelinePath(dataDir: string, ticker: string): string {
  return join(dataDir, '.stock-tracker', TIMELINE_DIR, `${ticker}.ndjson`);
}

// ============================================================
// appendNewsItems
// ============================================================

/**
 * Appends new news items to the per-ticker NDJSON timeline file,
 * deduplicating by URL against existing entries.
 *
 * - Reads existing file to collect known URLs
 * - Appends only items whose URL is not already present
 * - Sets `fetched_at` to the current UTC ISO string
 * - Creates `news-timeline/` directory if it doesn't exist
 * - Logs warning to stderr on write failure; does NOT throw
 */
export function appendNewsItems(dataDir: string, ticker: string, items: NewsItem[]): void {
  if (items.length === 0) return;

  const filePath = timelinePath(dataDir, ticker);

  // Collect known URLs from existing file
  const knownUrls = new Set<string>();
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as TimelineItem;
        if (entry.url) knownUrls.add(entry.url);
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // File doesn't exist yet — that's fine
  }

  // Filter to new items only
  const newItems = items.filter((item) => !knownUrls.has(item.url));
  if (newItems.length === 0) return;

  // Build NDJSON lines
  const fetchedAt = new Date().toISOString();
  const lines = newItems.map((item) => {
    const entry: TimelineItem = {
      ticker: item.ticker,
      title: item.title,
      url: item.url,
      source_domain: item.source_domain,
      published_at: item.published_at,
      fetched_at: fetchedAt,
    };
    return JSON.stringify(entry);
  });

  try {
    mkdirSync(dirname(filePath), { recursive: true });
    appendFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
  } catch (err) {
    console.error(
      `[news-timeline-store] Warning: failed to write ${filePath}:`,
      err instanceof Error ? err.message : err
    );
  }
}

// ============================================================
// readRecentItems
// ============================================================

/**
 * Reads timeline items from the per-ticker NDJSON file, filtered to
 * items whose `published_at` is within the last `days` calendar days.
 *
 * Returns sorted newest-first.
 * Returns `[]` if the file is missing or unreadable.
 */
export function readRecentItems(dataDir: string, ticker: string, days: number): TimelineItem[] {
  const filePath = timelinePath(dataDir, ticker);

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffMs = cutoff.getTime();

  const items: TimelineItem[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as TimelineItem;
      const publishedMs = new Date(entry.published_at).getTime();
      if (isNaN(publishedMs)) continue;
      if (publishedMs >= cutoffMs) {
        items.push(entry);
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Sort newest-first by published_at
  items.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());

  return items;
}
