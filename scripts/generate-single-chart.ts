#!/usr/bin/env npx tsx
/**
 * Generate a single signal chart for a ticker/strategy.
 * Usage: npx tsx scripts/generate-single-chart.ts TICKER STRATEGY ENTRY STOP [TARGET]
 * Example: npx tsx scripts/generate-single-chart.ts ULTA keltner_mean_reversion 350 340 370
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { generateChartImages } from '../src/chart-image-generator.js';
import { loadStrategyProfile } from '../src/data/profile-store.js';
import { HistoricalDataCache } from '../src/data/historical-data-cache.js';
import { YahooFinanceAdapter } from '../src/data/yahoo-finance-adapter.js';
import type { SignalInput } from '../src/chart-types.js';

const [,, ticker, strategy, entryStr, stopStr, targetStr] = process.argv;

if (!ticker || !strategy || !entryStr || !stopStr) {
  console.error('Usage: npx tsx scripts/generate-single-chart.ts TICKER STRATEGY ENTRY STOP [TARGET]');
  process.exit(1);
}

const basePath = process.env.STOCK_TRACKER_HOME ?? process.cwd();
const entry = parseFloat(entryStr);
const stop = parseFloat(stopStr);
const target = targetStr ? parseFloat(targetStr) : null;

// Load backtest summary from profile
let backtestSummary: string | undefined;
const profileResult = loadStrategyProfile(ticker, strategy, {
  allowStale: true,
  baseDir: join(basePath, '.stock-tracker'),
});
if (profileResult.success) {
  const m = profileResult.data.walk_forward_metrics;
  if (m.trades > 0) {
    const winPct = Math.round(m.win_rate * 100);
    const retSign = m.return >= 0 ? '+' : '';
    const retPct = Math.round(m.return);
    backtestSummary = `Win ${winPct}% · ${m.trades} trades · ${retSign}${retPct}% return · Sharpe ${m.sharpe.toFixed(1)}`;
    console.log(`Profile found: ${backtestSummary}`);
  } else {
    console.log(`Profile found for ${ticker}/${strategy} but 0 trades — skipping subtitle`);
  }
} else {
  console.log(`No profile found for ${ticker}/${strategy}`);
}

// Load lightweight-charts JS
const projectRoot = process.cwd();
const lwcPath = resolve(projectRoot, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js');
const lightweightChartsJs = readFileSync(lwcPath, 'utf-8');

// Build signal input
const signalInput: SignalInput = { ticker, strategy, entry, stop, target, backtestSummary };

// Generate chart
const yahooAdapter = new YahooFinanceAdapter();
const cachingProvider = new HistoricalDataCache(yahooAdapter, {
  cacheDir: join(basePath, '.stock-tracker', 'history-cache'),
});

async function main() {
  console.log(`Generating chart for ${ticker} (${strategy})...`);
  const results = await generateChartImages([signalInput], { dataProvider: cachingProvider, lightweightChartsJs });

  if (results[0].success) {
    const outputPath = join(basePath, `${ticker.toLowerCase()}_${strategy}_signal.png`);
    writeFileSync(outputPath, results[0].pngBuffer);
    console.log(`✅ Chart saved: ${outputPath}`);
  } else {
    console.error(`❌ Chart failed: ${results[0].reason}`);
    process.exit(1);
  }
}

main();
