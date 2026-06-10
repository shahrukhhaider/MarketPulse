// ============================================================
// News Timeline Command — Nightly news accumulation + summarization
// ============================================================
// Orchestrates the nightly news-timeline pipeline:
// 1. Resolve active/near tickers from signal history (always include tech)
// 2. Fetch Google News RSS and append to per-ticker NDJSON (concurrently)
// 3. Summarize each ticker's last 7 days sequentially via Anthropic
// ============================================================

import { successResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import { fetchNewsItems } from '../data/news-provider.js';
import { resolveActiveAndNearTickers } from '../sentiment/active-ticker-resolver.js';
import { appendNewsItems, readRecentItems } from '../sentiment/news-timeline-store.js';
import { generateTickerSummary } from '../sentiment/news-summarizer.js';

// ============================================================
// createNewsTimelineHandler
// ============================================================

export function createNewsTimelineHandler(deps: { dataDir: string }): CommandHandler {
  const { dataDir } = deps;

  return async (opts: Record<string, string>) => {
    const dryRun = opts['dry-run'] !== undefined;

    // ---- Step 1: Resolve tickers (always include tech) ----
    const tickers = resolveActiveAndNearTickers(dataDir, true);

    if (tickers.length === 0) {
      console.log('No active or near tickers — skipping news timeline');
      return successResult('news-timeline', {
        message: 'No active or near tickers — skipping news timeline',
        tickers: [],
      });
    }

    // ---- Step 2: Fetch and append concurrently ----
    await Promise.all(
      tickers.map(async (ticker) => {
        const items = await fetchNewsItems(ticker);
        if (!dryRun) {
          appendNewsItems(dataDir, ticker, items);
        }
      }),
    );

    // ---- Step 3: Summarize sequentially ----
    let summariesWritten = 0;

    for (const ticker of tickers) {
      const items = readRecentItems(dataDir, ticker, 7);
      if (items.length === 0) continue;

      const summary = await generateTickerSummary(dataDir, ticker, items, { dryRun });

      if (dryRun) {
        if (summary) {
          console.log(`\n[${ticker}] ${summary}`);
        }
      } else {
        if (summary) {
          summariesWritten++;
          console.log(`[news-timeline] Summarized ${ticker} (${items.length} headlines)`);
        }
      }
    }

    // ---- Step 4: Log total ----
    if (!dryRun) {
      console.log(
        `[news-timeline] Done — ${tickers.length} tickers processed, ${summariesWritten} summaries written`,
      );
    }

    return successResult('news-timeline', {
      message: dryRun
        ? `Dry run complete — ${tickers.length} tickers processed`
        : `Done — ${tickers.length} tickers processed, ${summariesWritten} summaries written`,
      tickers,
      summariesWritten,
      dryRun,
    });
  };
}
