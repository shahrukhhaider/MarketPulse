import type { Signal, PricePoint, WatchlistEntry, StrategyConfig } from './types.js';
import { PriceFeedClient } from './price-feed-client.js';
import { PriceDataStore } from './price-data-store.js';
export interface PollResult {
    success: boolean;
    timestamp: string;
    pricesFetched: number;
    signalsGenerated: number;
    errors: string[];
}
export declare class MonitoringEngine {
    private priceFeedClient;
    private priceDataStore;
    private signalStore;
    private watchlist;
    private strategies;
    private intervalId;
    private running;
    private pollCyclesCompleted;
    private lastPollTimestamp;
    /** Tracks the last emitted signal per ticker+strategy for duplicate suppression */
    private lastSignals;
    constructor(priceFeedClient: PriceFeedClient, priceDataStore: PriceDataStore);
    start(interval: number, watchlist: WatchlistEntry[], signalFilePath: string): void;
    stop(): void;
    isRunning(): boolean;
    getPollCyclesCompleted(): number;
    getLastPollTimestamp(): string | null;
    pollCycle(): Promise<PollResult>;
    evaluateStrategies(ticker: string, priceHistory: PricePoint[], strategyConfigs: StrategyConfig[]): Signal[];
    writeSignals(signals: Signal[]): void;
    private getMinimumDataPoints;
    private generateSignalId;
    private initializeLastSignals;
}
//# sourceMappingURL=monitoring-engine.d.ts.map