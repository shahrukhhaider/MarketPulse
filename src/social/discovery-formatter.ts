// ============================================================
// Social Discovery Discord Formatter
// ============================================================

import type { DiscoveryTicker } from './discovery-filter.js';

export interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
}

const COLOR_ORANGE = 0xFF9800;
const MAX_DISPLAY = 5;

/**
 * Format discovered tickers as a single Discord embed.
 * Shows top 5 with spike info and summary snippet.
 */
export function formatDiscoveryEmbed(
  discoveries: DiscoveryTicker[],
  date: Date,
): DiscordEmbed | null {
  if (discoveries.length === 0) return null;

  const dateStr = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Los_Angeles',
  }).format(date);

  const top = discoveries.slice(0, MAX_DISPLAY);

  const lines: string[] = [];
  for (const d of top) {
    const badge = d.isNew ? '🆕' : '📈';
    const baselineStr = d.baseline != null
      ? `${d.trendingScore.toFixed(1)} vs avg ${d.baseline.toFixed(1)}`
      : `score ${d.trendingScore.toFixed(1)} (first seen)`;

    let line = `${badge} **${d.ticker}** — ${d.title}\n   ${baselineStr}`;

    if (d.summary) {
      const shortSummary = d.summary.length > 120
        ? d.summary.slice(0, 117) + '…'
        : d.summary;
      line += `\n   _${shortSummary}_`;
    }

    lines.push(line);
  }

  const description = lines.join('\n\n');

  return {
    title: `🔍 Social Buzz — ${dateStr}`,
    description,
    color: COLOR_ORANGE,
  };
}
