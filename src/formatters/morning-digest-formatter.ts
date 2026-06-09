// ============================================================
// Morning Digest Formatter — Discord message for daily sentiment brief
// ============================================================
// Formats sentiment bands and selected news items into a single
// plain-text Discord message posted each trading morning at 8 AM ET.
// ============================================================

import type { StockTwitsResult } from '../data/stocktwits-provider.js';
import type { NewsItem } from '../data/news-provider.js';

// ============================================================
// Emoji / label mapping for sentiment bands
// ============================================================

const BAND_DISPLAY: Record<string, { emoji: string; label: string }> = {
  bullish: { emoji: '🟢', label: 'Bullish' },
  bearish: { emoji: '🔴', label: 'Bearish' },
  neutral: { emoji: '⚪', label: 'Neutral' },
};

// ============================================================
// Time-ago helper
// ============================================================

/**
 * Compute a human-readable relative time string from `published_at` to `now`.
 * Examples: "2h ago", "45m ago", "1d ago"
 */
function computeTimeAgo(publishedAt: string, now: Date): string {
  const pubMs = new Date(publishedAt).getTime();
  const nowMs = now.getTime();
  const diffMs = Math.max(0, nowMs - pubMs);

  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays >= 1) return `${diffDays}d ago`;
  if (diffHours >= 1) return `${diffHours}h ago`;
  return `${diffMinutes}m ago`;
}

// ============================================================
// Header formatting
// ============================================================

/**
 * Format the digest header with the date in Eastern Time.
 * Output: `📰 Morning Brief — Wednesday, Jun 11, 2025`
 */
function formatHeader(date: Date): string {
  const weekdayFmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: 'America/New_York',
  });
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  });

  const weekday = weekdayFmt.format(date);
  const dateStr = dateFmt.format(date);

  return `📰 Morning Brief — ${weekday}, ${dateStr}`;
}

// ============================================================
// Sentiment section formatting
// ============================================================

/**
 * Format sentiment lines for tickers with known bands.
 * Returns empty string if all tickers are "unknown".
 */
function formatSentimentSection(sentimentResults: Map<string, StockTwitsResult>): string {
  const lines: string[] = [];

  for (const [ticker, result] of sentimentResults) {
    const display = BAND_DISPLAY[result.band];
    if (!display) continue; // skip "unknown"
    lines.push(`${ticker}: ${display.emoji} ${display.label}`);
  }

  if (lines.length === 0) return '';

  return '\n' + lines.join('\n');
}

// ============================================================
// News section formatting
// ============================================================

/**
 * Format the news section with bullet items or fallback message.
 */
function formatNewsSection(selectedItems: NewsItem[], date: Date): string {
  if (selectedItems.length === 0) {
    return '\n\nNo new headlines since last digest.';
  }

  const lines: string[] = [''];
  for (const item of selectedItems) {
    const timeAgo = computeTimeAgo(item.published_at, date);
    lines.push(`• ${item.title} — *${item.source_domain}* (${timeAgo})`);
  }

  return '\n' + lines.join('\n');
}

// ============================================================
// Main formatter
// ============================================================

/**
 * Format a complete morning digest message for Discord.
 *
 * Sections:
 * 1. Header — date in ET
 * 2. Sentiment — per-ticker emoji bands (omitted if all unknown)
 * 3. News — up to 3 headline links with time_ago (or fallback message)
 */
export function formatMorningDigest(
  date: Date,
  sentimentResults: Map<string, StockTwitsResult>,
  selectedItems: NewsItem[],
): string {
  const header = formatHeader(date);
  const sentiment = formatSentimentSection(sentimentResults);
  const news = formatNewsSection(selectedItems, date);

  return header + sentiment + news;
}
