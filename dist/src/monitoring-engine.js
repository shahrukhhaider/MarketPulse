"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MonitoringEngine = void 0;
const signal_store_js_1 = require("./signal-store.js");
const moving_average_js_1 = require("./strategies/moving-average.js");
const rsi_threshold_js_1 = require("./strategies/rsi-threshold.js");
const price_breakout_js_1 = require("./strategies/price-breakout.js");
class MonitoringEngine {
    priceFeedClient;
    priceDataStore;
    signalStore = null;
    watchlist = [];
    strategies;
    intervalId = null;
    running = false;
    pollCyclesCompleted = 0;
    lastPollTimestamp = null;
    /** Tracks the last emitted signal per ticker+strategy for duplicate suppression */
    lastSignals = new Map();
    constructor(priceFeedClient, priceDataStore) {
        this.priceFeedClient = priceFeedClient;
        this.priceDataStore = priceDataStore;
        this.strategies = new Map();
        this.strategies.set('moving_average_crossover', new moving_average_js_1.MovingAverageCrossoverStrategy());
        this.strategies.set('rsi_threshold', new rsi_threshold_js_1.RSIThresholdStrategy());
        this.strategies.set('price_breakout', new price_breakout_js_1.PriceBreakoutStrategy());
    }
    start(interval, watchlist, signalFilePath) {
        if (this.running) {
            return;
        }
        this.watchlist = watchlist;
        this.signalStore = new signal_store_js_1.SignalStore(signalFilePath);
        this.running = true;
        this.pollCyclesCompleted = 0;
        this.lastPollTimestamp = null;
        this.lastSignals.clear();
        // Initialize lastSignals from existing signal store to support duplicate suppression across restarts
        this.initializeLastSignals();
        // Run first poll immediately, then at interval
        const startAsync = async () => {
            await this.pollCycle();
            this.intervalId = setInterval(async () => {
                await this.pollCycle();
            }, interval * 1000);
        };
        startAsync();
    }
    stop() {
        if (!this.running) {
            return;
        }
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.running = false;
    }
    isRunning() {
        return this.running;
    }
    getPollCyclesCompleted() {
        return this.pollCyclesCompleted;
    }
    getLastPollTimestamp() {
        return this.lastPollTimestamp;
    }
    async pollCycle() {
        const errors = [];
        let pricesFetched = 0;
        let signalsGenerated = 0;
        const timestamp = new Date().toISOString();
        const tickers = this.watchlist.map((entry) => entry.ticker);
        if (tickers.length === 0) {
            this.pollCyclesCompleted++;
            this.lastPollTimestamp = timestamp;
            return { success: true, timestamp, pricesFetched: 0, signalsGenerated: 0, errors: [] };
        }
        // Fetch prices for all watchlist stocks
        const batchResult = await this.priceFeedClient.fetchBatchPrices(tickers);
        if (!batchResult.success) {
            // Price feed unavailable: log, retain last prices, retry next cycle
            const errorMsg = `Price feed unavailable: ${batchResult.error}`;
            errors.push(errorMsg);
            this.pollCyclesCompleted++;
            this.lastPollTimestamp = timestamp;
            return { success: false, timestamp, pricesFetched: 0, signalsGenerated: 0, errors };
        }
        const priceMap = batchResult.data;
        const allNewSignals = [];
        for (const entry of this.watchlist) {
            const ticker = entry.ticker;
            const pricePoint = priceMap.get(ticker);
            if (!pricePoint) {
                errors.push(`No price data returned for ${ticker}`);
                continue;
            }
            // Calculate price change from previous price
            const existingHistory = this.priceDataStore.getPriceHistory(ticker);
            const enrichedPoint = { ...pricePoint };
            if (existingHistory.length > 0) {
                const previousPrice = existingHistory[existingHistory.length - 1].price;
                enrichedPoint.change = enrichedPoint.price - previousPrice;
                enrichedPoint.changePercent = ((enrichedPoint.price - previousPrice) / previousPrice) * 100;
            }
            // Store the price point
            this.priceDataStore.addPricePoint(ticker, enrichedPoint);
            pricesFetched++;
            // Evaluate strategies for this stock
            const updatedHistory = this.priceDataStore.getPriceHistory(ticker);
            const signals = this.evaluateStrategies(ticker, updatedHistory, entry.strategies);
            allNewSignals.push(...signals);
        }
        // Write non-duplicate BUY/SELL signals
        if (allNewSignals.length > 0) {
            this.writeSignals(allNewSignals);
            signalsGenerated = allNewSignals.length;
        }
        this.pollCyclesCompleted++;
        this.lastPollTimestamp = timestamp;
        return {
            success: errors.length === 0,
            timestamp,
            pricesFetched,
            signalsGenerated,
            errors,
        };
    }
    evaluateStrategies(ticker, priceHistory, strategyConfigs) {
        const signals = [];
        for (const config of strategyConfigs) {
            // Skip disabled strategies
            if (!config.enabled) {
                continue;
            }
            const strategy = this.strategies.get(config.type);
            if (!strategy) {
                continue;
            }
            // Check minimum data points
            const minPoints = this.getMinimumDataPoints(strategy, config);
            if (priceHistory.length < minPoints) {
                // Insufficient data — skip evaluation
                continue;
            }
            try {
                const signal = strategy.evaluate(priceHistory, config.params);
                // Only emit BUY or SELL signals (not HOLD)
                if (signal.direction === 'HOLD') {
                    continue;
                }
                // Check for duplicate consecutive signal (same ticker + strategy + direction)
                const signalKey = `${ticker}:${config.type}`;
                const lastSignal = this.lastSignals.get(signalKey);
                if (lastSignal && lastSignal.direction === signal.direction) {
                    // Duplicate consecutive signal — suppress
                    continue;
                }
                // Enrich signal with transition context
                const enrichedSignal = {
                    ...signal,
                    id: this.generateSignalId(),
                    ticker,
                    strategyType: config.type,
                };
                if (lastSignal) {
                    enrichedSignal.previousDirection = lastSignal.direction;
                    enrichedSignal.previousTimestamp = lastSignal.timestamp;
                }
                // Update last signal tracking
                this.lastSignals.set(signalKey, enrichedSignal);
                signals.push(enrichedSignal);
            }
            catch {
                // Strategy evaluation failure — skip this strategy, continue with others
            }
        }
        return signals;
    }
    writeSignals(signals) {
        if (!this.signalStore || signals.length === 0) {
            return;
        }
        this.signalStore.writeSignals(signals);
    }
    getMinimumDataPoints(strategy, config) {
        // Use params-aware minimum if available
        const strategyAny = strategy;
        if (typeof strategyAny.minimumDataPointsForParams === 'function') {
            return strategyAny.minimumDataPointsForParams(config.params);
        }
        return strategy.minimumDataPoints();
    }
    generateSignalId() {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        return `sig_${timestamp}_${random}`;
    }
    initializeLastSignals() {
        if (!this.signalStore) {
            return;
        }
        // Read existing signals to populate lastSignals for duplicate suppression
        const existingSignals = this.signalStore.readSignals();
        for (const signal of existingSignals) {
            const key = `${signal.ticker}:${signal.strategyType}`;
            const existing = this.lastSignals.get(key);
            // Keep the most recent signal per ticker+strategy
            if (!existing || new Date(signal.timestamp) > new Date(existing.timestamp)) {
                this.lastSignals.set(key, signal);
            }
        }
    }
}
exports.MonitoringEngine = MonitoringEngine;
//# sourceMappingURL=monitoring-engine.js.map