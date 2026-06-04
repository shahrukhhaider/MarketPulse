// ============================================================
// Initial Tune — Tech Universe
// ============================================================
// Identifies tickers in the tech watchlist that are NOT present in the
// large_cap watchlist (net-new tickers), then invokes tune-pipeline in
// batches to generate tuned profiles for them before the first scan.
//
// CLI equivalent per batch:
//   node dist/src/cli.js tune-pipeline --tickers <batch> --strategy v3
//       --concurrency 8 --universe tech --save
// ============================================================

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, join } from 'node:path';

// ============================================================
// Types
// ============================================================

export interface InitialTuneResult {
  netNewCount: number;
  batchesRun: number;
  batchesFailed: number;
  failedTickers: string[];
}

export interface InitialTuneOptions {
  batchSize: number;
  concurrency: number;
  universe: 'tech';
}

// ============================================================
// Constants
// ============================================================

const PROJECT_DIR = resolve(__dirname, '..', '..');
const DATA_DIR = join(PROJECT_DIR, '.stock-tracker', 'data');
const TECH_WATCHLIST_PATH = join(DATA_DIR, 'watchlist-tech.json');
const LARGECAP_WATCHLIST_PATH = join(DATA_DIR, 'watchlist.json');
const CLI_PATH = join(PROJECT_DIR, 'dist', 'src', 'cli.js');

// ============================================================
// Core Functions
// ============================================================

/**
 * Identify tickers present in techTickers but absent from largecapTickers.
 * Comparison is case-insensitive; results are returned in uppercase.
 */
export function identifyNetNewTickers(
  techTickers: string[],
  largecapTickers: string[],
): string[] {
  const largecapSet = new Set(largecapTickers.map((t) => t.toUpperCase()));
  return techTickers
    .map((t) => t.toUpperCase())
    .filter((t) => !largecapSet.has(t));
}

/**
 * Split a list of tickers into batches of the given size.
 */
export function splitIntoBatches(tickers: string[], batchSize: number): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < tickers.length; i += batchSize) {
    batches.push(tickers.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Load and parse a JSON watchlist file. Returns the tickers array.
 * Throws with a descriptive message on read/parse failure.
 */
export function loadWatchlistFile(filePath: string, label: string): string[] {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${label} (${filePath}): ${msg}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${label} (${filePath}): ${msg}`);
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as { tickers?: unknown }).tickers)
  ) {
    throw new Error(
      `Invalid format in ${label} (${filePath}): expected { "tickers": [...] }`,
    );
  }

  return (parsed as { tickers: string[] }).tickers;
}

/**
 * Run initial tuning for net-new tech tickers.
 *
 * 1. Loads both watchlist files
 * 2. Identifies net-new tickers (tech minus large_cap)
 * 3. If none, logs skip message and returns
 * 4. Batches net-new tickers (default 50 per batch)
 * 5. Invokes tune-pipeline per batch with concurrency 8
 * 6. On batch failure: logs failed tickers, continues remaining
 * 7. Returns result summary; caller should exit non-zero if batchesFailed > 0
 */
export function runInitialTuning(
  options: InitialTuneOptions = { batchSize: 50, concurrency: 8, universe: 'tech' },
): InitialTuneResult {
  // Load watchlist files
  const techTickers = loadWatchlistFile(TECH_WATCHLIST_PATH, 'watchlist-tech.json');
  const largecapTickers = loadWatchlistFile(LARGECAP_WATCHLIST_PATH, 'watchlist.json');

  // Identify net-new tickers
  const netNew = identifyNetNewTickers(techTickers, largecapTickers);

  if (netNew.length === 0) {
    console.log(
      'Initial tune (tech): 0 net-new tickers require tuning — all tech tickers already exist in large_cap.',
    );
    return {
      netNewCount: 0,
      batchesRun: 0,
      batchesFailed: 0,
      failedTickers: [],
    };
  }

  console.log(`Initial tune (tech): ${netNew.length} net-new tickers identified for tuning.`);

  // Split into batches
  const batches = splitIntoBatches(netNew, options.batchSize);
  let batchesFailed = 0;
  const failedTickers: string[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchLabel = `Batch ${i + 1}/${batches.length}`;
    const tickerList = batch.join(',');

    console.log(`  ${batchLabel}: tuning ${batch.length} tickers...`);

    try {
      execSync(
        `node "${CLI_PATH}" tune-pipeline --tickers "${tickerList}" --strategy v3 --concurrency ${options.concurrency} --universe ${options.universe} --save`,
        {
          cwd: PROJECT_DIR,
          stdio: 'pipe',
          timeout: 0, // no timeout — tuning can be long
        },
      );
      console.log(`  ${batchLabel}: ✓ complete`);
    } catch {
      batchesFailed++;
      failedTickers.push(...batch);
      console.error(`  ${batchLabel}: ✗ failed — tickers: ${tickerList}`);
    }
  }

  const result: InitialTuneResult = {
    netNewCount: netNew.length,
    batchesRun: batches.length,
    batchesFailed,
    failedTickers,
  };

  if (batchesFailed > 0) {
    console.error(
      `Initial tune (tech): ${batchesFailed}/${batches.length} batches failed. ` +
        `Failed tickers: ${failedTickers.join(', ')}`,
    );
  } else {
    console.log(
      `Initial tune (tech): all ${batches.length} batches completed successfully.`,
    );
  }

  return result;
}

// ============================================================
// Entry Point — run when executed directly
// ============================================================

const isMainModule =
  process.argv[1]?.includes('initial-tune-tech') ||
  process.argv[1]?.endsWith('initial-tune-tech.js');

if (isMainModule) {
  try {
    const result = runInitialTuning({
      batchSize: 50,
      concurrency: 8,
      universe: 'tech',
    });

    if (result.batchesFailed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error(
      `ERROR: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
