"use strict";
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
const vitest_1 = require("vitest");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const monitor_process_js_1 = require("../../src/monitor-process.js");
const ConfigStore = __importStar(require("../../src/config-store.js"));
/** Helper: flush microtask queue so async start() completes its first poll */
function flushMicrotasks() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
/**
 * A mock YahooFinanceClient that returns deterministic prices for known tickers.
 */
function createMockYahooClient() {
    return {
        async chart() { return { quotes: [] }; },
        async quote(symbol) {
            if (Array.isArray(symbol)) {
                return symbol.map((s) => ({
                    symbol: s.toUpperCase(),
                    regularMarketPrice: 200,
                }));
            }
            return {
                symbol: symbol.toUpperCase(),
                regularMarketPrice: 200,
            };
        },
    };
}
(0, vitest_1.describe)('monitor-process', () => {
    (0, vitest_1.describe)('parseArgs', () => {
        (0, vitest_1.it)('parses all three arguments correctly', () => {
            const result = (0, monitor_process_js_1.parseArgs)([
                '--config', '/tmp/config.json',
                '--data-dir', '/tmp/data',
                '--interval', '30',
            ]);
            (0, vitest_1.expect)(result).toEqual({
                configPath: '/tmp/config.json',
                dataDir: '/tmp/data',
                interval: 30,
            });
        });
        (0, vitest_1.it)('uses default interval of 60 when not provided', () => {
            const result = (0, monitor_process_js_1.parseArgs)([
                '--config', '/tmp/config.json',
                '--data-dir', '/tmp/data',
            ]);
            (0, vitest_1.expect)(result.interval).toBe(60);
        });
        (0, vitest_1.it)('handles arguments in any order', () => {
            const result = (0, monitor_process_js_1.parseArgs)([
                '--interval', '45',
                '--data-dir', '/tmp/data',
                '--config', '/tmp/config.json',
            ]);
            (0, vitest_1.expect)(result.configPath).toBe('/tmp/config.json');
            (0, vitest_1.expect)(result.dataDir).toBe('/tmp/data');
            (0, vitest_1.expect)(result.interval).toBe(45);
        });
        (0, vitest_1.it)('throws when --config is missing', () => {
            (0, vitest_1.expect)(() => (0, monitor_process_js_1.parseArgs)(['--data-dir', '/tmp/data', '--interval', '30']))
                .toThrow('Missing required argument: --config');
        });
        (0, vitest_1.it)('throws when --data-dir is missing', () => {
            (0, vitest_1.expect)(() => (0, monitor_process_js_1.parseArgs)(['--config', '/tmp/config.json', '--interval', '30']))
                .toThrow('Missing required argument: --data-dir');
        });
        (0, vitest_1.it)('throws when interval is not a positive number', () => {
            (0, vitest_1.expect)(() => (0, monitor_process_js_1.parseArgs)([
                '--config', '/tmp/config.json',
                '--data-dir', '/tmp/data',
                '--interval', '-5',
            ])).toThrow('Invalid interval value');
        });
        (0, vitest_1.it)('throws when interval is zero', () => {
            (0, vitest_1.expect)(() => (0, monitor_process_js_1.parseArgs)([
                '--config', '/tmp/config.json',
                '--data-dir', '/tmp/data',
                '--interval', '0',
            ])).toThrow('Invalid interval value');
        });
        (0, vitest_1.it)('throws when interval is NaN', () => {
            (0, vitest_1.expect)(() => (0, monitor_process_js_1.parseArgs)([
                '--config', '/tmp/config.json',
                '--data-dir', '/tmp/data',
                '--interval', 'abc',
            ])).toThrow('Invalid interval value');
        });
    });
    (0, vitest_1.describe)('buildSignalFilePath', () => {
        (0, vitest_1.it)('builds path with PID in the data directory', () => {
            const result = (0, monitor_process_js_1.buildSignalFilePath)('/tmp/data', 12345);
            (0, vitest_1.expect)(result).toBe(path.join('/tmp/data', 'signals-12345.json'));
        });
        (0, vitest_1.it)('works with different PIDs', () => {
            const result = (0, monitor_process_js_1.buildSignalFilePath)('/home/user/.stock-tracker', 99999);
            (0, vitest_1.expect)(result).toBe(path.join('/home/user/.stock-tracker', 'signals-99999.json'));
        });
    });
    (0, vitest_1.describe)('startMonitorProcess', () => {
        let tmpDir;
        let configPath;
        let dataDir;
        (0, vitest_1.beforeEach)(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-process-test-'));
            configPath = path.join(tmpDir, 'config.json');
            dataDir = path.join(tmpDir, 'data');
            fs.mkdirSync(dataDir, { recursive: true });
            // Write a valid config with a watchlist entry
            const config = ConfigStore.getDefault();
            config.watchlist = [
                {
                    ticker: 'AAPL',
                    addedAt: '2025-01-15T10:00:00Z',
                    strategies: [
                        {
                            type: 'price_breakout',
                            params: { upperLevel: 150, lowerLevel: 100 },
                            enabled: true,
                        },
                    ],
                },
            ];
            ConfigStore.save(config, configPath);
        });
        (0, vitest_1.afterEach)(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });
        (0, vitest_1.it)('loads config and starts the monitoring engine', async () => {
            const { engine, priceDataStore, priceDataFilePath } = (0, monitor_process_js_1.startMonitorProcess)({ configPath, dataDir, interval: 3600 }, 12345, createMockYahooClient());
            (0, vitest_1.expect)(engine.isRunning()).toBe(true);
            (0, vitest_1.expect)(priceDataFilePath).toBe(path.join(dataDir, 'price-data.json'));
            // Wait for the async first poll to complete
            await flushMicrotasks();
            // At least one poll cycle should have run (immediate poll on start)
            (0, vitest_1.expect)(engine.getPollCyclesCompleted()).toBeGreaterThanOrEqual(1);
            // Price data should have been fetched for AAPL
            const history = priceDataStore.getPriceHistory('AAPL');
            (0, vitest_1.expect)(history.length).toBeGreaterThanOrEqual(1);
            engine.stop();
        });
        (0, vitest_1.it)('creates signal file in data dir based on PID', async () => {
            const { engine } = (0, monitor_process_js_1.startMonitorProcess)({ configPath, dataDir, interval: 3600 }, 54321, createMockYahooClient());
            // Wait for the async first poll to complete
            await flushMicrotasks();
            // The signal file should exist after the first poll cycle generates signals
            const signalFilePath = path.join(dataDir, 'signals-54321.json');
            // Signal file is created only if signals are generated
            // With price_breakout and AAPL mock price (200) > 150, a BUY signal should be written
            (0, vitest_1.expect)(fs.existsSync(signalFilePath)).toBe(true);
            engine.stop();
        });
        (0, vitest_1.it)('throws when config file is invalid', () => {
            fs.writeFileSync(configPath, 'not valid json');
            (0, vitest_1.expect)(() => (0, monitor_process_js_1.startMonitorProcess)({ configPath, dataDir, interval: 3600 }, 12345, createMockYahooClient())).toThrow('Failed to load config');
        });
        (0, vitest_1.it)('works with empty watchlist', async () => {
            const emptyConfig = ConfigStore.getDefault();
            ConfigStore.save(emptyConfig, configPath);
            const { engine } = (0, monitor_process_js_1.startMonitorProcess)({ configPath, dataDir, interval: 3600 }, 12345, createMockYahooClient());
            (0, vitest_1.expect)(engine.isRunning()).toBe(true);
            // Wait for the async first poll to complete
            await flushMicrotasks();
            (0, vitest_1.expect)(engine.getPollCyclesCompleted()).toBe(1);
            engine.stop();
        });
        (0, vitest_1.it)('loads existing price data from data dir', async () => {
            // Write some existing price data
            const priceDataPath = path.join(dataDir, 'price-data.json');
            const existingData = {
                AAPL: [
                    { ticker: 'AAPL', price: 100, timestamp: '2025-01-14T10:00:00Z' },
                ],
            };
            fs.writeFileSync(priceDataPath, JSON.stringify(existingData));
            const { engine, priceDataStore } = (0, monitor_process_js_1.startMonitorProcess)({ configPath, dataDir, interval: 3600 }, 12345, createMockYahooClient());
            // Wait for the async first poll to complete
            await flushMicrotasks();
            // Should have the pre-existing data point plus the new one from the poll
            const history = priceDataStore.getPriceHistory('AAPL');
            (0, vitest_1.expect)(history.length).toBeGreaterThanOrEqual(2);
            (0, vitest_1.expect)(history[0].price).toBe(100);
            engine.stop();
        });
    });
});
//# sourceMappingURL=monitor-process.test.js.map