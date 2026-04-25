import type {
  Signal,
  PricePoint,
  WatchlistEntry,
  StrategyConfig,
  StrategyType,
  Strategy,
} from './types.js';
import { PriceFeedClient } from './price-feed-client.js';
import { PriceDataStore } from './price-data-store.js';
import { SignalStore } from './signal-store.js';
import { MovingAverageCrossoverStrategy } from './strategies/moving-average.js';
import { RSIThresholdStrategy } from './strategies/rsi-threshold.js';
import { PriceBreakoutStrategy } from './strategies/price-breakout.js';

export interface PollResult {
  success: boolean;
  timestamp: string;
  pricesFetched: number;
  signalsGenerated: number;
  errors: string[];
}

export class MonitoringEngine {
  private priceFeedClient: PriceFeedClient;
  private priceDataStore: PriceDataStore;
  private signalStore: SignalStore | null = null;
  private watchlist: WatchlistEntry[] = [];
  private strategies: Map<StrategyType, Strategy>;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private pollCyclesCompleted = 0;
  private lastPollTimestamp: string | null = null;
  /** Tracks the last emitted signal per ticker+strategy for duplicate suppression */
  private lastSignals: Map<string, Signal> = new Map();

  constructor(
    priceFeedClient: PriceFeedClient,
    priceDataStore: PriceDataStore,
  ) {
    this.priceFeedClient = priceFeedClient;
    this.priceDataStore = priceDataStore;
    this.strategies = new Map<StrategyType, Strategy>();
    this.strategies.set('moving_average_crossover', new MovingAverageCrossoverStrategy());
    this.strategies.set('rsi_threshold', new RSIThresholdStrategy());
    this.strategies.set('price_breakout', new PriceBreakoutStrategy());
  }

  start(
    interval: number,
    watchlist: WatchlistEntry[],
    signalFilePath: string,
  ): void {
    if (this.running) {
      return;
    }
    this.watchlist = watchlist;
    this.signalStore = new SignalStore(signalFilePath);
    this.running = true;
    this.pollCyclesCompleted = 0;
    this.lastPollTimestamp = null;
    this.lastSignals.clear();

    // Initialize lastSignals from existing signal store to support duplicate suppression across restarts
    this.initializeLastSignals();

    // Run first poll immediately, then at interval
    this.pollCycle();
    this.intervalId = setInterval(() => {
      this.pollCycle();
    }, interval * 1000);
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  getPollCyclesCompleted(): number {
    return this.pollCyclesCompleted;
  }

  getLastPollTimestamp(): string | null {
    return this.lastPollTimestamp;
  }

  pollCycle(): PollResult {
    const errors: string[] = [];
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
    const batchResult = this.priceFeedClient.fetchBatchPrices(tickers);

    if (!batchResult.success) {
      // Price feed unavailable: log, retain last prices, retry next cycle
      const errorMsg = `Price feed unavailable: ${batchResult.error}`;
      errors.push(errorMsg);
      this.pollCyclesCompleted++;
      this.lastPollTimestamp = timestamp;
      return { success: false, timestamp, pricesFetched: 0, signalsGenerated: 0, errors };
    }

    const priceMap = batchResult.data;
    const allNewSignals: Signal[] = [];

    for (const entry of this.watchlist) {
      const ticker = entry.ticker;
      const pricePoint = priceMap.get(ticker);

      if (!pricePoint) {
        errors.push(`No price data returned for ${ticker}`);
        continue;
      }

      // Calculate price change from previous price
      const existingHistory = this.priceDataStore.getPriceHistory(ticker);
      const enrichedPoint: PricePoint = { ...pricePoint };

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

  evaluateStrategies(
    ticker: string,
    priceHistory: PricePoint[],
    strategyConfigs: StrategyConfig[],
  ): Signal[] {
    const signals: Signal[] = [];

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
        const enrichedSignal: Signal = {
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
      } catch {
        // Strategy evaluation failure — skip this strategy, continue with others
      }
    }

    return signals;
  }

  writeSignals(signals: Signal[]): void {
    if (!this.signalStore || signals.length === 0) {
      return;
    }
    this.signalStore.writeSignals(signals);
  }

  private getMinimumDataPoints(strategy: Strategy, config: StrategyConfig): number {
    // Use params-aware minimum if available
    const strategyAny = strategy as any;
    if (typeof strategyAny.minimumDataPointsForParams === 'function') {
      return strategyAny.minimumDataPointsForParams(config.params);
    }
    return strategy.minimumDataPoints();
  }

  private generateSignalId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `sig_${timestamp}_${random}`;
  }

  private initializeLastSignals(): void {
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
