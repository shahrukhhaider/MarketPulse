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
import { PriceDataStore } from './price-data-store.js';
import { MonitoringEngine } from './monitoring-engine.js';
export interface ParsedArgs {
    configPath: string;
    dataDir: string;
    interval: number;
}
export declare function parseArgs(argv: string[]): ParsedArgs;
export declare function buildSignalFilePath(dataDir: string, pid: number): string;
export declare function startMonitorProcess(args: ParsedArgs, pid: number): {
    engine: MonitoringEngine;
    priceDataStore: PriceDataStore;
    priceDataFilePath: string;
};
//# sourceMappingURL=monitor-process.d.ts.map