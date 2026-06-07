// ============================================================
// Sentiment Check Command — Morning digest pipeline handler
// ============================================================
// Orchestrates the full morning sentiment digest:
// 1. Resolve active/near tickers from signal history
// 2. Fetch StockTwits sentiment for each ticker
// 3. Fetch Google News RSS for each ticker
// 4. Deduplicate news links against 24h seen cache
// 5. Post formatted digest to Discord webhook
// 6. Write sentiment cache for bot consumption
// ============================================================

import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import { fetchStockTwitsSentiment } from '../data/stocktwits-provider.js';
import type { StockTwitsResult } from '../data/stocktwits-provider.js';
import { fetchNewsItems } from '../data/news-provider.js';
import type { NewsItem } from '../data/news-provider.js';
import { resolveActiveAndNearTickers } from '../sentiment/active-ticker-resolver.js';
import { loadSeenLinks, saveSeenLinks } from '../sentiment/seen-links-cache.js';
import { writeSentimentCache } from '../sentiment/sentiment-cache.js';
import type { SentimentCacheEntry } from '../sentiment/sentiment-cache.js';
import { formatMorningDigest } from '../formatters/morning-digest-formatter.js';

// ============================================================
// Dependencies
// ============================================================

export interface SentimentCheckDeps {
  dataDir: string;
}

// ============================================================
// createSentimentCheckHandler
// ============================================================

export function createSentimentCheckHandler(deps: { dataDir: string }): CommandHandler {
  const { dataDir } = deps;

  return async (opts: Record<string, string>) => {
    // ---- 7.3: Parse --universe flag ----
    const universeArg = opts['universe'];
    const includesTech = universeArg === 'tech';

    // ---- Step 1: Resolve tickers (Requirement 1) ----
    const tickers = resolveActiveAndNearTickers(dataDir, includesTech);

    if (tickers.length === 0) {
      console.log('No active or near tickers in last 7 days — skipping digest');
      return successResult('sentiment-check', {
        message: 'No active or near tickers in last 7 days — skipping digest',
        tickers: [],
      });
    }

    // ---- Step 2: Fetch StockTwits for each ticker concurrently ----
    const stResults = await Promise.all(
      tickers.map(async (ticker) => {
        const result = await fetchStockTwitsSentiment(ticker);
        return { ticker, result };
      })
    );
    const sentimentMap = new Map<string, StockTwitsResult>();
    for (const { ticker, result } of stResults) {
      sentimentMap.set(ticker, result);
    }

    // ---- Step 3: Fetch Google News RSS for each ticker concurrently ----
    const newsResults = await Promise.all(
      tickers.map((ticker) => fetchNewsItems(ticker))
    );
    const allNewsItems: NewsItem[] = newsResults.flat();

    // ---- Step 4: Load seen links, filter, sort, take first 3 ----
    const seenLinks = loadSeenLinks(dataDir);

    const filteredNews = allNewsItems.filter((item) => !seenLinks.has(item.url));
    filteredNews.sort(
      (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    );
    const selectedItems = filteredNews.slice(0, 3);

    // ---- Step 5: Write updated seen links ----
    const now = new Date().toISOString();
    for (const item of selectedItems) {
      seenLinks.set(item.url, now);
    }
    // Purge entries older than 24h (loadSeenLinks already filters, but be explicit)
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    const currentMs = Date.now();
    for (const [url, seenAt] of seenLinks) {
      const seenMs = new Date(seenAt).getTime();
      if (currentMs - seenMs > twentyFourHoursMs) {
        seenLinks.delete(url);
      }
    }
    saveSeenLinks(dataDir, seenLinks);

    // ---- Step 6: Post formatted digest to Discord (or print if --dry-run) ----
    const dryRun = opts['dry-run'] !== undefined;
    const digestDate = new Date();
    const message = formatMorningDigest(digestDate, sentimentMap, selectedItems);

    if (dryRun) {
      console.log(message);
    } else {
      const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
      if (!webhookUrl) {
        console.error('[sentiment-check] Error: DISCORD_WEBHOOK_URL environment variable is not set');
        process.exit(1);
      }

      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: message }),
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          console.error(
            `[sentiment-check] Discord POST failed: HTTP ${response.status} — ${body}`
          );
          process.exit(1);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[sentiment-check] Discord POST failed: ${errMsg}`);
        process.exit(1);
      }
    }

    // ---- Step 7: Build and write sentiment cache ----
    const cacheEntries: SentimentCacheEntry[] = tickers.map((ticker) => {
      const stResult = sentimentMap.get(ticker)!;
      // Get top 3 headlines from unfiltered news for this ticker
      const tickerNews = allNewsItems
        .filter((item) => item.ticker === ticker)
        .sort(
          (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
        )
        .slice(0, 3);

      return {
        ticker,
        fetched_at: now,
        band: stResult.band,
        st_bullish_count: stResult.st_bullish_count,
        st_bearish_count: stResult.st_bearish_count,
        st_message_volume: stResult.st_message_volume,
        top_headlines: tickerNews.map((item) => ({
          title: item.title,
          url: item.url,
          source_domain: item.source_domain,
          published_at: item.published_at,
        })),
      };
    });

    writeSentimentCache(dataDir, cacheEntries);

    return successResult('sentiment-check', {
      message: 'Morning digest posted successfully',
      tickers,
      selectedHeadlines: selectedItems.length,
      sentimentBands: Object.fromEntries(
        [...sentimentMap.entries()].map(([t, r]) => [t, r.band])
      ),
    });
  };
}
