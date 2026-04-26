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
exports.createWiredRouter = createWiredRouter;
const path = __importStar(require("node:path"));
const command_router_js_1 = require("./command-router.js");
const config_store_js_1 = require("./config-store.js");
const price_data_store_js_1 = require("./price-data-store.js");
const price_feed_client_js_1 = require("./price-feed-client.js");
const watchlist_manager_js_1 = require("./watchlist-manager.js");
const strategy_manager_js_1 = require("./strategy-manager.js");
const process_manager_js_1 = require("./process-manager.js");
const signal_store_js_1 = require("./signal-store.js");
const types_js_1 = require("./types.js");
/**
 * Create a fully wired CommandRouter with real handlers connected to domain components.
 * Loads config and price data on initialization.
 */
function createWiredRouter(options = {}) {
    const dataDir = options.dataDir ?? '.stock-tracker';
    const configPath = options.configPath ?? path.join(dataDir, 'config.json');
    const priceDataPath = options.priceDataPath ?? path.join(dataDir, 'price-data.json');
    // Load config (or use defaults if file doesn't exist / is invalid)
    const configResult = (0, config_store_js_1.load)(configPath);
    const config = configResult.success ? configResult.data : (0, config_store_js_1.getDefault)();
    // Load price data
    const priceDataStore = new price_data_store_js_1.PriceDataStore();
    priceDataStore.load(priceDataPath);
    // Create domain components
    const priceFeedClient = new price_feed_client_js_1.PriceFeedClient(options.yahooFinanceClient);
    const watchlistManager = new watchlist_manager_js_1.WatchlistManager(config, configPath);
    const strategyManager = new strategy_manager_js_1.StrategyManager(config, configPath);
    const processManager = new process_manager_js_1.ProcessManager(dataDir);
    // Create router and wire handlers
    const router = new command_router_js_1.CommandRouter();
    // --- add-stock ---
    router.register('add-stock', ['ticker'], async (opts) => {
        const ticker = opts['ticker'].toUpperCase();
        // Validate ticker via PriceFeedClient
        const validation = await priceFeedClient.validateTicker(ticker);
        if (!validation.success) {
            return (0, command_router_js_1.errorResult)('add-stock', types_js_1.ErrorCodes.INVALID_TICKER, `Ticker symbol '${ticker}' not found in price feed`);
        }
        // Add via WatchlistManager
        const result = watchlistManager.addStock(ticker);
        if (!result.success) {
            const code = result.error.includes(types_js_1.ErrorCodes.DUPLICATE_STOCK)
                ? types_js_1.ErrorCodes.DUPLICATE_STOCK : 'ADD_FAILED';
            return (0, command_router_js_1.errorResult)('add-stock', code, result.error);
        }
        return (0, command_router_js_1.successResult)('add-stock', {
            ticker: result.data.ticker,
            addedAt: result.data.addedAt,
            message: `Stock '${ticker}' added to watchlist`,
        });
    });
    // --- remove-stock ---
    router.register('remove-stock', ['ticker'], (opts) => {
        const ticker = opts['ticker'].toUpperCase();
        const result = watchlistManager.removeStock(ticker);
        if (!result.success) {
            const code = result.error.includes(types_js_1.ErrorCodes.STOCK_NOT_FOUND)
                ? types_js_1.ErrorCodes.STOCK_NOT_FOUND : 'REMOVE_FAILED';
            return (0, command_router_js_1.errorResult)('remove-stock', code, result.error);
        }
        return (0, command_router_js_1.successResult)('remove-stock', {
            ticker,
            message: `Stock '${ticker}' removed from watchlist`,
        });
    });
    // --- list-watchlist ---
    router.register('list-watchlist', [], (_opts) => {
        const stocks = watchlistManager.listStocks();
        const enriched = stocks.map((entry) => {
            const history = priceDataStore.getPriceHistory(entry.ticker);
            const lastPrice = history.length > 0 ? history[history.length - 1] : null;
            return {
                ticker: entry.ticker,
                addedAt: entry.addedAt,
                strategies: entry.strategies.length,
                lastPrice: lastPrice ? lastPrice.price : null,
                lastPriceTimestamp: lastPrice ? lastPrice.timestamp : null,
            };
        });
        return (0, command_router_js_1.successResult)('list-watchlist', { stocks: enriched, count: enriched.length });
    });
    // --- start-monitor ---
    router.register('start-monitor', [], (opts) => {
        const interval = opts['interval'] ? parseInt(opts['interval'], 10) : 60;
        const result = processManager.spawn({
            configPath,
            pollingInterval: interval,
            dataDir,
        });
        if (!result.success) {
            return (0, command_router_js_1.errorResult)('start-monitor', result.error.code, result.error.message);
        }
        return (0, command_router_js_1.successResult)('start-monitor', {
            pid: result.data.pid,
            signalFilePath: result.data.signalFilePath,
            sessionStartTime: result.data.sessionStartTime,
            pollingInterval: result.data.pollingInterval,
            message: 'Monitoring started',
        });
    });
    // --- stop-monitor ---
    router.register('stop-monitor', [], (_opts) => {
        const result = processManager.terminate();
        if (!result.success) {
            return (0, command_router_js_1.errorResult)('stop-monitor', result.error.code, result.error.message);
        }
        return (0, command_router_js_1.successResult)('stop-monitor', { message: 'Monitoring stopped' });
    });
    // --- get-status ---
    router.register('get-status', [], (_opts) => {
        const status = processManager.getStatus();
        return (0, command_router_js_1.successResult)('get-status', status);
    });
    // --- configure-strategy ---
    router.register('configure-strategy', ['ticker', 'strategy'], (opts) => {
        const ticker = opts['ticker'].toUpperCase();
        const strategyType = opts['strategy'];
        // Handle --enabled toggle (without params means just toggle)
        if (opts['enabled'] !== undefined && !opts['params']) {
            const enabled = opts['enabled'].toLowerCase() === 'true';
            const toggleResult = enabled
                ? strategyManager.enableStrategy(ticker, strategyType)
                : strategyManager.disableStrategy(ticker, strategyType);
            if (!toggleResult.success) {
                const code = toggleResult.error.includes(types_js_1.ErrorCodes.STOCK_NOT_FOUND)
                    ? types_js_1.ErrorCodes.STOCK_NOT_FOUND : types_js_1.ErrorCodes.INVALID_PARAM_RANGE;
                return (0, command_router_js_1.errorResult)('configure-strategy', code, toggleResult.error);
            }
            return (0, command_router_js_1.successResult)('configure-strategy', {
                ticker,
                strategy: strategyType,
                enabled,
                message: `Strategy '${strategyType}' ${enabled ? 'enabled' : 'disabled'} for '${ticker}'`,
            });
        }
        // Parse params JSON (default to empty object if not provided)
        let params;
        if (opts['params']) {
            params = JSON.parse(opts['params']);
        }
        else {
            // Use default params based on strategy type
            params = getDefaultParams(strategyType);
        }
        // Configure strategy via StrategyManager
        const result = strategyManager.configureStrategy(ticker, strategyType, params);
        if (!result.success) {
            const code = result.error.includes(types_js_1.ErrorCodes.STOCK_NOT_FOUND)
                ? types_js_1.ErrorCodes.STOCK_NOT_FOUND
                : result.error.includes(types_js_1.ErrorCodes.INVALID_PARAM_RANGE)
                    ? types_js_1.ErrorCodes.INVALID_PARAM_RANGE
                    : 'CONFIGURE_FAILED';
            return (0, command_router_js_1.errorResult)('configure-strategy', code, result.error);
        }
        // Handle --enabled toggle after configuration
        if (opts['enabled'] !== undefined) {
            const enabled = opts['enabled'].toLowerCase() === 'true';
            if (!enabled) {
                strategyManager.disableStrategy(ticker, strategyType);
            }
        }
        return (0, command_router_js_1.successResult)('configure-strategy', {
            ticker,
            strategy: strategyType,
            params,
            message: `Strategy '${strategyType}' configured for '${ticker}'`,
        });
    });
    // --- show-signals ---
    router.register('show-signals', [], (opts) => {
        const limit = opts['limit'] ? parseInt(opts['limit'], 10) : undefined;
        // Get signal file path from the active session
        const signalFilePath = processManager.getSignalFilePath();
        if (!signalFilePath) {
            return (0, command_router_js_1.successResult)('show-signals', {
                signals: [],
                count: 0,
                message: 'No active monitoring session. No signals to display.',
            });
        }
        const signalStore = new signal_store_js_1.SignalStore(signalFilePath);
        const signals = signalStore.getSignalHistory(limit);
        return (0, command_router_js_1.successResult)('show-signals', {
            signals,
            count: signals.length,
        });
    });
    // --- history ---
    router.register('history', ['ticker'], async (opts) => {
        const ticker = opts['ticker'];
        const period = opts['period'] || undefined;
        const interval = opts['interval'] || undefined;
        const result = await priceFeedClient.fetchHistoricalData(ticker, period, interval);
        if (!result.success) {
            const code = result.error.includes(types_js_1.ErrorCodes.INVALID_TICKER)
                ? types_js_1.ErrorCodes.INVALID_TICKER
                : result.error.includes(types_js_1.ErrorCodes.INVALID_PARAM_RANGE)
                    ? types_js_1.ErrorCodes.INVALID_PARAM_RANGE
                    : types_js_1.ErrorCodes.PRICE_FEED_UNAVAILABLE;
            return (0, command_router_js_1.errorResult)('history', code, result.error);
        }
        return (0, command_router_js_1.successResult)('history', {
            ticker: result.data.ticker,
            period: period || '1y',
            interval: result.data.interval,
            dataPoints: result.data.dataPoints,
            count: result.data.dataPoints.length,
        });
    });
    return {
        router,
        config,
        priceDataStore,
        priceFeedClient,
        watchlistManager,
        strategyManager,
        processManager,
    };
}
function getDefaultParams(strategyType) {
    switch (strategyType) {
        case 'moving_average_crossover':
            return { shortWindow: 10, longWindow: 50 };
        case 'rsi_threshold':
            return { period: 14, overbought: 70, oversold: 30 };
        case 'price_breakout':
            return { upperLevel: 100, lowerLevel: 50 };
    }
}
//# sourceMappingURL=command-wiring.js.map