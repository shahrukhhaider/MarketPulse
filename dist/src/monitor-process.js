"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseArgs = parseArgs;
exports.buildSignalFilePath = buildSignalFilePath;
exports.startMonitorProcess = startMonitorProcess;
const path = __importStar(require("node:path"));
const price_feed_client_js_1 = require("./price-feed-client.js");
const price_data_store_js_1 = require("./price-data-store.js");
const monitoring_engine_js_1 = require("./monitoring-engine.js");
const ConfigStore = __importStar(require("./config-store.js"));
function parseArgs(argv) {
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
function buildSignalFilePath(dataDir, pid) {
    return path.join(dataDir, `signals-${pid}.json`);
}
function startMonitorProcess(args, pid, yahooFinanceClient) {
    // Load config
    const configResult = ConfigStore.load(args.configPath);
    if (!configResult.success) {
        throw new Error(`Failed to load config: ${configResult.error}`);
    }
    const config = configResult.data;
    // Create dependencies
    const priceFeedClient = new price_feed_client_js_1.PriceFeedClient(yahooFinanceClient);
    const priceDataStore = new price_data_store_js_1.PriceDataStore();
    const priceDataFilePath = path.join(args.dataDir, 'price-data.json');
    // Load existing price data
    priceDataStore.load(priceDataFilePath);
    // Derive signal file path from PID
    const signalFilePath = buildSignalFilePath(args.dataDir, pid);
    // Create and start the monitoring engine
    const engine = new monitoring_engine_js_1.MonitoringEngine(priceFeedClient, priceDataStore);
    engine.start(args.interval, config.watchlist, signalFilePath);
    return { engine, priceDataStore, priceDataFilePath };
}
// Only run as main entry point (not when imported for testing)
const isMainModule = typeof process !== 'undefined' &&
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
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`monitor-process error: ${message}\n`);
        process.exit(1);
    }
}
//# sourceMappingURL=monitor-process.js.map