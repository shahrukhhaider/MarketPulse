// ============================================================
// Social Discovery Command — CLI handler for social-discovery
// ============================================================

import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import { fetchTrendingTickers } from '../social/trending-fetcher.js';
import { recordVolume, getBaseline } from '../social/volume-store.js';
import { detectSpikes } from '../social/spike-detector.js';
import { filterDiscoveries } from '../social/discovery-filter.js';
import { loadDiscovered, saveDiscovered, applyCooldown, recordDiscoveries } from '../social/discovery-store.js';
import { formatDiscoveryEmbed } from '../social/discovery-formatter.js';
import { todayPST } from '../utils/date-utils.js';

export function createSocialDiscoveryHandler(deps: { dataDir: string }): CommandHandler {
  const { dataDir } = deps;

  return async (opts: Record<string, string>) => {
    const dryRun = opts['dry-run'] !== undefined;
    const threshold = opts['threshold'] ? parseFloat(opts['threshold']) : 3.0;

    // Step 1: Fetch trending tickers from StockTwits
    console.log('[social-discovery] Fetching trending tickers...');
    const trending = await fetchTrendingTickers();

    if (trending.length === 0) {
      console.log('[social-discovery] No trending data available — skipping');
      return successResult('social-discovery', {
        message: 'No trending data available',
        fetched: 0,
        spikes: 0,
        discoveries: 0,
        posted: false,
      });
    }

    console.log(`[social-discovery] Fetched ${trending.length} trending tickers`);

    // Step 2: Detect spikes BEFORE recording volume (so baseline doesn't include today)
    const today = todayPST();
    const spikes = detectSpikes(trending, dataDir, threshold);
    console.log(`[social-discovery] Detected ${spikes.length} spikes (threshold: ${threshold}x)`);

    // Step 3: Record volume for all trending tickers (builds baseline for future runs)
    for (const t of trending) {
      recordVolume(dataDir, t.ticker, t.trendingScore, 'neutral', today);
    }

    // Step 4: Filter — remove known tickers, non-stocks
    // Filter by instrument class from trending data
    const stocksOnly = spikes.filter(s => {
      const original = trending.find(t => t.ticker === s.ticker);
      return original?.instrumentClass === 'Stock';
    });

    const discoveries = filterDiscoveries(stocksOnly, dataDir);
    console.log(`[social-discovery] After filtering: ${discoveries.length} new discoveries`);

    if (discoveries.length === 0) {
      return successResult('social-discovery', {
        message: 'No new discoveries after filtering',
        fetched: trending.length,
        spikes: spikes.length,
        discoveries: 0,
        posted: false,
      });
    }

    // Step 5: Apply cooldown
    const existing = loadDiscovered(dataDir);
    const afterCooldown = applyCooldown(discoveries, existing, today);
    console.log(`[social-discovery] After cooldown: ${afterCooldown.length} to alert`);

    if (afterCooldown.length === 0) {
      return successResult('social-discovery', {
        message: 'All discoveries on cooldown',
        fetched: trending.length,
        spikes: spikes.length,
        discoveries: discoveries.length,
        posted: false,
      });
    }

    // Step 6: Format and post (or dry-run)
    const embed = formatDiscoveryEmbed(afterCooldown, new Date());

    if (dryRun) {
      console.log(JSON.stringify({ embeds: embed ? [embed] : [] }, null, 2));
      return successResult('social-discovery', {
        message: 'Dry-run: printed payload to stdout',
        fetched: trending.length,
        spikes: spikes.length,
        discoveries: afterCooldown.length,
        posted: false,
      });
    }

    // Post to Discord (sentiment channel)
    const webhookUrl = process.env.DISCORD_WEBHOOK_SENTIMENT_URL?.trim() || process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      console.warn('[social-discovery] No webhook URL configured — skipping post');
    } else if (embed) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embeds: [embed] }),
        });
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          console.error(`[social-discovery] Discord POST failed: HTTP ${response.status} — ${body}`);
        } else {
          console.log('[social-discovery] Posted discovery alert to Discord');
        }
      } catch (err) {
        console.error(`[social-discovery] Discord POST error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Step 7: Update discovery store
    const updated = recordDiscoveries(existing, afterCooldown, today);
    saveDiscovered(dataDir, updated);

    return successResult('social-discovery', {
      message: `Posted ${afterCooldown.length} discoveries`,
      fetched: trending.length,
      spikes: spikes.length,
      discoveries: afterCooldown.length,
      posted: true,
      tickers: afterCooldown.map(d => d.ticker),
    });
  };
}
