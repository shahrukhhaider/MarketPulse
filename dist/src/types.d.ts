import type { CompositeStrategyParams, PhasedStrategyParams } from './strategies/strategy-configs.js';
export interface MovingAverageCrossoverParams {
    shortWindow: number;
    longWindow: number;
}
export interface RSIThresholdParams {
    period: number;
    overbought: number;
    oversold: number;
}
export interface PriceBreakoutParams {
    upperLevel: number;
    lowerLevel: number;
}
export type StrategyParams = MovingAverageCrossoverParams | RSIThresholdParams | PriceBreakoutParams | CompositeStrategyParams | PhasedStrategyParams;
export type StrategyType = 'moving_average_crossover' | 'rsi_threshold' | 'price_breakout' | 'momentum_continuation' | 'trend_pullback' | 'breakout_volume';
export type { CompositeStrategyParams, PhasedStrategyParams } from './strategies/strategy-configs.js';
export interface StrategyConfig {
    type: StrategyType;
    params: StrategyParams;
    enabled: boolean;
}
export interface Strategy {
    type: StrategyType;
    evaluate(priceHistory: PricePoint[], params: StrategyParams): Signal;
    validateParams(params: StrategyParams): {
        valid: boolean;
        error?: string;
    };
    minimumDataPoints(): number;
}
export interface Settings {
    pollingInterval: number;
    retentionDays: number;
    dataDir: string;
}
export interface WatchlistEntry {
    ticker: string;
    addedAt: string;
    strategies: StrategyConfig[];
}
export interface Config {
    watchlist: WatchlistEntry[];
    settings: Settings;
}
export interface PricePoint {
    ticker: string;
    price: number;
    timestamp: string;
    change?: number;
    changePercent?: number;
}
export interface PriceHistory {
    [ticker: string]: PricePoint[];
}
export type SignalDirection = 'BUY' | 'SELL' | 'HOLD';
export interface Signal {
    id: string;
    ticker: string;
    direction: SignalDirection;
    strategyType: StrategyType;
    price: number;
    timestamp: string;
    previousDirection?: SignalDirection;
    previousTimestamp?: string;
}
export interface V2Signal extends Signal {
    stopLossPrice?: number;
    profitTargetPrice?: number;
    rValue?: number;
    exitReason?: 'stop_loss' | 'profit_target' | 'trend_failsafe';
}
export interface ProcessStatus {
    state: 'running' | 'stopped';
    pid?: number;
    signalFilePath?: string;
    sessionStartTime?: string;
    pollingInterval?: number;
    pollCyclesCompleted?: number;
    lastPollTimestamp?: string;
}
export interface CommandResult {
    success: boolean;
    command: string;
    data?: any;
    error?: {
        code: string;
        message: string;
    };
    timestamp: string;
}
export declare const ErrorCodes: {
    readonly INVALID_TICKER: "INVALID_TICKER";
    readonly MISSING_PARAM: "MISSING_PARAM";
    readonly INVALID_PARAM_RANGE: "INVALID_PARAM_RANGE";
    readonly DUPLICATE_STOCK: "DUPLICATE_STOCK";
    readonly STOCK_NOT_FOUND: "STOCK_NOT_FOUND";
    readonly MONITOR_ALREADY_RUNNING: "MONITOR_ALREADY_RUNNING";
    readonly MONITOR_NOT_RUNNING: "MONITOR_NOT_RUNNING";
    readonly INSUFFICIENT_DATA: "INSUFFICIENT_DATA";
    readonly INVALID_CONFIG_JSON: "INVALID_CONFIG_JSON";
    readonly CORRUPT_PRICE_DATA: "CORRUPT_PRICE_DATA";
    readonly PRICE_FEED_UNAVAILABLE: "PRICE_FEED_UNAVAILABLE";
    readonly SPAWN_FAILED: "SPAWN_FAILED";
    readonly TERMINATE_FAILED: "TERMINATE_FAILED";
};
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
export type HistoricalPeriod = '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y';
export type HistoricalInterval = '1d' | '1wk' | '1mo';
export interface HistoricalDataPoint {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}
export interface HistoricalData {
    ticker: string;
    interval: HistoricalInterval;
    dataPoints: HistoricalDataPoint[];
}
export declare const VALID_PERIODS: HistoricalPeriod[];
export declare const VALID_INTERVALS: HistoricalInterval[];
export interface Trade {
    buySignal: Signal;
    sellSignal: Signal;
    profitLossPercent: number;
}
export interface V2Trade extends Trade {
    entryPrice: number;
    exitPrice: number;
    stopLossPrice: number;
    profitTargetPrice: number;
    rValue: number;
    exitReason: 'stop_loss' | 'profit_target' | 'trend_failsafe';
    barsHeld: number;
}
export interface PerformanceSummary {
    totalReturnPercent: number;
    benchmarkReturnPercent: number;
    numberOfTrades: number;
    winRate: number;
    maxDrawdownPercent: number;
    trades: Trade[];
    sharpeRatio: number;
}
export interface BacktestResult {
    ticker: string;
    strategyType: StrategyType;
    params: StrategyParams;
    period: string;
    dataPointsEvaluated: number;
    signals: Signal[];
    performanceSummary: PerformanceSummary;
}
//# sourceMappingURL=types.d.ts.map