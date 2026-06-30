// ============================================================
// Sentiment Check Command — Morning sentiment brief pipeline handler
// ============================================================
// Orchestrates the full morning sentiment brief with Discord embeds:
// 1. Resolve most-recent active tickers from signal history
// 2. Fetch StockTwits sentiment + Google News per ticker (concurrent)
// 3. Filter headlines against brief-seen cache
// 4. Read AI news summaries from nightly pipeline output
// 5. Detect sentiment-signal divergence per ticker
// 6. Format rich Discord embeds (header + per-ticker)
// 7. Chunk into ≤10-embed payloads and post to Discord
// 8. Write sentiment cache and brief-seen cache on success
// ============================================================

import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import { fetchStockTwitsSentiment } from '../data/stocktwits-provider.js';
import type { StockTwitsResult } from '../data/stocktwits-provider.js';
import { fetchNewsItems } from '../data/news-provider.js';
import type { NewsItem } from '../data/news-provider.js';
import { resolveMostRecentActiveTickers } from '../sentiment/most-recent-ticker-resolver.js';
import { loadBriefSeen, saveBriefSeen } from '../sentiment/brief-seen-cache.js';
import type { BriefSeenLinks } from '../sentiment/brief-seen-cache.js';
import { writeSentimentCache } from '../sentiment/sentiment-cache.js';
import type { SentimentCacheEntry } from '../sentiment/sentiment-cache.js';
import { detectDivergence } from '../sentiment/divergence-detector.js';
import { readNewsSummary } from '../sentiment/news-summary-reader.js';
import { postToDiscord } from '../sentiment/discord-poster.js';
import {
  formatHeaderEmbed,
  formatTickerEmbed,
  selectHeadlines,
  chunkEmbeds,
} from '../formatters/morning-brief-embed-formatter.js';
import type { TickerEmbedData, DiscordEmbed } from '../formatters/morning-brief-embed-formatter.js';

// ============================================================
// createSentimentCheckHandler
// ============================================================

export function createSentimentCheckHandler(deps: { dataDir: string }): CommandHandler {
  const { dataDir } = deps;

  return async (opts: Record<string, string>) => {
    const dryRun = opts['dry-run'] !== undefined;
    // --universe flag accepted for CLI compatibility; resolver reads both universes
    const _universe = opts['universe'];

    // ---- Step 1: Resolve most-recent active tickers ----
    const resolved = resolveMostRecentActiveTickers(dataDir);

    if (resolved.length === 0) {
      // Post plain-text "no active signals" message
      if (!dryRun) {
        const webhookUrl = process.env.DISCORD_WEBHOOK_SENTIMENT_URL?.trim() || process.env.DISCORD_WEBHOOK_URL;
        if (!webhookUrl) {
          console.error('[sentiment-check] Error: No webhook URL configured');
          process.exit(1);
        }
        try {
          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: 'No active signals are present.' }),
          });
          if (!response.ok) {
            const body = await response.text().catch(() => '');
            console.error(`[sentiment-check] Discord POST failed: HTTP ${response.status} — ${body}`);
            process.exit(1);
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[sentiment-check] Discord POST failed: ${errMsg}`);
          process.exit(1);
        }
      } else {
        console.log(JSON.stringify({ content: 'No active signals are present.' }, null, 2));
      }

      return successResult('sentiment-check', {
        message: 'No active signals are present.',
        tickers: [],
      });
    }

    // ---- Step 2: Load brief-seen cache ----
    const briefSeen = loadBriefSeen(dataDir);

    // ---- Step 3: Concurrent fetch — StockTwits + Google News per ticker ----
    const fetchResults = await Promise.allSettled(
      resolved.map(async ({ ticker }) => {
        const [stResult, newsResult] = await Promise.allSettled([
          fetchStockTwitsSentiment(ticker),
          fetchNewsItems(ticker),
        ]);

        const sentiment: StockTwitsResult = stResult.status === 'fulfilled'
          ? stResult.value
          : { band: 'unknown', st_bullish_count: 0, st_bearish_count: 0, st_message_volume: 0 };

        const headlines: NewsItem[] = newsResult.status === 'fulfilled'
          ? newsResult.value
          : [];

        return { ticker, sentiment, headlines };
      })
    );

    // Build maps from settled results
    const sentimentMap = new Map<string, StockTwitsResult>();
    const headlinesMap = new Map<string, NewsItem[]>();

    for (let i = 0; i < resolved.length; i++) {
      const { ticker } = resolved[i];
      const result = fetchResults[i];
      if (result.status === 'fulfilled') {
        sentimentMap.set(ticker, result.value.sentiment);
        headlinesMap.set(ticker, result.value.headlines);
      } else {
        sentimentMap.set(ticker, { band: 'unknown', st_bullish_count: 0, st_bearish_count: 0, st_message_volume: 0 });
        headlinesMap.set(ticker, []);
      }
    }

    // ---- Step 4: Filter headlines against brief-seen cache ----
    const now = new Date();
    const seenUrls = new Set(briefSeen.keys());
    const selectedHeadlinesMap = new Map<string, NewsItem[]>();

    for (const { ticker } of resolved) {
      const rawHeadlines = headlinesMap.get(ticker) ?? [];
      const selected = selectHeadlines(rawHeadlines, now, seenUrls);
      selectedHeadlinesMap.set(ticker, selected);
    }

    // ---- Step 5: Read news summaries per ticker ----
    const summaryMap = new Map<string, string | null>();
    for (const { ticker } of resolved) {
      const summary = readNewsSummary(dataDir, ticker, now);
      summaryMap.set(ticker, summary);
    }

    // ---- Step 6: Detect divergence per ticker ----
    const divergenceMap = new Map<string, string | null>();
    for (const { ticker, strategy } of resolved) {
      const sentiment = sentimentMap.get(ticker)!;
      const divergence = detectDivergence(strategy, sentiment.band);
      divergenceMap.set(ticker, divergence);
    }

    // ---- Step 7: Format embeds (header + ticker embeds sorted alphabetically) ----
    // Filter out tickers with "unknown" sentiment (no data available)
    const tickersWithData = resolved.filter(({ ticker }) => {
      const sentiment = sentimentMap.get(ticker);
      return sentiment && sentiment.band !== 'unknown';
    });

    // Limit to top 15 tickers (keep brief digestible)
    const MAX_SENTIMENT_TICKERS = 15;
    const limitedTickers = tickersWithData.slice(0, MAX_SENTIMENT_TICKERS);

    const headerText = tickersWithData.length > MAX_SENTIMENT_TICKERS
      ? `Reporting on top **${limitedTickers.length}** of ${tickersWithData.length} active signals`
      : `Reporting on **${limitedTickers.length}** active signal${limitedTickers.length === 1 ? '' : 's'}`;

    const headerEmbed = formatHeaderEmbed(now, limitedTickers.length);
    // Override header description with the count info
    headerEmbed.description = headerText;

    const tickerEmbeds: DiscordEmbed[] = limitedTickers.map(({ ticker, strategy }) => {
      const embedData: TickerEmbedData = {
        ticker,
        strategy,
        sentiment: sentimentMap.get(ticker)!,
        headlines: selectedHeadlinesMap.get(ticker) ?? [],
        newsSummary: summaryMap.get(ticker) ?? null,
        divergence: divergenceMap.get(ticker) ?? null,
      };
      return formatTickerEmbed(embedData, now);
    });

    const allEmbeds = [headerEmbed, ...tickerEmbeds];

    // ---- Step 8: Chunk into ≤10-embed payloads ----
    const chunks = chunkEmbeds(allEmbeds);

    // ---- Step 9: Dry-run → print JSON, skip posting and cache writes ----
    if (dryRun) {
      for (const chunk of chunks) {
        console.log(JSON.stringify({ embeds: chunk }, null, 2));
      }
      return successResult('sentiment-check', {
        message: 'Dry-run: printed embed payloads to stdout',
        tickers: resolved.map((r) => r.ticker),
        embedCount: allEmbeds.length,
        chunkCount: chunks.length,
      });
    }

    // ---- Step 10: Post to Discord (prefer dedicated sentiment webhook) ----
    const webhookUrl = process.env.DISCORD_WEBHOOK_SENTIMENT_URL?.trim() || process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      console.error('[sentiment-check] Error: No webhook URL configured (DISCORD_WEBHOOK_SENTIMENT_URL or DISCORD_WEBHOOK_URL)');
      process.exit(1);
    }

    for (const chunk of chunks) {
      const result = await postToDiscord(webhookUrl, { embeds: chunk });
      if (!result.success) {
        // Graceful degradation: if 400 error (embed too large), retry with fewer embeds
        if (result.error?.includes('400') || result.error?.includes('size')) {
          const reduced = chunk.slice(0, Math.max(1, chunk.length - 2));
          console.warn(`[sentiment-check] Retrying with ${reduced.length}/${chunk.length} embeds after size error`);
          const retry = await postToDiscord(webhookUrl, { embeds: reduced });
          if (!retry.success) {
            console.error(`[sentiment-check] Discord POST failed after reduction: ${retry.error}`);
          }
        } else {
          console.error(`[sentiment-check] Discord POST failed after retry: ${result.error}`);
          // Do NOT update brief-seen cache on failure
          process.exit(1);
        }
      }
    }

    // ---- Step 11: On success — save brief-seen cache ----
    const nowIso = now.toISOString();
    for (const { ticker } of resolved) {
      const selected = selectedHeadlinesMap.get(ticker) ?? [];
      for (const item of selected) {
        briefSeen.set(item.url, nowIso);
      }
    }
    saveBriefSeen(dataDir, briefSeen);

    // ---- Step 12: Write sentiment-cache.json ----
    const cacheEntries: SentimentCacheEntry[] = resolved.map(({ ticker }) => {
      const stResult = sentimentMap.get(ticker)!;
      const tickerHeadlines = selectedHeadlinesMap.get(ticker) ?? [];

      return {
        ticker,
        fetched_at: nowIso,
        band: stResult.band,
        st_bullish_count: stResult.st_bullish_count,
        st_bearish_count: stResult.st_bearish_count,
        st_message_volume: stResult.st_message_volume,
        top_headlines: tickerHeadlines.map((item) => ({
          title: item.title,
          url: item.url,
          source_domain: item.source_domain,
          published_at: item.published_at,
        })),
      };
    });

    writeSentimentCache(dataDir, cacheEntries);

    return successResult('sentiment-check', {
      message: 'Morning sentiment brief posted successfully',
      tickers: resolved.map((r) => r.ticker),
      embedCount: allEmbeds.length,
      chunkCount: chunks.length,
      sentimentBands: Object.fromEntries(
        [...sentimentMap.entries()].map(([t, r]) => [t, r.band])
      ),
    });
  };
}
