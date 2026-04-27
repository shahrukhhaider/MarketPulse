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
const command_wiring_js_1 = require("../../src/command-wiring.js");
const types_js_1 = require("../../src/types.js");
/**
 * A mock YahooFinanceClient that returns deterministic prices for known tickers.
 */
function createMockYahooClient() {
    const knownTickers = new Set(['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'JPM', 'V', 'WMT']);
    return {
        async quote(symbol) {
            if (Array.isArray(symbol)) {
                return symbol.map((s) => {
                    const upper = s.toUpperCase();
                    if (!knownTickers.has(upper)) {
                        throw new Error(`Symbol not found: ${upper}`);
                    }
                    return { symbol: upper, regularMarketPrice: 150 };
                });
            }
            const upper = symbol.toUpperCase();
            if (!knownTickers.has(upper)) {
                throw new Error(`Symbol not found: ${upper}`);
            }
            return { symbol: upper, regularMarketPrice: 150 };
        },
        async chart(symbol, _options) {
            const upper = symbol.toUpperCase();
            if (!knownTickers.has(upper)) {
                throw new Error(`Symbol not found: ${upper}`);
            }
            return {
                quotes: [
                    { date: new Date('2024-01-15'), open: 100, high: 105, low: 99, close: 103, volume: 1000000 },
                    { date: new Date('2024-01-16'), open: 103, high: 108, low: 101, close: 107, volume: 1200000 },
                ],
            };
        },
    };
}
(0, vitest_1.describe)('Command Wiring', () => {
    let tmpDir;
    let wired;
    (0, vitest_1.beforeEach)(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-wiring-'));
        wired = (0, command_wiring_js_1.createWiredRouter)({
            dataDir: tmpDir,
            configPath: path.join(tmpDir, 'config.json'),
            priceDataPath: path.join(tmpDir, 'price-data.json'),
            yahooFinanceClient: createMockYahooClient(),
        });
    });
    (0, vitest_1.afterEach)(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    // ============================================================
    // Initialization
    // ============================================================
    (0, vitest_1.describe)('initialization', () => {
        (0, vitest_1.it)('creates a router with all 11 commands registered', () => {
            const commands = wired.router.getRegisteredCommands();
            (0, vitest_1.expect)(commands).toHaveLength(11);
            (0, vitest_1.expect)(commands).toContain('add-stock');
            (0, vitest_1.expect)(commands).toContain('remove-stock');
            (0, vitest_1.expect)(commands).toContain('list-watchlist');
            (0, vitest_1.expect)(commands).toContain('start-monitor');
            (0, vitest_1.expect)(commands).toContain('stop-monitor');
            (0, vitest_1.expect)(commands).toContain('get-status');
            (0, vitest_1.expect)(commands).toContain('configure-strategy');
            (0, vitest_1.expect)(commands).toContain('show-signals');
            (0, vitest_1.expect)(commands).toContain('backtest');
            (0, vitest_1.expect)(commands).toContain('clear-cache');
        });
        (0, vitest_1.it)('loads existing config on initialization', async () => {
            const configPath = path.join(tmpDir, 'config.json');
            const existingConfig = {
                watchlist: [{ ticker: 'AAPL', addedAt: '2025-01-01T00:00:00Z', strategies: [] }],
                settings: { pollingInterval: 60, retentionDays: 30, dataDir: tmpDir },
            };
            fs.writeFileSync(configPath, JSON.stringify(existingConfig), 'utf-8');
            const w = (0, command_wiring_js_1.createWiredRouter)({
                dataDir: tmpDir,
                configPath,
                priceDataPath: path.join(tmpDir, 'price-data.json'),
                yahooFinanceClient: createMockYahooClient(),
            });
            const result = await w.router.dispatch({ command: 'list-watchlist', options: {} });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.stocks).toHaveLength(1);
            (0, vitest_1.expect)(result.data.stocks[0].ticker).toBe('AAPL');
        });
        (0, vitest_1.it)('uses default config when config file is missing', async () => {
            const result = await wired.router.dispatch({ command: 'list-watchlist', options: {} });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.stocks).toHaveLength(0);
        });
    });
    // ============================================================
    // add-stock
    // ============================================================
    (0, vitest_1.describe)('add-stock handler', () => {
        (0, vitest_1.it)('adds a valid stock to the watchlist', async () => {
            const result = await wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.command).toBe('add-stock');
            (0, vitest_1.expect)(result.data.ticker).toBe('AAPL');
            (0, vitest_1.expect)(result.data.addedAt).toBeTruthy();
        });
        (0, vitest_1.it)('persists the added stock to config file', async () => {
            await wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
            const configPath = path.join(tmpDir, 'config.json');
            const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            (0, vitest_1.expect)(saved.watchlist).toHaveLength(1);
            (0, vitest_1.expect)(saved.watchlist[0].ticker).toBe('AAPL');
        });
        (0, vitest_1.it)('returns error for invalid ticker', async () => {
            const result = await wired.router.dispatch({ command: 'add-stock', options: { ticker: 'ZZZZZZ' } });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.INVALID_TICKER);
        });
        (0, vitest_1.it)('returns error for duplicate stock', async () => {
            await wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
            const result = await wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.DUPLICATE_STOCK);
        });
    });
    // ============================================================
    // remove-stock
    // ============================================================
    (0, vitest_1.describe)('remove-stock handler', () => {
        (0, vitest_1.it)('removes an existing stock from the watchlist', async () => {
            await wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
            const result = await wired.router.dispatch({ command: 'remove-stock', options: { ticker: 'AAPL' } });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.ticker).toBe('AAPL');
        });
        (0, vitest_1.it)('returns error when removing non-existent stock', async () => {
            const result = await wired.router.dispatch({ command: 'remove-stock', options: { ticker: 'AAPL' } });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.STOCK_NOT_FOUND);
        });
        (0, vitest_1.it)('persists removal to config file', async () => {
            await wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
            await wired.router.dispatch({ command: 'remove-stock', options: { ticker: 'AAPL' } });
            const configPath = path.join(tmpDir, 'config.json');
            const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            (0, vitest_1.expect)(saved.watchlist).toHaveLength(0);
        });
    });
    // ============================================================
    // list-watchlist
    // ============================================================
    (0, vitest_1.describe)('list-watchlist handler', () => {
        (0, vitest_1.it)('returns empty list when no stocks added', async () => {
            const result = await wired.router.dispatch({ command: 'list-watchlist', options: {} });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.stocks).toHaveLength(0);
            (0, vitest_1.expect)(result.data.count).toBe(0);
        });
        (0, vitest_1.it)('returns stocks with last known price from PriceDataStore', async () => {
            await wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
            // Add a price point to the store
            wired.priceDataStore.addPricePoint('AAPL', {
                ticker: 'AAPL',
                price: 195.50,
                timestamp: '2025-01-15T10:00:00Z',
            });
            const result = await wired.router.dispatch({ command: 'list-watchlist', options: {} });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.stocks).toHaveLength(1);
            (0, vitest_1.expect)(result.data.stocks[0].ticker).toBe('AAPL');
            (0, vitest_1.expect)(result.data.stocks[0].lastPrice).toBe(195.50);
            (0, vitest_1.expect)(result.data.stocks[0].lastPriceTimestamp).toBe('2025-01-15T10:00:00Z');
        });
        (0, vitest_1.it)('returns null price when no price data exists', async () => {
            await wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
            const result = await wired.router.dispatch({ command: 'list-watchlist', options: {} });
            (0, vitest_1.expect)(result.data.stocks[0].lastPrice).toBeNull();
            (0, vitest_1.expect)(result.data.stocks[0].lastPriceTimestamp).toBeNull();
        });
    });
    // ============================================================
    // get-status
    // ============================================================
    (0, vitest_1.describe)('get-status handler', () => {
        (0, vitest_1.it)('returns stopped state when no monitor is running', async () => {
            const result = await wired.router.dispatch({ command: 'get-status', options: {} });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.state).toBe('stopped');
        });
    });
    // ============================================================
    // stop-monitor
    // ============================================================
    (0, vitest_1.describe)('stop-monitor handler', () => {
        (0, vitest_1.it)('returns error when no monitor is running', async () => {
            const result = await wired.router.dispatch({ command: 'stop-monitor', options: {} });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.MONITOR_NOT_RUNNING);
        });
    });
    // ============================================================
    // configure-strategy
    // ============================================================
    (0, vitest_1.describe)('configure-strategy handler', () => {
        (0, vitest_1.beforeEach)(async () => {
            await wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
        });
        (0, vitest_1.it)('configures a strategy with params', async () => {
            const result = await wired.router.dispatch({
                command: 'configure-strategy',
                options: {
                    ticker: 'AAPL',
                    strategy: 'rsi_threshold',
                    params: '{"period":14,"overbought":70,"oversold":30}',
                },
            });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.ticker).toBe('AAPL');
            (0, vitest_1.expect)(result.data.strategy).toBe('rsi_threshold');
        });
        (0, vitest_1.it)('configures a strategy with default params when none provided', async () => {
            const result = await wired.router.dispatch({
                command: 'configure-strategy',
                options: { ticker: 'AAPL', strategy: 'moving_average_crossover' },
            });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.params).toEqual({ shortWindow: 10, longWindow: 50 });
        });
        (0, vitest_1.it)('returns error for stock not in watchlist', async () => {
            const result = await wired.router.dispatch({
                command: 'configure-strategy',
                options: { ticker: 'GOOGL', strategy: 'rsi_threshold' },
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.STOCK_NOT_FOUND);
        });
        (0, vitest_1.it)('returns error for invalid strategy params', async () => {
            const result = await wired.router.dispatch({
                command: 'configure-strategy',
                options: {
                    ticker: 'AAPL',
                    strategy: 'rsi_threshold',
                    params: '{"period":14,"overbought":30,"oversold":70}',
                },
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
        });
        (0, vitest_1.it)('toggles strategy enabled state', async () => {
            // First configure the strategy
            await wired.router.dispatch({
                command: 'configure-strategy',
                options: { ticker: 'AAPL', strategy: 'rsi_threshold',
                    params: '{"period":14,"overbought":70,"oversold":30}' },
            });
            // Disable it
            const result = await wired.router.dispatch({
                command: 'configure-strategy',
                options: { ticker: 'AAPL', strategy: 'rsi_threshold', enabled: 'false' },
            });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.enabled).toBe(false);
        });
        (0, vitest_1.it)('persists strategy configuration to config file', async () => {
            await wired.router.dispatch({
                command: 'configure-strategy',
                options: {
                    ticker: 'AAPL',
                    strategy: 'price_breakout',
                    params: '{"upperLevel":200,"lowerLevel":150}',
                },
            });
            const configPath = path.join(tmpDir, 'config.json');
            const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            (0, vitest_1.expect)(saved.watchlist[0].strategies).toHaveLength(1);
            (0, vitest_1.expect)(saved.watchlist[0].strategies[0].type).toBe('price_breakout');
        });
    });
    // ============================================================
    // show-signals
    // ============================================================
    (0, vitest_1.describe)('show-signals handler', () => {
        (0, vitest_1.it)('returns empty signals when no active session', async () => {
            const result = await wired.router.dispatch({ command: 'show-signals', options: {} });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.signals).toHaveLength(0);
            (0, vitest_1.expect)(result.data.message).toContain('No active monitoring session');
        });
        (0, vitest_1.it)('reads signals from signal file when session exists', async () => {
            // Simulate an active session by writing a signal file and setting up ProcessManager
            const signalFilePath = path.join(tmpDir, 'signals-99999.json');
            const signalData = {
                sessionPid: 99999,
                signals: [
                    {
                        id: 'sig_001',
                        ticker: 'AAPL',
                        direction: 'BUY',
                        strategyType: 'rsi_threshold',
                        price: 195.50,
                        timestamp: '2025-01-15T10:01:00Z',
                    },
                    {
                        id: 'sig_002',
                        ticker: 'AAPL',
                        direction: 'SELL',
                        strategyType: 'rsi_threshold',
                        price: 200.00,
                        timestamp: '2025-01-15T11:01:00Z',
                    },
                ],
                lastUpdated: '2025-01-15T11:01:00Z',
            };
            fs.writeFileSync(signalFilePath, JSON.stringify(signalData), 'utf-8');
            // We need to mock the processManager to return a signal file path
            const mockProcessManager = wired.processManager;
            mockProcessManager.processInfo = {
                pid: 99999,
                signalFilePath,
                sessionStartTime: '2025-01-15T10:00:00Z',
                pollingInterval: 60,
            };
            const result = await wired.router.dispatch({ command: 'show-signals', options: {} });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.signals).toHaveLength(2);
            // Should be ordered by timestamp descending
            (0, vitest_1.expect)(result.data.signals[0].timestamp).toBe('2025-01-15T11:01:00Z');
            (0, vitest_1.expect)(result.data.signals[1].timestamp).toBe('2025-01-15T10:01:00Z');
        });
        (0, vitest_1.it)('respects --limit option', async () => {
            const signalFilePath = path.join(tmpDir, 'signals-99999.json');
            const signalData = {
                sessionPid: 99999,
                signals: [
                    { id: 'sig_001', ticker: 'AAPL', direction: 'BUY', strategyType: 'rsi_threshold', price: 195, timestamp: '2025-01-15T10:00:00Z' },
                    { id: 'sig_002', ticker: 'AAPL', direction: 'SELL', strategyType: 'rsi_threshold', price: 200, timestamp: '2025-01-15T11:00:00Z' },
                    { id: 'sig_003', ticker: 'GOOGL', direction: 'BUY', strategyType: 'price_breakout', price: 180, timestamp: '2025-01-15T12:00:00Z' },
                ],
                lastUpdated: '2025-01-15T12:00:00Z',
            };
            fs.writeFileSync(signalFilePath, JSON.stringify(signalData), 'utf-8');
            const mockProcessManager = wired.processManager;
            mockProcessManager.processInfo = {
                pid: 99999,
                signalFilePath,
                sessionStartTime: '2025-01-15T10:00:00Z',
                pollingInterval: 60,
            };
            const result = await wired.router.dispatch({ command: 'show-signals', options: { limit: '2' } });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.signals).toHaveLength(2);
            (0, vitest_1.expect)(result.data.count).toBe(2);
        });
    });
    // ============================================================
    // history handler
    // ============================================================
    (0, vitest_1.describe)('history handler', () => {
        (0, vitest_1.it)('returns historical data for a valid ticker', async () => {
            const result = await wired.router.dispatch({
                command: 'history',
                options: { ticker: 'AAPL' },
            });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.command).toBe('history');
            (0, vitest_1.expect)(result.data.ticker).toBe('AAPL');
            (0, vitest_1.expect)(result.data.period).toBe('1y');
            (0, vitest_1.expect)(result.data.interval).toBe('1d');
            (0, vitest_1.expect)(result.data.dataPoints).toHaveLength(2);
            (0, vitest_1.expect)(result.data.count).toBe(2);
        });
        (0, vitest_1.it)('passes period and interval to fetchHistoricalData', async () => {
            const result = await wired.router.dispatch({
                command: 'history',
                options: { ticker: 'MSFT', period: '3mo', interval: '1wk' },
            });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.ticker).toBe('MSFT');
            (0, vitest_1.expect)(result.data.period).toBe('3mo');
            (0, vitest_1.expect)(result.data.interval).toBe('1wk');
        });
        (0, vitest_1.it)('returns error for unknown ticker', async () => {
            const result = await wired.router.dispatch({
                command: 'history',
                options: { ticker: 'ZZZZZZ' },
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.INVALID_TICKER);
        });
        (0, vitest_1.it)('propagates PRICE_FEED_UNAVAILABLE when feed is disabled', async () => {
            wired.priceFeedClient.setAvailable(false);
            const result = await wired.router.dispatch({
                command: 'history',
                options: { ticker: 'AAPL' },
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.PRICE_FEED_UNAVAILABLE);
        });
        (0, vitest_1.it)('returns data points with correct structure', async () => {
            const result = await wired.router.dispatch({
                command: 'history',
                options: { ticker: 'AAPL', period: '1y', interval: '1d' },
            });
            (0, vitest_1.expect)(result.success).toBe(true);
            const dp = result.data.dataPoints[0];
            (0, vitest_1.expect)(dp).toHaveProperty('date');
            (0, vitest_1.expect)(dp).toHaveProperty('open');
            (0, vitest_1.expect)(dp).toHaveProperty('high');
            (0, vitest_1.expect)(dp).toHaveProperty('low');
            (0, vitest_1.expect)(dp).toHaveProperty('close');
            (0, vitest_1.expect)(dp).toHaveProperty('volume');
        });
    });
    // ============================================================
    // End-to-end workflow via execute
    // ============================================================
    (0, vitest_1.describe)('end-to-end via execute', () => {
        (0, vitest_1.it)('add-stock returns valid JSON output', async () => {
            const output = await wired.router.execute(['add-stock', '--ticker', 'MSFT']);
            const parsed = JSON.parse(output);
            (0, vitest_1.expect)(parsed.success).toBe(true);
            (0, vitest_1.expect)(parsed.command).toBe('add-stock');
            (0, vitest_1.expect)(parsed.data.ticker).toBe('MSFT');
        });
        (0, vitest_1.it)('full add → list → remove → list workflow', async () => {
            // Add
            let result = await wired.router.dispatch({ command: 'add-stock', options: { ticker: 'MSFT' } });
            (0, vitest_1.expect)(result.success).toBe(true);
            // List
            result = await wired.router.dispatch({ command: 'list-watchlist', options: {} });
            (0, vitest_1.expect)(result.data.count).toBe(1);
            // Remove
            result = await wired.router.dispatch({ command: 'remove-stock', options: { ticker: 'MSFT' } });
            (0, vitest_1.expect)(result.success).toBe(true);
            // List again
            result = await wired.router.dispatch({ command: 'list-watchlist', options: {} });
            (0, vitest_1.expect)(result.data.count).toBe(0);
        });
    });
});
//# sourceMappingURL=command-wiring.test.js.map