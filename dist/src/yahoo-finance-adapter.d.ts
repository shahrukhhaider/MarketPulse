import type { DataProvider, QuoteResult, HistoricalResult } from './data-provider.js';
import type { YahooFinanceClient } from './price-feed-client.js';
import type { Result } from './config-store.js';
import type { HistoricalPeriod, HistoricalInterval } from './types.js';
export declare class YahooFinanceAdapter implements DataProvider {
    readonly name = "yahoo";
    private yahooFinance;
    constructor(yahooFinanceClient?: YahooFinanceClient);
    getQuote(ticker: string): Promise<Result<QuoteResult>>;
    getQuotes(tickers: string[]): Promise<Result<Map<string, QuoteResult>>>;
    getHistoricalData(ticker: string, period?: HistoricalPeriod, interval?: HistoricalInterval): Promise<Result<HistoricalResult>>;
    validateTicker(ticker: string): Promise<Result<boolean>>;
}
//# sourceMappingURL=yahoo-finance-adapter.d.ts.map