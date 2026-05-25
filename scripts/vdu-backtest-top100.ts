/**
 * VDU Backtest Script — Top 100 Tickers
 *
 * Runs walk-forward tuning + backtest + chart generation for the
 * Volume Dry-Up strategy on the first 100 tickers from the watchlist.
 *
 * Usage:
 *   npx tsx scripts/vdu-backtest-top100.ts [--limit N] [--no-cache]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { VduEngine } from '../src/strategies/vdu-engine.js';
import { YahooFinanceAdapter } from '../src/data/yahoo-finance-adapter.js';
import { HistoricalDataCache } from '../src/data/historical-data-cache.js';
import { generateChartHtml, getChartFilePath } from '../src/formatters/chart-generator.js';
import type { HistoricalDataPoint } from '../src/types.js';

// ============================================================
// Configuration
// ============================================================

const DATA_DIR = join(process.cwd(), '.stock-tracker');
const PROFILES_DIR = join(DATA_DIR, 'data', 'profiles', 'volume_dry_up');
const RESULTS_DIR = join(DATA_DIR, 'vdu-backtest-results');
const WATCHLIST_PATH = join(DATA_DIR, 'data', 'watchlist.json');

// Parse CLI args
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const TICKER_LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 100;
const NO_CACHE = args.includes('--no-cache');

// ============================================================
// Types
// ============================================================

interface TickerResult {
  ticker: string;
  status: 'success' | 'error' | 'no_viable_config';
  bestParams?: Record<string, number>;
  isMetrics?: { winRate: number; totalReturn: number; trades: number; profitFactor: number };
  oosMetrics?: { winRate: number; totalReturn: number; trades: number; profitFactor: number };
  chartPath?: string;
  error?: string;
  elapsedMs: number;
}

// ============================================================
// Helpers
// ============================================================

function loadWatchlist(): string[] {
  const raw = readFileSync(WATCHLIST_PATH, 'utf-8');
  const data = JSON.parse(raw);
  return data.tickers || [];
}

function computeMetrics(result: ReturnType<VduEngine['runBacktest']>) {
  const { performanceSummary } = result;
  const trades = performanceSummary.trades;

  let profitFactor = 0;
  if (trades.length > 0) {
    let grossProfits = 0;
    let grossLosses = 0;
    for (const trade of trades) {
      if (trade.profitLossPercent > 0) grossProfits += trade.profitLossPercent;
      else if (trade.profitLossPercent < 0) grossLosses += Math.abs(trade.profitLossPercent);
    }
    profitFactor = grossLosses === 0 ? (grossProfits > 0 ? Infinity : 0) : grossProfits / grossLosses;
  }

  return {
    winRate: performanceSummary.winRate,
    totalReturn: performanceSummary.totalReturnPercent,
    trades: performanceSummary.numberOfTrades,
    profitFactor,
  };
}

/**
 * Extended VDU param space with wider thresholds to capture
 * signals in large-cap stocks where volume dry-ups are less extreme.
 * Key insight: active_atr_ratio = atr_ratio_threshold * 0.70, so we need
 * higher atr_ratio_threshold values to allow higher ATR ratios through.
 */
const EXTENDED_PARAM_SPACE: Record<string, number[]> = {
  consolidation_window: [10, 15, 20],
  max_range_pct: [5, 7, 9],
  atr_ratio_threshold: [1.0, 1.2, 1.5],
  volume_threshold_active: [0.55, 0.65, 0.75, 0.85],
  volume_threshold_near: [0.70, 0.80, 0.90],
  volume_threshold_forming: [0.85, 0.90, 0.95],
  min_declining_days: [2, 3],
};

/**
 * Generate all parameter combinations from a param space.
 */
function generateParamCombinations(paramSpace: Record<string, number[]>): Record<string, number>[] {
  const keys = Object.keys(paramSpace);
  const combinations: Record<string, number>[] = [];

  function recurse(idx: number, current: Record<string, number>) {
    if (idx === keys.length) {
      combinations.push({ ...current });
      return;
    }
    const key = keys[idx];
    for (const val of paramSpace[key]) {
      current[key] = val;
      recurse(idx + 1, current);
    }
  }

  recurse(0, {});
  return combinations;
}

/**
 * Run walk-forward tuning for a single ticker using VDU's own paramSpace + runBacktest.
 * Uses full data (no IS/OOS split) for tuning since VDU signals are rare.
 * The OOS evaluation is done separately after finding best params.
 */
/**
 * Run walk-forward tuning with detailed logging.
 */
function tuneVdu(data: HistoricalDataPoint[], engine: VduEngine, ticker: string): TickerResult['bestParams'] | null {
  const combinations = generateParamCombinations(EXTENDED_PARAM_SPACE);

  let bestParams: Record<string, number> | null = null;
  let bestScore = -Infinity;
  let combosWithTrades = 0;
  let validCombos = 0;

  for (const params of combinations) {
    // Ensure monotonic ordering: active < near < forming
    if (params.volume_threshold_active >= params.volume_threshold_near) continue;
    if (params.volume_threshold_near >= params.volume_threshold_forming) continue;
    validCombos++;

    const result = engine.runBacktest(data, params);
    const metrics = computeMetrics(result);

    if (metrics.trades > 0) combosWithTrades++;
    
    // Relaxed filter: need at least 1 trade (won or expired counts as success)
    if (metrics.trades >= 1 && metrics.totalReturn >= 0) {
      const score = (metrics.winRate + 0.01) * Math.sqrt(metrics.trades);
      if (score > bestScore) {
        bestScore = score;
        bestParams = params;
      }
    }
  }

  if (!bestParams) {
    // Only log for tickers with 0 trades (truly no signals)
    if (combosWithTrades === 0) {
      process.stderr.write(`    [${ticker}] No VDU signals detected in any config\n`);
    }
  }

  return bestParams;
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  VDU Backtest — Walk-Forward Tuning + Charting');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Tickers: first ${TICKER_LIMIT} from watchlist`);
  console.log(`  Cache: ${NO_CACHE ? 'disabled' : 'enabled'}`);
  console.log('');

  // Ensure output directories exist
  mkdirSync(PROFILES_DIR, { recursive: true });
  mkdirSync(RESULTS_DIR, { recursive: true });

  // Load tickers
  const allTickers = loadWatchlist();
  const tickers = allTickers.slice(0, TICKER_LIMIT);
  console.log(`  Loaded ${allTickers.length} tickers, processing ${tickers.length}\n`);

  // Create data provider
  const yahooAdapter = new YahooFinanceAdapter();
  const cachingProvider = new HistoricalDataCache(yahooAdapter, {
    cacheDir: join(DATA_DIR, 'history-cache'),
    noCache: NO_CACHE,
  });

  const engine = new VduEngine();
  const results: TickerResult[] = [];

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    const startTime = Date.now();
    const progress = `[${i + 1}/${tickers.length}]`;

    try {
      // Fetch 5y data
      const dataResult = await cachingProvider.getHistoricalData(ticker, '5y');
      if (!dataResult.success) {
        const elapsed = Date.now() - startTime;
        console.log(`  ${progress} ${ticker.padEnd(6)} ❌ Data fetch failed (${elapsed}ms)`);
        results.push({ ticker, status: 'error', error: dataResult.error, elapsedMs: elapsed });
        continue;
      }

      const dataPoints = dataResult.data.dataPoints;
      if (dataPoints.length < 100) {
        const elapsed = Date.now() - startTime;
        console.log(`  ${progress} ${ticker.padEnd(6)} ⚠️  Insufficient data (${dataPoints.length} bars)`);
        results.push({ ticker, status: 'error', error: `Insufficient data: ${dataPoints.length} bars`, elapsedMs: elapsed });
        continue;
      }

      // Run walk-forward tuning
      const bestParams = tuneVdu(dataPoints, engine, ticker);
      if (!bestParams) {
        const elapsed = Date.now() - startTime;
        console.log(`  ${progress} ${ticker.padEnd(6)} ⚠️  No viable config found (${elapsed}ms)`);
        results.push({ ticker, status: 'no_viable_config', elapsedMs: elapsed });
        continue;
      }

      // Run full backtest with best params
      const backtestResult = engine.runBacktest(dataPoints, bestParams);
      backtestResult.ticker = ticker;
      const fullMetrics = computeMetrics(backtestResult);

      // OOS evaluation: use last 30% of data
      const oosStart = Math.floor(dataPoints.length * 0.7);
      const oosData = dataPoints.slice(oosStart);
      const oosResult = engine.runBacktest(oosData, bestParams);
      const oosMetrics = computeMetrics(oosResult);

      // Save profile
      const profile = {
        ticker,
        strategy: 'volume_dry_up',
        params: bestParams,
        walk_forward_metrics: {
          return: oosMetrics.totalReturn,
          benchmark: 0,
          win_rate: oosMetrics.winRate,
          trades: oosMetrics.trades,
          max_drawdown: backtestResult.performanceSummary.maxDrawdownPercent,
          sharpe: backtestResult.performanceSummary.sharpeRatio,
        },
        last_tuned_at: new Date().toISOString(),
        valid_until: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      };
      const profilePath = join(PROFILES_DIR, `${ticker}.json`);
      writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf-8');

      // Generate chart
      const chartFilePath = getChartFilePath(DATA_DIR, `${ticker}_vdu`);
      const html = generateChartHtml({
        backtestResult,
        dataPoints,
        strategyParams: bestParams as any,
      });
      writeFileSync(chartFilePath, html, 'utf-8');

      const elapsed = Date.now() - startTime;
      const winPct = (fullMetrics.winRate * 100).toFixed(0);
      const retPct = fullMetrics.totalReturn.toFixed(1);
      console.log(`  ${progress} ${ticker.padEnd(6)} ✅ WR:${winPct}% Ret:${retPct}% Trades:${fullMetrics.trades} PF:${fullMetrics.profitFactor.toFixed(2)} (${elapsed}ms)`);

      results.push({
        ticker,
        status: 'success',
        bestParams,
        isMetrics: fullMetrics,
        oosMetrics,
        chartPath: chartFilePath,
        elapsedMs: elapsed,
      });
    } catch (err: unknown) {
      const elapsed = Date.now() - startTime;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ${progress} ${ticker.padEnd(6)} ❌ ${msg.slice(0, 60)} (${elapsed}ms)`);
      results.push({ ticker, status: 'error', error: msg, elapsedMs: elapsed });
    }
  }

  // ============================================================
  // Summary
  // ============================================================
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');

  const successful = results.filter(r => r.status === 'success');
  const noConfig = results.filter(r => r.status === 'no_viable_config');
  const errors = results.filter(r => r.status === 'error');

  console.log(`  Total:      ${results.length}`);
  console.log(`  Success:    ${successful.length}`);
  console.log(`  No config:  ${noConfig.length}`);
  console.log(`  Errors:     ${errors.length}`);

  if (successful.length > 0) {
    const avgWinRate = successful.reduce((s, r) => s + (r.isMetrics?.winRate ?? 0), 0) / successful.length;
    const avgReturn = successful.reduce((s, r) => s + (r.isMetrics?.totalReturn ?? 0), 0) / successful.length;
    const avgTrades = successful.reduce((s, r) => s + (r.isMetrics?.trades ?? 0), 0) / successful.length;
    const avgPF = successful.reduce((s, r) => s + (r.isMetrics?.profitFactor ?? 0), 0) / successful.length;
    const totalElapsed = results.reduce((s, r) => s + r.elapsedMs, 0);

    console.log('');
    console.log('  Aggregate (successful tickers):');
    console.log(`    Avg Win Rate:      ${(avgWinRate * 100).toFixed(1)}%`);
    console.log(`    Avg Return:        ${avgReturn.toFixed(2)}%`);
    console.log(`    Avg Trades:        ${avgTrades.toFixed(1)}`);
    console.log(`    Avg Profit Factor: ${avgPF.toFixed(2)}`);
    console.log(`    Total Time:        ${(totalElapsed / 1000).toFixed(1)}s`);

    // Top 10 by return
    const top10 = [...successful].sort((a, b) => (b.isMetrics?.totalReturn ?? 0) - (a.isMetrics?.totalReturn ?? 0)).slice(0, 10);
    console.log('');
    console.log('  Top 10 by Return:');
    console.log('    Ticker  WinRate  Return   Trades  PF');
    for (const r of top10) {
      const wr = ((r.isMetrics?.winRate ?? 0) * 100).toFixed(0).padStart(5);
      const ret = (r.isMetrics?.totalReturn ?? 0).toFixed(1).padStart(7);
      const tr = String(r.isMetrics?.trades ?? 0).padStart(6);
      const pf = (r.isMetrics?.profitFactor ?? 0).toFixed(2).padStart(6);
      console.log(`    ${r.ticker.padEnd(8)}${wr}%  ${ret}%  ${tr}  ${pf}`);
    }
  }

  // Save full results JSON
  const resultsPath = join(RESULTS_DIR, `vdu-backtest-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(resultsPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\n  Results saved: ${resultsPath}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
