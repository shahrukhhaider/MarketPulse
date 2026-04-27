"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BacktestEngine = void 0;
exports.convertHistoricalData = convertHistoricalData;
exports.computePerformanceSummary = computePerformanceSummary;
function convertHistoricalData(dataPoints, ticker) {
    return dataPoints.map((dp) => ({
        ticker,
        price: dp.close,
        timestamp: dp.date,
    }));
}
function computePerformanceSummary(signals, pricePoints) {
    // Pair BUY signals with the next SELL signal chronologically
    const trades = [];
    let i = 0;
    while (i < signals.length) {
        if (signals[i].direction === 'BUY') {
            // Find the next SELL after this BUY
            let j = i + 1;
            while (j < signals.length && signals[j].direction !== 'SELL') {
                j++;
            }
            if (j < signals.length) {
                const buySignal = signals[i];
                const sellSignal = signals[j];
                const profitLossPercent = ((sellSignal.price - buySignal.price) / buySignal.price) * 100;
                trades.push({ buySignal, sellSignal, profitLossPercent });
                i = j + 1;
            }
            else {
                // No matching SELL — unpaired trailing BUY, skip
                break;
            }
        }
        else {
            i++;
        }
    }
    const numberOfTrades = trades.length;
    // Benchmark return: buy-and-hold percentage change from first to last price point
    let benchmarkReturnPercent = 0;
    if (pricePoints.length >= 2) {
        const firstPrice = pricePoints[0].price;
        const lastPrice = pricePoints[pricePoints.length - 1].price;
        benchmarkReturnPercent = ((lastPrice - firstPrice) / firstPrice) * 100;
    }
    // Total return: cumulative return from strategy trades (0 if no trades)
    let totalReturnPercent = 0;
    if (trades.length > 0) {
        let cumulativeValue = 1;
        for (const trade of trades) {
            cumulativeValue *= 1 + trade.profitLossPercent / 100;
        }
        totalReturnPercent = (cumulativeValue - 1) * 100;
    }
    // Win rate
    const profitableTrades = trades.filter((t) => t.profitLossPercent > 0).length;
    const winRate = numberOfTrades > 0 ? profitableTrades / numberOfTrades : 0;
    // Max drawdown: largest peak-to-trough decline in cumulative portfolio value
    let maxDrawdownPercent = 0;
    if (trades.length > 0) {
        let cumulativeValue = 1;
        let peak = 1;
        for (const trade of trades) {
            cumulativeValue *= 1 + trade.profitLossPercent / 100;
            if (cumulativeValue > peak) {
                peak = cumulativeValue;
            }
            const drawdown = ((peak - cumulativeValue) / peak) * 100;
            if (drawdown > maxDrawdownPercent) {
                maxDrawdownPercent = drawdown;
            }
        }
    }
    // Sharpe ratio: mean / stddev of per-trade returns (0 if fewer than 2 trades)
    let sharpeRatio = 0;
    if (numberOfTrades >= 2) {
        const returns = trades.map((t) => t.profitLossPercent);
        const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
        const stddev = Math.sqrt(variance);
        sharpeRatio = stddev !== 0 ? mean / stddev : 0;
    }
    return {
        totalReturnPercent,
        benchmarkReturnPercent,
        numberOfTrades,
        winRate,
        maxDrawdownPercent,
        trades,
        sharpeRatio,
    };
}
class BacktestEngine {
    run(pricePoints, strategy, params, period = '1y') {
        const signals = [];
        const ticker = pricePoints.length > 0 ? pricePoints[0].ticker : '';
        for (let i = 0; i < pricePoints.length; i++) {
            const slice = pricePoints.slice(0, i + 1);
            // Check minimum data points: prefer minimumDataPointsForParams if available
            const strategyAny = strategy;
            const minPoints = typeof strategyAny.minimumDataPointsForParams === 'function'
                ? strategyAny.minimumDataPointsForParams(params)
                : strategy.minimumDataPoints();
            if (slice.length < minPoints) {
                continue;
            }
            const signal = strategy.evaluate(slice, params);
            // Only collect BUY/SELL signals, exclude HOLD
            if (signal.direction === 'BUY' || signal.direction === 'SELL') {
                signals.push({
                    ...signal,
                    id: this.generateSignalId(),
                    ticker,
                    strategyType: strategy.type,
                });
            }
        }
        const performanceSummary = computePerformanceSummary(signals, pricePoints);
        return {
            ticker,
            strategyType: strategy.type,
            params,
            period,
            dataPointsEvaluated: pricePoints.length,
            signals,
            performanceSummary,
        };
    }
    generateSignalId() {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        return `sig_${timestamp}_${random}`;
    }
}
exports.BacktestEngine = BacktestEngine;
//# sourceMappingURL=backtest-engine.js.map