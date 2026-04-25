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
(0, vitest_1.describe)('Command Wiring', () => {
    let tmpDir;
    let wired;
    (0, vitest_1.beforeEach)(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-wiring-'));
        wired = (0, command_wiring_js_1.createWiredRouter)({
            dataDir: tmpDir,
            configPath: path.join(tmpDir, 'config.json'),
            priceDataPath: path.join(tmpDir, 'price-data.json'),
        });
    });
    (0, vitest_1.afterEach)(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    // ============================================================
    // Initialization
    // ============================================================
    (0, vitest_1.describe)('initialization', () => {
        (0, vitest_1.it)('creates a router with all 8 commands registered', () => {
            const commands = wired.router.getRegisteredCommands();
            (0, vitest_1.expect)(commands).toHaveLength(8);
            (0, vitest_1.expect)(commands).toContain('add-stock');
            (0, vitest_1.expect)(commands).toContain('remove-stock');
            (0, vitest_1.expect)(commands).toContain('list-watchlist');
            (0, vitest_1.expect)(commands).toContain('start-monitor');
            (0, vitest_1.expect)(commands).toContain('stop-monitor');
            (0, vitest_1.expect)(commands).toContain('get-status');
            (0, vitest_1.expect)(commands).toContain('configure-strategy');
            (0, vitest_1.expect)(commands).toContain('show-signals');
        });
        (0, vitest_1.it)('loads existing config on initialization', () => {
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
            });
            const result = w.router.dispatch({ command: 'list-watchlist', options: {} });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.stocks).toHaveLength(1);
            (0, vitest_1.expect)(result.data.stocks[0].ticker).toBe('AAPL');
        });
        (0, vitest_1.it)('uses default config when config file is missing', () => {
            const result = wired.router.dispatch({ command: 'list-watchlist', options: {} });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.stocks).toHaveLength(0);
        });
    });
    // ============================================================
    // add-stock
    // ============================================================
    (0, vitest_1.describe)('add-stock handler', () => {
        (0, vitest_1.it)('adds a valid stock to the watchlist', () => {
            const result = wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.command).toBe('add-stock');
            (0, vitest_1.expect)(result.data.ticker).toBe('AAPL');
            (0, vitest_1.expect)(result.data.addedAt).toBeTruthy();
        });
        (0, vitest_1.it)('persists the added stock to config file', () => {
            wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
            const configPath = path.join(tmpDir, 'config.json');
            const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            (0, vitest_1.expect)(saved.watchlist).toHaveLength(1);
            (0, vitest_1.expect)(saved.watchlist[0].ticker).toBe('AAPL');
        });
        (0, vitest_1.it)('returns error for invalid ticker', () => {
            const result = wired.router.dispatch({ command: 'add-stock', options: { ticker: 'ZZZZZZ' } });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.INVALID_TICKER);
        });
        (0, vitest_1.it)('returns error for duplicate stock', () => {
            wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
            const result = wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.DUPLICATE_STOCK);
        });
    });
    // ============================================================
    // remove-stock
    // ============================================================
    (0, vitest_1.describe)('remove-stock handler', () => {
        (0, vitest_1.it)('removes an existing stock from the watchlist', () => {
            wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
            const result = wired.router.dispatch({ command: 'remove-stock', options: { ticker: 'AAPL' } });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.ticker).toBe('AAPL');
        });
        (0, vitest_1.it)('returns error when removing non-existent stock', () => {
            const result = wired.router.dispatch({ command: 'remove-stock', options: { ticker: 'AAPL' } });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.STOCK_NOT_FOUND);
        });
        (0, vitest_1.it)('persists removal to config file', () => {
            wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
            wired.router.dispatch({ command: 'remove-stock', options: { ticker: 'AAPL' } });
            const configPath = path.join(tmpDir, 'config.json');
            const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            (0, vitest_1.expect)(saved.watchlist).toHaveLength(0);
        });
    });
    // ============================================================
    // list-watchlist
    // ============================================================
    (0, vitest_1.describe)('list-watchlist handler', () => {
        (0, vitest_1.it)('returns empty list when no stocks added', () => {
            const result = wired.router.dispatch({ command: 'list-watchlist', options: {} });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.stocks).toHaveLength(0);
            (0, vitest_1.expect)(result.data.count).toBe(0);
        });
        (0, vitest_1.it)('returns stocks with last known price from PriceDataStore', () => {
            wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
            // Add a price point to the store
            wired.priceDataStore.addPricePoint('AAPL', {
                ticker: 'AAPL',
                price: 195.50,
                timestamp: '2025-01-15T10:00:00Z',
            });
            const result = wired.router.dispatch({ command: 'list-watchlist', options: {} });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.stocks).toHaveLength(1);
            (0, vitest_1.expect)(result.data.stocks[0].ticker).toBe('AAPL');
            (0, vitest_1.expect)(result.data.stocks[0].lastPrice).toBe(195.50);
            (0, vitest_1.expect)(result.data.stocks[0].lastPriceTimestamp).toBe('2025-01-15T10:00:00Z');
        });
        (0, vitest_1.it)('returns null price when no price data exists', () => {
            wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
            const result = wired.router.dispatch({ command: 'list-watchlist', options: {} });
            (0, vitest_1.expect)(result.data.stocks[0].lastPrice).toBeNull();
            (0, vitest_1.expect)(result.data.stocks[0].lastPriceTimestamp).toBeNull();
        });
    });
    // ============================================================
    // get-status
    // ============================================================
    (0, vitest_1.describe)('get-status handler', () => {
        (0, vitest_1.it)('returns stopped state when no monitor is running', () => {
            const result = wired.router.dispatch({ command: 'get-status', options: {} });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.state).toBe('stopped');
        });
    });
    // ============================================================
    // stop-monitor
    // ============================================================
    (0, vitest_1.describe)('stop-monitor handler', () => {
        (0, vitest_1.it)('returns error when no monitor is running', () => {
            const result = wired.router.dispatch({ command: 'stop-monitor', options: {} });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.MONITOR_NOT_RUNNING);
        });
    });
    // ============================================================
    // configure-strategy
    // ============================================================
    (0, vitest_1.describe)('configure-strategy handler', () => {
        (0, vitest_1.beforeEach)(() => {
            wired.router.dispatch({ command: 'add-stock', options: { ticker: 'AAPL' } });
        });
        (0, vitest_1.it)('configures a strategy with params', () => {
            const result = wired.router.dispatch({
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
        (0, vitest_1.it)('configures a strategy with default params when none provided', () => {
            const result = wired.router.dispatch({
                command: 'configure-strategy',
                options: { ticker: 'AAPL', strategy: 'moving_average_crossover' },
            });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.params).toEqual({ shortWindow: 10, longWindow: 50 });
        });
        (0, vitest_1.it)('returns error for stock not in watchlist', () => {
            const result = wired.router.dispatch({
                command: 'configure-strategy',
                options: { ticker: 'GOOGL', strategy: 'rsi_threshold' },
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.STOCK_NOT_FOUND);
        });
        (0, vitest_1.it)('returns error for invalid strategy params', () => {
            const result = wired.router.dispatch({
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
        (0, vitest_1.it)('toggles strategy enabled state', () => {
            // First configure the strategy
            wired.router.dispatch({
                command: 'configure-strategy',
                options: { ticker: 'AAPL', strategy: 'rsi_threshold',
                    params: '{"period":14,"overbought":70,"oversold":30}' },
            });
            // Disable it
            const result = wired.router.dispatch({
                command: 'configure-strategy',
                options: { ticker: 'AAPL', strategy: 'rsi_threshold', enabled: 'false' },
            });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.enabled).toBe(false);
        });
        (0, vitest_1.it)('persists strategy configuration to config file', () => {
            wired.router.dispatch({
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
        (0, vitest_1.it)('returns empty signals when no active session', () => {
            const result = wired.router.dispatch({ command: 'show-signals', options: {} });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.signals).toHaveLength(0);
            (0, vitest_1.expect)(result.data.message).toContain('No active monitoring session');
        });
        (0, vitest_1.it)('reads signals from signal file when session exists', () => {
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
            // Use a fresh wired router and manually set the signal file path
            const mockProcessManager = wired.processManager;
            mockProcessManager.processInfo = {
                pid: 99999,
                signalFilePath,
                sessionStartTime: '2025-01-15T10:00:00Z',
                pollingInterval: 60,
            };
            const result = wired.router.dispatch({ command: 'show-signals', options: {} });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.signals).toHaveLength(2);
            // Should be ordered by timestamp descending
            (0, vitest_1.expect)(result.data.signals[0].timestamp).toBe('2025-01-15T11:01:00Z');
            (0, vitest_1.expect)(result.data.signals[1].timestamp).toBe('2025-01-15T10:01:00Z');
        });
        (0, vitest_1.it)('respects --limit option', () => {
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
            const result = wired.router.dispatch({ command: 'show-signals', options: { limit: '2' } });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.data.signals).toHaveLength(2);
            (0, vitest_1.expect)(result.data.count).toBe(2);
        });
    });
    // ============================================================
    // End-to-end workflow via execute
    // ============================================================
    (0, vitest_1.describe)('end-to-end via execute', () => {
        (0, vitest_1.it)('add-stock returns valid JSON output', () => {
            const output = wired.router.execute(['add-stock', '--ticker', 'MSFT']);
            const parsed = JSON.parse(output);
            (0, vitest_1.expect)(parsed.success).toBe(true);
            (0, vitest_1.expect)(parsed.command).toBe('add-stock');
            (0, vitest_1.expect)(parsed.data.ticker).toBe('MSFT');
        });
        (0, vitest_1.it)('full add → list → remove → list workflow', () => {
            // Add
            let result = wired.router.dispatch({ command: 'add-stock', options: { ticker: 'MSFT' } });
            (0, vitest_1.expect)(result.success).toBe(true);
            // List
            result = wired.router.dispatch({ command: 'list-watchlist', options: {} });
            (0, vitest_1.expect)(result.data.count).toBe(1);
            // Remove
            result = wired.router.dispatch({ command: 'remove-stock', options: { ticker: 'MSFT' } });
            (0, vitest_1.expect)(result.success).toBe(true);
            // List again
            result = wired.router.dispatch({ command: 'list-watchlist', options: {} });
            (0, vitest_1.expect)(result.data.count).toBe(0);
        });
    });
});
//# sourceMappingURL=command-wiring.test.js.map