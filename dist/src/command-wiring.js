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
const data_provider_js_1 = require("./data-provider.js");
const yahoo_finance_adapter_js_1 = require("./yahoo-finance-adapter.js");
const backtest_engine_js_1 = require("./backtest-engine.js");
const moving_average_js_1 = require("./strategies/moving-average.js");
const rsi_threshold_js_1 = require("./strategies/rsi-threshold.js");
const price_breakout_js_1 = require("./strategies/price-breakout.js");
const composite_engine_js_1 = require("./strategies/composite-engine.js");
const strategy_configs_js_1 = require("./strategies/strategy-configs.js");
const caching_data_provider_js_1 = require("./caching-data-provider.js");
const tuning_engine_js_1 = require("./tuning-engine.js");
const history_cache_store_js_1 = require("./history-cache-store.js");
const chart_generator_js_1 = require("./chart-generator.js");
const node_fs_1 = require("node:fs");
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
    // Create registry and register the Yahoo Finance adapter
    const registry = new data_provider_js_1.DataProviderRegistry();
    const yahooAdapter = new yahoo_finance_adapter_js_1.YahooFinanceAdapter(options.yahooFinanceClient);
    registry.register(yahooAdapter);
    // Resolve active provider: use requested provider or fall back to yahoo
    const activeProvider = (options.providerName ? registry.get(options.providerName) : undefined) ?? registry.get('yahoo');
    // Wrap the active provider in CachingDataProvider
    const cachingProvider = new caching_data_provider_js_1.CachingDataProvider(activeProvider, {
        cacheDir: path.join(dataDir, 'history-cache'),
        ttlMs: undefined, // use default 24h
        noCache: options.noCache,
    });
    // Create domain components
    const priceFeedClient = new price_feed_client_js_1.PriceFeedClient(cachingProvider);
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
        const noCache = opts['no-cache'] !== undefined;
        let result;
        if (noCache) {
            // Bypass cache: call inner provider directly, then write through to cache
            result = await cachingProvider.innerProvider.getHistoricalData(ticker, period, interval);
            if (result.success) {
                const effectivePeriod = period ?? '1y';
                const entry = {
                    ticker: (0, history_cache_store_js_1.normalizeTicker)(ticker),
                    period: effectivePeriod,
                    interval: result.data.interval,
                    fetchedAt: new Date().toISOString(),
                    dataPoints: result.data.dataPoints,
                };
                cachingProvider.cacheStore.write(entry);
            }
        }
        else {
            result = await priceFeedClient.fetchHistoricalData(ticker, period, interval);
        }
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
    // --- backtest ---
    const VALID_STRATEGY_TYPES = [
        'moving_average_crossover',
        'rsi_threshold',
        'price_breakout',
        'momentum_continuation',
        'trend_pullback',
        'breakout_volume',
    ];
    router.register('backtest', ['ticker', 'strategy'], async (opts) => {
        const ticker = opts['ticker'].toUpperCase();
        const strategyType = opts['strategy'];
        // Validate strategy type
        if (!VALID_STRATEGY_TYPES.includes(strategyType)) {
            return (0, command_router_js_1.errorResult)('backtest', types_js_1.ErrorCodes.INVALID_PARAM_RANGE, `Invalid strategy type '${opts['strategy']}'. Valid types: ${VALID_STRATEGY_TYPES.join(', ')}`);
        }
        // Resolve strategy instance
        const strategyInstance = getStrategyInstance(strategyType);
        // Parse and validate optional --params
        let params;
        if (opts['params']) {
            try {
                params = JSON.parse(opts['params']);
            }
            catch {
                return (0, command_router_js_1.errorResult)('backtest', types_js_1.ErrorCodes.INVALID_PARAM_RANGE, `Invalid JSON for --params: ${opts['params']}`);
            }
            const validation = strategyInstance.validateParams(params);
            if (!validation.valid) {
                return (0, command_router_js_1.errorResult)('backtest', types_js_1.ErrorCodes.INVALID_PARAM_RANGE, `${types_js_1.ErrorCodes.INVALID_PARAM_RANGE}: ${validation.error}`);
            }
        }
        else {
            params = getDefaultParams(strategyType);
        }
        // Use optional --period, defaulting to "1y"
        const period = opts['period'] || '1y';
        const noCache = opts['no-cache'] !== undefined;
        // Fetch historical data
        try {
            let histResult;
            if (noCache) {
                // Bypass cache: call inner provider directly, then write through to cache
                histResult = await cachingProvider.innerProvider.getHistoricalData(ticker, period);
                if (histResult.success) {
                    const entry = {
                        ticker: (0, history_cache_store_js_1.normalizeTicker)(ticker),
                        period,
                        interval: histResult.data.interval,
                        fetchedAt: new Date().toISOString(),
                        dataPoints: histResult.data.dataPoints,
                    };
                    cachingProvider.cacheStore.write(entry);
                }
            }
            else {
                histResult = await priceFeedClient.fetchHistoricalData(ticker, period);
            }
            if (!histResult.success) {
                const code = histResult.error.includes(types_js_1.ErrorCodes.INVALID_TICKER)
                    ? types_js_1.ErrorCodes.INVALID_TICKER
                    : histResult.error.includes(types_js_1.ErrorCodes.INVALID_PARAM_RANGE)
                        ? types_js_1.ErrorCodes.INVALID_PARAM_RANGE
                        : types_js_1.ErrorCodes.PRICE_FEED_UNAVAILABLE;
                return (0, command_router_js_1.errorResult)('backtest', code, histResult.error);
            }
            // Convert historical data to PricePoint[]
            const pricePoints = (0, backtest_engine_js_1.convertHistoricalData)(histResult.data.dataPoints, ticker);
            // For composite strategies: fetch auxiliary data if needed and reset engine state
            if ('config' in params) {
                const compositeParams = params;
                // Inject primary ticker's OHLCV data for volume/ATR calculations
                compositeParams.primaryDataPoints = histResult.data.dataPoints;
                const indexTicker = compositeParams.config.indexTicker;
                if (indexTicker) {
                    try {
                        const auxResult = await priceFeedClient.fetchHistoricalData(indexTicker, period);
                        if (auxResult.success) {
                            compositeParams.auxiliaryData = {
                                [indexTicker]: auxResult.data.dataPoints,
                            };
                        }
                    }
                    catch {
                        // Auxiliary data fetch failure is non-fatal; outperforms_index will just fail
                    }
                }
                // Reset composite engine state before backtest
                strategyInstance.reset?.();
            }
            // Run backtest
            const engine = new backtest_engine_js_1.BacktestEngine();
            const backtestResult = engine.run(pricePoints, strategyInstance, params, period);
            // If --chart flag is present and backtest succeeded, generate HTML visualization
            if (opts['chart'] !== undefined) {
                const chartFilePath = (0, chart_generator_js_1.getChartFilePath)(dataDir, ticker);
                const html = (0, chart_generator_js_1.generateChartHtml)({
                    backtestResult,
                    dataPoints: histResult.data.dataPoints,
                    strategyParams: params,
                });
                (0, node_fs_1.writeFileSync)(chartFilePath, html, 'utf-8');
                (0, chart_generator_js_1.openInBrowser)(chartFilePath);
                return (0, command_router_js_1.successResult)('backtest', { ...backtestResult, chartFilePath });
            }
            return (0, command_router_js_1.successResult)('backtest', backtestResult);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return (0, command_router_js_1.errorResult)('backtest', types_js_1.ErrorCodes.PRICE_FEED_UNAVAILABLE, message);
        }
    });
    // --- clear-cache ---
    router.register('clear-cache', [], (opts) => {
        const ticker = opts['ticker'] ? opts['ticker'].toUpperCase() : undefined;
        const result = cachingProvider.clearCache(ticker);
        return (0, command_router_js_1.successResult)('clear-cache', {
            removed: result.removed,
            message: ticker
                ? `Cleared ${result.removed} cache entries for '${ticker}'`
                : `Cleared ${result.removed} cache entries`,
        });
    });
    // --- tune ---
    router.register('tune', ['ticker', 'strategy'], async (opts) => {
        const input = {
            ticker: opts['ticker'].toUpperCase(),
            strategy: opts['strategy'],
            time_horizon: opts['horizon'],
            risk_profile: opts['risk'],
            noCache: opts['no-cache'] !== undefined,
        };
        const tuningEngine = new tuning_engine_js_1.TuningEngine(cachingProvider, dataDir);
        const outcome = await tuningEngine.run(input);
        if (!outcome.success) {
            return (0, command_router_js_1.errorResult)('tune', outcome.error.code, outcome.error.message);
        }
        return (0, command_router_js_1.successResult)('tune', outcome.data);
    });
    return {
        router,
        config,
        priceDataStore,
        priceFeedClient,
        watchlistManager,
        strategyManager,
        processManager,
        registry,
        cachingProvider,
    };
}
function getStrategyInstance(strategyType) {
    switch (strategyType) {
        case 'moving_average_crossover':
            return new moving_average_js_1.MovingAverageCrossoverStrategy();
        case 'rsi_threshold':
            return new rsi_threshold_js_1.RSIThresholdStrategy();
        case 'price_breakout':
            return new price_breakout_js_1.PriceBreakoutStrategy();
        case 'momentum_continuation':
        case 'trend_pullback':
        case 'breakout_volume':
            return new composite_engine_js_1.CompositeStrategyEngine(strategyType);
    }
}
function getDefaultParams(strategyType) {
    switch (strategyType) {
        case 'moving_average_crossover':
            return { shortWindow: 10, longWindow: 50 };
        case 'rsi_threshold':
            return { period: 14, overbought: 70, oversold: 30 };
        case 'price_breakout':
            return { upperLevel: 100, lowerLevel: 50 };
        case 'momentum_continuation':
        case 'trend_pullback':
        case 'breakout_volume':
            return { config: (0, strategy_configs_js_1.getDefaultCompositeConfig)(strategyType) };
    }
}
//# sourceMappingURL=command-wiring.js.map