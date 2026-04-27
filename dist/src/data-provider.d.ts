import type { HistoricalInterval, HistoricalDataPoint, HistoricalPeriod } from './types.js';
import type { Result } from './config-store.js';
export interface QuoteResult {
    ticker: string;
    price: number;
    timestamp: string;
}
export interface HistoricalResult {
    ticker: string;
    interval: HistoricalInterval;
    dataPoints: HistoricalDataPoint[];
}
export interface DataProvider {
    readonly name: string;
    getQuote(ticker: string): Promise<Result<QuoteResult>>;
    getQuotes(tickers: string[]): Promise<Result<Map<string, QuoteResult>>>;
    getHistoricalData(ticker: string, period?: HistoricalPeriod, interval?: HistoricalInterval): Promise<Result<HistoricalResult>>;
    validateTicker(ticker: string): Promise<Result<boolean>>;
}
export declare class DataProviderRegistry {
    private providers;
    register(provider: DataProvider): void;
    get(name: string): DataProvider | undefined;
    has(name: string): boolean;
    list(): string[];
}
//# sourceMappingURL=data-provider.d.ts.map