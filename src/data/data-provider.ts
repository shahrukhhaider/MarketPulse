import type { HistoricalInterval, HistoricalDataPoint, HistoricalPeriod } from '../types.js';
import type { Result } from './config-store.js';

// ============================================================
// Provider-Agnostic Data Types
// ============================================================

export interface QuoteResult {
  ticker: string;       // Uppercased ticker symbol
  price: number;        // Current market price
  timestamp: string;    // ISO 8601
}

export interface HistoricalResult {
  ticker: string;                    // Uppercased ticker symbol
  interval: HistoricalInterval;      // The interval used
  dataPoints: HistoricalDataPoint[]; // OHLCV data sorted by date ascending
}

// ============================================================
// DataProvider Interface
// ============================================================

export interface DataProvider {
  readonly name: string;
  getQuote(ticker: string): Promise<Result<QuoteResult>>;
  getQuotes(tickers: string[]): Promise<Result<Map<string, QuoteResult>>>;
  getHistoricalData(
    ticker: string,
    period?: HistoricalPeriod,
    interval?: HistoricalInterval
  ): Promise<Result<HistoricalResult>>;
  validateTicker(ticker: string): Promise<Result<boolean>>;
}

// ============================================================
// DataProviderRegistry
// ============================================================

export class DataProviderRegistry {
  private providers: Map<string, DataProvider> = new Map();

  register(provider: DataProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): DataProvider | undefined {
    return this.providers.get(name);
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  list(): string[] {
    return Array.from(this.providers.keys());
  }
}
