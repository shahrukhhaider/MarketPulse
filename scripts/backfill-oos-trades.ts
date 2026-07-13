/**
 * Backfill oos_trades for profiles that have walk_forward_metrics.trades > 0
 * but no oos_trades array. Re-runs OOS evaluation using saved params.
 *
 * Usage: npx tsx scripts/backfill-oos-trades.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createDependencies } from '../src/di/container.js';
import { isValidProfile, saveStrategyProfile } from '../src/data/profile-store.js';
import type { StrategyProfile, ProfileTrade } from '../src/data/profile-store.js';
import { splitData } from '../src/pipeline/walk-forward-validator.js';
import {
  evaluateV3Configuration,
  evaluateTrendPullbackConfiguration,
  evaluateBearBreakdownConfiguration,
  evaluateKeltnerMeanReversionConfiguration,
} from '../src/pipeline/walk-forward-validator.js';
import {
  buildConsolidationBreakoutConfig,
  buildTrendPullbackGridConfig,
  buildBearBreakdownConfig,
  buildKeltnerMeanReversionConfig,
} from '../src/strategies/parameter-grid.js';
import { IndicatorCache, getDefaultCacheConfig } from '../src/indicators/indicator-cache.js';

const DATA_DIR = path.join(process.cwd(), '.stock-tracker');
const PROFILES_DIR = path.join(DATA_DIR, 'data', 'profiles');

const { cachingProvider } = createDependencies({ dataDir: DATA_DIR });

async function backfill() {
  const strategies = fs.readdirSync(PROFILES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name);

  let total = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const strategy of strategies) {
    const stratDir = path.join(PROFILES_DIR, strategy);
    const files = fs.readdirSync(stratDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
      const filePath = path.join(stratDir, file);
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (!isValidProfile(raw)) continue;

      const profile = raw as StrategyProfile;
      total++;

      // Skip if already has oos_trades with data
      if (profile.oos_trades && profile.oos_trades.length > 0) {
        skipped++;
        continue;
      }

      // Skip if metrics say 0 trades (nothing to backfill)
      if (profile.walk_forward_metrics.trades === 0) {
        skipped++;
        continue;
      }

      const ticker = profile.ticker;
      process.stdout.write(`Backfilling ${ticker}/${strategy}... `);

      try {
        const dataResult = await cachingProvider.getHistoricalData(ticker, '5y');
        if (!dataResult.success) {
          process.stdout.write(`SKIP (no data: ${dataResult.error})\n`);
          skipped++;
          continue;
        }

        const dataPoints = dataResult.data.dataPoints;
        const splitResult = splitData(dataPoints);
        if ('error' in splitResult) {
          process.stdout.write(`SKIP (split error: ${splitResult.error})\n`);
          skipped++;
          continue;
        }

        const { outOfSample: oosData } = splitResult;
        const oosCache = new IndicatorCache(oosData, getDefaultCacheConfig());
        const params = profile.params;

        let oosMetrics;
        if (strategy === 'consolidation_breakout') {
          const config = buildConsolidationBreakoutConfig(params);
          oosMetrics = evaluateV3Configuration({ params, config } as any, oosData, oosCache);
        } else if (strategy === 'trend_pullback') {
          const config = buildTrendPullbackGridConfig(params);
          oosMetrics = evaluateTrendPullbackConfiguration({ params, config } as any, oosData, oosCache);
        } else if (strategy === 'bear_breakdown') {
          const config = buildBearBreakdownConfig(params);
          oosMetrics = evaluateBearBreakdownConfiguration({ params, config } as any, oosData, oosCache);
        } else if (strategy === 'keltner_mean_reversion') {
          const config = buildKeltnerMeanReversionConfig(params);
          oosMetrics = evaluateKeltnerMeanReversionConfiguration({ params, config } as any, oosData, oosCache);
        } else {
          process.stdout.write(`SKIP (unsupported: ${strategy})\n`);
          skipped++;
          continue;
        }

        const oosTrades: ProfileTrade[] = (oosMetrics.trades ?? []).map(t => ({
          entry_date: t.entryDate,
          exit_date: t.exitDate,
          entry_price: t.entryPrice,
          exit_price: t.exitPrice,
          won: t.pnlPct > 0,
        }));

        saveStrategyProfile({ ...profile, oos_trades: oosTrades }, DATA_DIR);
        process.stdout.write(`OK (${oosTrades.length} trades)\n`);
        updated++;
      } catch (e) {
        process.stdout.write(`FAIL (${e instanceof Error ? e.message : String(e)})\n`);
        failed++;
      }
    }
  }

  console.log(`\nDone: ${total} profiles, ${updated} updated, ${skipped} skipped, ${failed} failed`);
}

backfill().catch(console.error);
