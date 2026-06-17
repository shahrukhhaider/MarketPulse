// ============================================================
// Morning Brief Embed Formatter — Discord embeds for daily sentiment brief
// ============================================================
// Produces rich Discord embed objects from per-ticker sentiment data.
// Handles color-coded sidebars, divergence warnings, time-ago labels,
// headline selection, and truncation within Discord's 4096 char limit.
// ============================================================

import type { StockTwitsResult, SentimentBand } from '../data/stocktwits-provider.js';
import type { NewsItem } from '../data/news-provider.js';

// ============================================================
// Interfaces
// ============================================================

export interface TickerEmbedData {
  ticker: string;
  strategy: string;
  sentiment: StockTwitsResult;
  headlines: NewsItem[];
  newsSummary: string | null;
  divergence: string | null; // e.g. "Bearish sentiment on bullish signal"
}

export interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
}

// ============================================================
// Constants
// ============================================================

const EMBED_COLOR: Record<SentimentBand, number> = {
  bullish: 2278750,   // #22c55e
  bearish: 15684676,  // #ef4444
  neutral: 7041920,   // #6b7280
  unknown: 3621201,   // #374151
};

const HEADER_COLOR = 3447003; // Discord blurple

const BAND_EMOJI: Record<SentimentBand, string> = {
  bullish: '🟢 Bullish',
  bearish: '🔴 Bearish',
  neutral: '⚪ Neutral',
  unknown: '❓ Unknown',
};

const MAX_DESCRIPTION_LENGTH = 4096;
const MAX_EMBEDS_PER_MESSAGE = 10;
const MAX_HEADLINES = 3;
const HEADLINE_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

// ============================================================
// computeTimeAgo — exported for direct use and testing
// ============================================================

/**
 * Compute a relative time string from `publishedAt` to `now`.
 * - "Xm ago" for <60 min
 * - "Xh ago" for ≥60 min and <24h
 * - "Xd ago" for ≥24h
 * X is a truncated integer (Math.floor).
 */
export function computeTimeAgo(publishedAt: string, now: Date): string {
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
// selectHeadlines — headline selection helper
// ============================================================

/**
 * Selects at most 3 headlines from the provided list:
 * - Within 48h of `now`
 * - Newest-first order
 * - Excludes URLs present in `seenUrls`
 */
export function selectHeadlines(
  headlines: NewsItem[],
  now: Date,
  seenUrls: Set<string>,
): NewsItem[] {
  const nowMs = now.getTime();

  return headlines
    .filter((item) => {
      // Exclude already-seen URLs
      if (seenUrls.has(item.url)) return false;
      // Must be within 48h
      const pubMs = new Date(item.published_at).getTime();
      const age = nowMs - pubMs;
      return age >= 0 && age <= HEADLINE_MAX_AGE_MS;
    })
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
    .slice(0, MAX_HEADLINES);
}

// ============================================================
// formatHeaderEmbed
// ============================================================

/**
 * Formats the header embed with weekday + date in Pacific Time and active signal count.
 */
export function formatHeaderEmbed(date: Date, tickerCount: number): DiscordEmbed {
  const weekdayFmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: 'America/Los_Angeles',
  });
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Los_Angeles',
  });

  const weekday = weekdayFmt.format(date);
  const dateStr = dateFmt.format(date);

  return {
    title: `📰 Morning Sentiment Brief — ${weekday}, ${dateStr}`,
    description: `Reporting on **${tickerCount}** active signal${tickerCount === 1 ? '' : 's'}`,
    color: HEADER_COLOR,
  };
}

// ============================================================
// formatTickerEmbed
// ============================================================

/**
 * Formats a single ticker embed with sentiment, divergence, summary, and headlines.
 * Truncates description to fit within 4096 chars if necessary.
 */
export function formatTickerEmbed(data: TickerEmbedData, now: Date): DiscordEmbed {
  const { ticker, sentiment, headlines, newsSummary, divergence } = data;

  const color = EMBED_COLOR[sentiment.band];
  const description = buildDescription(divergence, sentiment, headlines, newsSummary, now);

  return {
    title: ticker,
    description,
    color,
  };
}

// ============================================================
// Description builder with truncation
// ============================================================

function buildDescription(
  divergence: string | null,
  sentiment: StockTwitsResult,
  headlines: NewsItem[],
  newsSummary: string | null,
  now: Date,
): string {
  // Build sections
  const divergenceSection = divergence ? `${divergence}\n\n` : '';
  const sentimentSection = formatSentimentLine(sentiment);
  const summarySection = newsSummary ? `\n\n📰 AI Summary\n${newsSummary}` : '';
  const headlineSection = formatHeadlineSection(headlines, now);

  // Assemble full description
  let description = divergenceSection + sentimentSection + summarySection + headlineSection;

  // Truncation strategy if over 4096 chars
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    description = truncateDescription(divergence, sentiment, headlines, newsSummary, now);
  }

  return description;
}

function formatSentimentLine(sentiment: StockTwitsResult): string {
  const bandDisplay = BAND_EMOJI[sentiment.band];
  const total = sentiment.st_bullish_count + sentiment.st_bearish_count;

  if (total === 0) {
    return `📊 Sentiment: ${bandDisplay}`;
  }

  const bullPct = sentiment.st_bullish_count;
  const bearPct = sentiment.st_bearish_count;
  return `📊 Sentiment: ${bandDisplay} (${bullPct}% bull / ${bearPct}% bear)`;
}

function formatHeadlineSection(headlines: NewsItem[], now: Date): string {
  if (headlines.length === 0) return '';

  const lines = headlines.map((item) => {
    const timeAgo = computeTimeAgo(item.published_at, now);
    return `• ${item.title} — ${item.source_domain} (${timeAgo})`;
  });

  return '\n\n📰 Headlines\n' + lines.join('\n');
}

function truncateDescription(
  divergence: string | null,
  sentiment: StockTwitsResult,
  headlines: NewsItem[],
  newsSummary: string | null,
  now: Date,
): string {
  // Strategy: remove oldest headlines one by one (headlines are newest-first,
  // so oldest is at the end)
  const mutableHeadlines = [...headlines];

  while (mutableHeadlines.length > 0) {
    mutableHeadlines.pop(); // remove oldest (last item)
    const desc = assembleDescription(divergence, sentiment, mutableHeadlines, newsSummary, now);
    if (desc.length <= MAX_DESCRIPTION_LENGTH) return desc;
  }

  // All headlines removed — truncate summary if still too long
  const divergenceSection = divergence ? `${divergence}\n\n` : '';
  const sentimentSection = formatSentimentLine(sentiment);

  if (!newsSummary) {
    // No summary to truncate; return what we have (should fit)
    return (divergenceSection + sentimentSection).slice(0, MAX_DESCRIPTION_LENGTH);
  }

  const prefix = divergenceSection + sentimentSection + '\n\n📰 AI Summary\n';
  const availableLength = MAX_DESCRIPTION_LENGTH - prefix.length - 1; // -1 for "…"

  if (availableLength <= 0) {
    return (divergenceSection + sentimentSection).slice(0, MAX_DESCRIPTION_LENGTH);
  }

  const truncatedSummary = newsSummary.slice(0, availableLength) + '…';
  return prefix + truncatedSummary;
}

function assembleDescription(
  divergence: string | null,
  sentiment: StockTwitsResult,
  headlines: NewsItem[],
  newsSummary: string | null,
  now: Date,
): string {
  const divergenceSection = divergence ? `${divergence}\n\n` : '';
  const sentimentSection = formatSentimentLine(sentiment);
  const summarySection = newsSummary ? `\n\n📰 AI Summary\n${newsSummary}` : '';
  const headlineSection = formatHeadlineSection(headlines, now);

  return divergenceSection + sentimentSection + summarySection + headlineSection;
}

// ============================================================
// chunkEmbeds
// ============================================================

/**
 * Splits an array of embeds into chunks of at most `maxPerMessage` (default 10)
 * for Discord's embed limit per message. Preserves order.
 */
export function chunkEmbeds(embeds: DiscordEmbed[], maxPerMessage: number = MAX_EMBEDS_PER_MESSAGE): DiscordEmbed[][] {
  if (embeds.length === 0) return [];

  const chunks: DiscordEmbed[][] = [];
  for (let i = 0; i < embeds.length; i += maxPerMessage) {
    chunks.push(embeds.slice(i, i + maxPerMessage));
  }
  return chunks;
}
