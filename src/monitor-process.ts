/**
 * Background process entry point.
 *
 * ProcessManager spawns this script with:
 *   --config <configPath> --data-dir <dataDir> --interval <seconds>
 *
 * The process:
 *  1. Parses CLI arguments
 *  2. Loads config from the config file
 *  3. Creates PriceFeedClient, PriceDataStore, and MonitoringEngine
 *  4. Derives signal file path from its own PID: signals-{pid}.json in data dir
 *  5. Starts the MonitoringEngine with the watchlist, interval, and signal file path
 *  6. Handles SIGTERM/SIGINT for graceful shutdown
 */

import * as path from 'node:path';
import { PriceFeedClient } from './price-feed-client.js';
import { PriceDataStore } from './price-data-store.js';
import { MonitoringEngine } from './monitoring-engine.js';
import * as ConfigStore from './config-store.js';

export interface ParsedArgs {
  configPath: string;
  dataDir: string;
  interval: number;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let configPath = '';
  let dataDir = '';
  let interval = 60;

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--config':
        configPath = argv[++i] ?? '';
        break;
      case '--data-dir':
        dataDir = argv[++i] ?? '';
        break;
      case '--interval':
        interval = Number(argv[++i]);
        break;
    }
  }

  if (!configPath) {
    throw new Error('Missing required argument: --config');
  }
  if (!dataDir) {
    throw new Error('Missing required argument: --data-dir');
  }
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new Error(`Invalid interval value: ${interval}. Must be a positive number.`);
  }

  return { configPath, dataDir, interval };
}

export function buildSignalFilePath(dataDir: string, pid: number): string {
  return path.join(dataDir, `signals-${pid}.json`);
}

export function startMonitorProcess(args: ParsedArgs, pid: number): {
  engine: MonitoringEngine;
  priceDataStore: PriceDataStore;
  priceDataFilePath: string;
} {
  // Load config
  const configResult = ConfigStore.load(args.configPath);
  if (!configResult.success) {
    throw new Error(`Failed to load config: ${configResult.error}`);
  }
  const config = configResult.data;

  // Create dependencies
  const priceFeedClient = new PriceFeedClient();
  const priceDataStore = new PriceDataStore();
  const priceDataFilePath = path.join(args.dataDir, 'price-data.json');

  // Load existing price data
  priceDataStore.load(priceDataFilePath);

  // Derive signal file path from PID
  const signalFilePath = buildSignalFilePath(args.dataDir, pid);

  // Create and start the monitoring engine
  const engine = new MonitoringEngine(priceFeedClient, priceDataStore);
  engine.start(args.interval, config.watchlist, signalFilePath);

  return { engine, priceDataStore, priceDataFilePath };
}

// Only run as main entry point (not when imported for testing)
const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('monitor-process.js') ||
   process.argv[1].endsWith('monitor-process.ts'));

if (isMainModule) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { engine, priceDataStore, priceDataFilePath } = startMonitorProcess(args, process.pid);

    const shutdown = () => {
      engine.stop();
      priceDataStore.save(priceDataStore.getHistory(), priceDataFilePath);
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`monitor-process error: ${message}\n`);
    process.exit(1);
  }
}
